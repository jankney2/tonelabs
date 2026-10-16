// Jigglewire: the main intake phone system (calls answered or returned by the intake team).
// API v1.0 docs: https://jigglewire.tone.fyi/docs#quick-start
//  - Auth is OAuth 2.0 JWT bearer, not a static key (see authenticate() below).
//  - In paths `~` means "the account/extension this token belongs to".
//  - Lists return { records, paging, navigation }; navigation.nextPage.uri is the next page.
//  - Rate limit: 10 requests / 60 s per account on every API endpoint ("Heavy"), 5 / minute on the
//    token endpoint. 429 carries Retry-After (the base class honours it).
//  - Permissions per endpoint: ReadCallLog, ReadAccounts, ReadMessages, ReadPresence.
import { ExternalApiService } from '../ExternalApiService.js';

const TOKEN_PATH = '/restapi/oauth/token';
const JWT_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const EXPIRY_MARGIN_MS = 60_000; // treat a token as expired a minute early

// Heavy usage group: 10 requests per 60 s. Space calls out so a full pull never trips the limit.
const MIN_REQUEST_GAP_MS = 6_500;

export class JigglewireApiService extends ExternalApiService {
  constructor({ clientId, clientSecret, jwt, baseUrl = 'https://jigglewire.tone.fyi', ...rest } = {}) {
    if (!clientId || !clientSecret || !jwt) throw new Error('Jigglewire clientId, clientSecret and jwt are required');
    // auth stays "none": the real Authorization header comes from authenticate(), per request.
    super({ source: 'jigglewire', baseUrl, ...rest });
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.jwt = jwt;
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.lastRequestAt = 0;
  }

  /**
   * Returns the Authorization header for the next call, fetching a token only when needed.
   * Flow: 1) first call (or `force`, or no usable refresh token) trades the JWT for an access
   * token + refresh token; 2) access tokens last 1 hour, so near expiry we use the refresh token
   * instead (each refresh token works once, so we always store the new one); 3) if a refresh
   * fails we fall back to the JWT. The token endpoint only takes form-encoded bodies and
   * authenticates the app with Basic base64(clientId:clientSecret).
   */
  async authenticate({ force = false } = {}) {
    if (!force && this.accessToken && Date.now() < this.expiresAt - EXPIRY_MARGIN_MS) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }
    const attempts = [];
    if (!force && this.refreshToken) attempts.push({ grant_type: 'refresh_token', refresh_token: this.refreshToken });
    attempts.push({ grant_type: JWT_GRANT, assertion: this.jwt });

    let lastErr;
    for (const form of attempts) {
      this.refreshToken = null; // single use: never reuse it, whatever happens
      try {
        const res = await this.request(TOKEN_PATH, {
          method: 'POST',
          skipAuth: true,
          headers: {
            Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(form).toString(),
        });
        const t = await res.json();
        if (!t.access_token) throw new Error('token response had no access_token');
        this.accessToken = t.access_token;
        this.refreshToken = t.refresh_token ?? null;
        this.expiresAt = Date.now() + (Number(t.expires_in) || 3600) * 1000;
        return { Authorization: `Bearer ${this.accessToken}` };
      } catch (err) {
        lastErr = err;
      }
    }
    this.accessToken = null;
    throw lastErr;
  }

  /** Stay under the 10 requests / 60 s limit by spacing API calls (not token calls). */
  async request(path, opts = {}) {
    if (!opts.skipAuth) {
      const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
    }
    return super.request(path, opts);
  }

  /** One page of the company call log, newest first. view=Detailed includes each call's legs. */
  getCallLogPage({ page = 1, perPage = 1000, dateFrom, dateTo, view = 'Detailed', direction } = {}) {
    return this.getJson('/restapi/v1.0/account/~/call-log', {
      query: { page, perPage, dateFrom, dateTo, view, direction },
    });
  }

  /** Users and queues on the account. */
  getExtensionsPage({ page = 1, perPage = 1000 } = {}) {
    return this.getJson('/restapi/v1.0/account/~/extension', { query: { page, perPage } });
  }

  /** Voicemail for one extension (use the department/queue extension for a shared mailbox). */
  getVoicemailPage(extensionId, { page = 1, perPage = 1000, dateFrom, dateTo } = {}) {
    return this.getJson(`/restapi/v1.0/account/~/extension/${extensionId}/message-store`, {
      query: { messageType: 'VoiceMail', page, perPage, dateFrom, dateTo },
    });
  }

  /** Who is currently taking calls for one queue. groupId is the queue's extension id. */
  getQueuePresence(groupId) {
    return this.getJson(`/restapi/v1.0/account/~/call-queues/${groupId}/presence`);
  }

  /** Follow navigation.nextPage.uri until the list ends. Yields each page's body. */
  async *paginate(firstPage) {
    let body = await firstPage();
    for (;;) {
      yield body;
      const next = body.navigation?.nextPage?.uri;
      if (!next) return;
      body = await this.getJson(next);
    }
  }
}

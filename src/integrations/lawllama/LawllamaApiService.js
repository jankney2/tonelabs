// Lawllama: intake leads (web form leads arrive automatically, phone leads are typed in by hand).
// API (beta) docs: https://lawllama.tone.fyi/docs
//  - Auth: `Authorization: Bearer TOKEN` (Settings > Integrations > API tokens). Scopes used: leads:read, users:read.
//  - Cursor paging: lists return { data, has_more, next_cursor }; `limit` max 100.
//  - Rate limit: 120 requests / 60 s per account (429 + Retry-After; X-Rate-Limit-* headers).
//  - FINE PRINT: a monthly *record* quota. Once exceeded, EVERY request returns 429 `quota_exceeded`
//    (not fixable by waiting for the minute window). Raising it means phoning support, who confirm
//    with the account owner by email. So never re-pull the whole history needlessly: use
//    incremental `updated_since` syncs and avoid probing with large pages.
//  - Contact SSN / date of birth / immigration status are stripped from every response (redact.js).
//  - `updated_since` accepts epoch ms or ISO (both tested live); lower bound inclusive.
//  - `updated_at` is epoch milliseconds, `created_at` is ISO 8601 UTC.
import { ExternalApiService, ApiError } from '../ExternalApiService.js';
import { redactBody } from './redact.js';

export class LawllamaApiService extends ExternalApiService {
  constructor({ token, baseUrl = 'https://lawllama.tone.fyi', minIntervalMs = 600, ...rest } = {}) {
    if (!token) throw new Error('Lawllama token is required');
    super({ source: 'lawllama', baseUrl, auth: { type: 'bearer', token }, ...rest });
    this.minIntervalMs = minIntervalMs; // 120/60 s = one per 500 ms at best; leave headroom
    this.lastRequestAt = 0;
    this.rateLimit = null; // latest X-Rate-Limit-* values seen
  }

  async request(path, opts) {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
    try {
      const res = await super.request(path, opts);
      this.rateLimit = {
        limit: res.headers.get('x-rate-limit-limit'),
        remaining: res.headers.get('x-rate-limit-remaining'),
        window: res.headers.get('x-rate-limit-window'),
      };
      return res;
    } catch (err) {
      // quota_exceeded is a 429 that retrying cannot fix; make it obvious.
      if (err instanceof ApiError && err.status === 429 && /quota_exceeded/.test(err.body ?? '')) {
        err.message = 'Lawllama monthly record quota exceeded (call support to raise it)';
      }
      throw err;
    }
  }

  /** One page of leads, most recently updated first. */
  async getLeadsPage({ cursor, limit = 100, updatedSince, updatedBefore, include = 'contact' } = {}) {
    return redactBody(await this.getJson('/v1/leads', {
      query: { cursor, limit, updated_since: updatedSince, updated_before: updatedBefore, include },
    }));
  }

  async getLead(id, { include } = {}) { return redactBody(await this.getJson(`/v1/leads/${id}`, { query: { include } })); }
  async getContact(id) { return redactBody(await this.getJson(`/v1/contacts/${id}`)); }
  getLeadStatuses() { return this.getJson('/v1/lead_statuses'); }
  getUsersPage({ cursor, limit = 100 } = {}) { return this.getJson('/v1/users', { query: { cursor, limit } }); }

  /** Async-iterate cursor pages of a list. fetchPage(cursor) returns { data, has_more, next_cursor }. */
  async *paginate(fetchPage) {
    let cursor;
    for (;;) {
      const body = await fetchPage(cursor);
      yield body;
      if (!body.has_more || !body.next_cursor) return;
      cursor = body.next_cursor;
    }
  }
}

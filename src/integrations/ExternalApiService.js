// Base class for every external system we pull from (Ringsnitch, Jigglewire, ...).
// Holds what all of them share: base URL, auth, default headers, and a polite request
// helper (timeout, retry with backoff on 429/5xx). Subclasses add the system-specific methods.
// Pulls are read-only: the base class only issues GETs unless a subclass asks otherwise.

export class ApiError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class ExternalApiService {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl       e.g. https://ringsnitch.tone.fyi
   * @param {{type:'bearer'|'header'|'basic'|'query'|'none', token?:string, name?:string,
   *          username?:string, password?:string}} [opts.auth]  how to authenticate
   * @param {Record<string,string>} [opts.headers]  extra default headers
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.maxRetries]
   * @param {typeof fetch} [opts.fetchImpl]  injectable for tests
   */
  constructor({
    baseUrl,
    auth = { type: "none" },
    headers = {},
    timeoutMs = 15000,
    maxRetries = 3,
    fetchImpl = fetch,
    source = "unknown", // system name used in audit rows, e.g. "ringsnitch"
    logger = null // audit sink with write(entry), see IntegrationLogger
  }) {
    if (!baseUrl) throw new Error("baseUrl is required");
    this.source = source;
    this.logger = logger;
    this.runId = null;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.auth = auth;
    this.defaultHeaders = { Accept: "application/json", ...headers };
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    // Call fetch unbound: Workers throw "Illegal invocation" if fetch runs with another `this`.
    this.fetchImpl = (...args) => fetchImpl(...args);
  }

  buildUrl(path, query = {}) {
    const url = new URL(
      path.startsWith("http")
        ? path
        : `${this.baseUrl}/${path.replace(/^\/+/, "")}`
    );
    for (const [k, v] of Object.entries(query))
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    if (this.auth.type === "query")
      url.searchParams.set(this.auth.name, this.auth.token);
    return url;
  }

  buildHeaders(extra = {}) {
    const h = { ...this.defaultHeaders, ...extra };
    const { type, token, name, username, password } = this.auth;
    if (type === "bearer") h.Authorization = `Bearer ${token}`;
    else if (type === "header") h[name] = token;
    else if (type === "basic")
      h.Authorization = `Basic ${btoa(`${username}:${password}`)}`;
    return h;
  }

  // --- Audit logging (hp.integration_logs). No-ops when no logger is set. ---

  async log(event, fields = {}) {
    if (!this.logger) return;
    try {
      await this.logger.write({ source: this.source, runId: this.runId, event, ...fields });
    } catch (err) {
      console.error(`audit log failed: ${err.message}`); // never let logging break a pull
    }
  }

  /** Mark the start of one pull; every request until finishRun() carries this run id. */
  async startRun(message) {
    this.runId = crypto.randomUUID();
    await this.log('run_start', { message });
    return this.runId;
  }

  /** Mark the end of a pull with a summary, e.g. { rowsFetched: 300 }. */
  async finishRun(summary = {}, { error } = {}) {
    await this.log('run_end', { message: error ? `failed: ${error.message}` : 'ok', details: summary });
    this.runId = null;
  }

  /** Raw request: returns the Response after retries. Throws ApiError on non-2xx. */
  async request(path, { query, headers, method = "GET" } = {}) {
    const url = this.buildUrl(path, query);
    for (let attempt = 0; ; attempt++) {
      let res;
      const started = Date.now();
      const logReq = (status, message) => this.log(status >= 400 || status === undefined ? 'error' : 'request', {
        method, path: this.safeUrl(url).replace(this.baseUrl, ''), status, durationMs: Date.now() - started,
        message, details: attempt ? { attempt } : null,
      });
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: this.buildHeaders(headers),
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new ApiError(`Request failed: ${err.message}`, {
          url: this.safeUrl(url)
        });
      }
      await logReq(res.status, res.ok ? null : `HTTP ${res.status}`);
      if (res.ok) return res;
      if (
        (res.status === 429 || res.status >= 500) &&
        attempt < this.maxRetries
      ) {
        await sleep(backoff(attempt, res.headers.get("retry-after")));
        continue;
      }
      throw new ApiError(`HTTP ${res.status}`, {
        status: res.status,
        url: this.safeUrl(url),
        body: (await res.text()).slice(0, 500)
      });
    }
  }

  async getJson(path, opts) {
    return (await this.request(path, opts)).json();
  }

  async getText(path, opts) {
    return (await this.request(path, opts)).text();
  }

  /** URL for logs/errors with any query-string credential removed. */
  safeUrl(url) {
    const u = new URL(url);
    if (this.auth.type === "query") u.searchParams.delete(this.auth.name);
    return u.toString();
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = (attempt, retryAfter) =>
  retryAfter && !Number.isNaN(Number(retryAfter))
    ? Number(retryAfter) * 1000
    : 500 * 2 ** attempt;

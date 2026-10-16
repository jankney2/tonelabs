// Blankety: website contact form builder (feeds Lawllama through an API connection).
// Docs: https://blankety.tone.fyi/docs
//  - Auth: API key in the `APIKEY` header. (`?apiKey=` also works but leaks into logs, so we never use it.)
//  - Envelope: { responseCode, message, content, resultSet: { offset, limit, count } }; count = items in this response.
//  - Offset paging: `offset` and `limit` (max 1000; the default is 20 when omitted).
//  - Rate limit: 1,000 calls per DAY per account (429 + Retry-After). X-Rate-Limit-* headers say what is left.
//  - Timestamps ("created_at": "2026-10-16 14:59:36") are in the account's time zone, which is not named.
//  - Submissions come newest first; `created_after` / `created_before` filter them (same format).
import { ExternalApiService } from '../ExternalApiService.js';

export class BlanketyApiService extends ExternalApiService {
  constructor({ apiKey, baseUrl = 'https://blankety.tone.fyi', ...rest } = {}) {
    if (!apiKey) throw new Error('Blankety API key is required');
    super({ source: 'blankety', baseUrl, auth: { type: 'header', name: 'APIKEY', token: apiKey }, ...rest });
    this.rateLimit = null; // latest X-Rate-Limit-* values seen (daily budget)
  }

  async request(path, opts) {
    const res = await super.request(path, opts);
    this.rateLimit = {
      limit: res.headers.get('x-rate-limit-limit'),
      remaining: res.headers.get('x-rate-limit-remaining'),
      window: res.headers.get('x-rate-limit-window'),
    };
    return res;
  }

  getFormsPage({ offset = 0, limit = 100 } = {}) {
    return this.getJson('/v1/user/forms', { query: { offset, limit } });
  }

  /** A form's questions, keyed by question id (`content` is an object, not an array). */
  getQuestions(formId) {
    return this.getJson(`/v1/form/${encodeURIComponent(formId)}/questions`);
  }

  /** One page of submissions, newest first. createdAfter/createdBefore: 'YYYY-MM-DD HH:MM:SS' in the account's zone. */
  getSubmissionsPage(formId, { offset = 0, limit = 1000, createdAfter, createdBefore } = {}) {
    return this.getJson(`/v1/form/${encodeURIComponent(formId)}/submissions`, {
      query: { offset, limit, created_after: createdAfter, created_before: createdBefore },
    });
  }

  /** Async-iterate offset pages. fetchPage(offset) returns an envelope; stops when a page is short. */
  async *paginate(fetchPage, limit) {
    for (let offset = 0; ; ) {
      const body = await fetchPage(offset);
      yield body;
      const n = body.resultSet?.count ?? body.content?.length ?? 0;
      if (n < limit) return;
      offset += n;
    }
  }
}

// Ringsnitch: tracked inbound calls with their source number (marketing attribution).
// API v3 docs: https://ringsnitch.tone.fyi/docs
//  - Every path includes the account ID (ACC...): /v3/a/:account/calls.json
//  - Auth: `Authorization: Token token="KEY"`. Key scopes: calls:read, trackers:read, users:read, ...
//  - Lists are paginated (page, per_page max 100) and return total_pages / total_records.
//  - Rate limit: 1,000 requests/hour per account, shared by all keys; 429 carries Retry-After.
import { ExternalApiService } from '../ExternalApiService.js';

// Optional call fields the API only returns when asked for.
export const CALL_FIELDS = [
  'voicemail', 'source', 'recording', 'transcription', 'customer_name', 'tracking_phone_number',
  'tracker_id', 'first_call', 'ai_summary', 'ai_lead_status', 'ai_follow_up',
];

export class RingSnitchApiService extends ExternalApiService {
  constructor({ readKey, accountId, baseUrl = 'https://ringsnitch.tone.fyi', ...rest } = {}) {
    if (!accountId) throw new Error('RingSnitch accountId (ACC...) is required');
    super({ source: "ringsnitch", baseUrl, auth: { type: 'header', name: 'Authorization', token: `Token token="${readKey}"` }, ...rest });
    this.accountId = accountId;
  }

  path(suffix) {
    return `/v3/a/${this.accountId}/${suffix}`;
  }

  /** One page of calls, newest first. */
  getCallsPage({ page = 1, perPage = 100, startDate, endDate, fields = CALL_FIELDS } = {}) {
    return this.getJson(this.path('calls.json'), {
      query: { page, per_page: perPage, start_date: startDate, end_date: endDate, fields: fields.join(',') },
    });
  }

  /** Async-iterate every page of a list endpoint. Yields the whole page response. */
  async *paginate(fetchPage) {
    for (let page = 1; ; page++) {
      const body = await fetchPage(page);
      yield body;
      if (page >= (body.total_pages ?? 1)) return;
    }
  }

  getCall(id, { fields = CALL_FIELDS } = {}) {
    return this.getJson(this.path(`calls/${id}.json`), { query: { fields: fields.join(',') } });
  }

  getTrackers({ page = 1, perPage = 100 } = {}) { return this.getJson(this.path('trackers.json'), { query: { page, per_page: perPage } }); }
  getUsers({ page = 1, perPage = 100 } = {}) { return this.getJson(this.path('users.json'), { query: { page, per_page: perPage } }); }
  getChangelog() { return this.getJson(this.path('changelog.json')); }
}

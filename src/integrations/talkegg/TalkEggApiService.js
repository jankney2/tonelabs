// TalkEgg: the older office PBX (front desk calls). Reporting API v2.3, https://talkegg.tone.fyi/docs
//  - Auth: HTTP Basic with the web interface login (TALKEGG_USER / TALKEGG_PASS); no API key.
//  - GET /cgi-bin/cdr.cgi?start=MM/DD/YYYY&end=MM/DD/YYYY&format=csv  (max range 31 days, PBX local time)
//  - GET /cgi-bin/vm.cgi?box=NNN&format=csv  (boxes 10 Front Desk, 100 General)
//  - Errors are plain text starting "ERROR:". No documented paging or rate limit.
import { ExternalApiService } from '../ExternalApiService.js';

export class TalkEggApiService extends ExternalApiService {
  constructor({ username, password, baseUrl = 'https://talkegg.tone.fyi', ...rest } = {}) {
    super({ source: 'talkegg', baseUrl, auth: { type: 'basic', username, password }, headers: { Accept: '*/*' }, ...rest });
  }

  /** Raw CDR text for an inclusive day range (Date or MM/DD/YYYY strings). */
  getCdrText({ start, end = start, format = 'csv' } = {}) {
    return this.getText('/cgi-bin/cdr.cgi', { query: { start: fmtDay(start), end: fmtDay(end), format } });
  }

  getVoicemailText(box, { format = 'csv' } = {}) {
    return this.getText('/cgi-bin/vm.cgi', { query: { box, format } });
  }
}

const fmtDay = d => (d instanceof Date
  ? `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`
  : d);

// Mostlyanswered: the after-hours answering service. No API: the firm's area is an Apache directory listing of
// daily CSV files, behind HTTP Basic Auth (realm "Client Files").
//  - Listing: GET <base>/ -> HTML table (name, last modified, approximate size such as "1.8K").
//  - Files: Harlow_Pike_Messages_YYYY-MM-DD.csv, posted at 07:00 (server time) each morning. Header
//    `Date/Time Taken,Caller Name,Callback Number,Message,Operator,Promised`; CRLF; times like "8/21/26 11:00 AM", no zone.
//  - No rate limit stated; a full pull is one listing plus one request per file.
import { ExternalApiService } from '../ExternalApiService.js';
import { parseCsvObjects } from './csv.js';

export const FILE_NAME = /^Harlow_Pike_Messages_(\d{4}-\d{2}-\d{2})\.csv$/;

export class MostlyansweredApiService extends ExternalApiService {
  /** @param {{baseUrl: string, username: string, password: string}} opts  baseUrl = the files directory URL */
  constructor({ baseUrl, username, password, ...rest } = {}) {
    if (!baseUrl || !username || !password) throw new Error('Mostlyanswered URL, user and password are required');
    super({ source: 'mostlyanswered', baseUrl, auth: { type: 'basic', username, password }, headers: { Accept: 'text/csv, text/html' }, ...rest });
  }

  /** Files in the directory: [{ name, last_modified, size }] as the listing shows them (strings). */
  async listFiles() {
    return parseListing(await this.getText('/'));
  }

  /** One daily file, as parsed rows keyed by the CSV header. */
  async getFile(name) {
    return parseCsvObjects(await this.getText(`/${encodeURIComponent(name)}`));
  }
}

/** Parse an Apache "Index of" table. Skips the parent link and anything that is not a file row. */
export function parseListing(html) {
  const out = [];
  for (const m of html.matchAll(/<tr><td><a href="([^"?/][^"]*)">[^<]*<\/a><\/td><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td>/g)) {
    out.push({ name: decodeURIComponent(m[1]), last_modified: m[2].trim(), size: m[3].trim() });
  }
  return out;
}

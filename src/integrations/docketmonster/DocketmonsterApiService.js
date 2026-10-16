// Docketmonster Case Manager 9: matters (a case, after signing). SOAP 1.1 document/literal, not REST.
// Docs: https://docketmonster.tone.fyi/docs (Integration Guide rev. 4, 2014); WSDL: <endpoint>?WSDL
//  - Endpoint: /CaseManager9/MatterService.asmx. Each call is a POST with a SOAPAction header and an
//    AuthHeader (FirmCode, UserName, Password) inside the envelope. Credentials are therefore in the request
//    BODY, which the audit log never records (only method + path + status).
//  - Operations: GetMattersOpened(FromDate, ToDate), GetMatterCount(FromDate, ToDate), GetMatter(MatterNumber).
//    Dates are yyyy-MM-dd, both ends inclusive. No paging: one call returns every matter in the range.
//  - Returned date/times (OpenedDate) are the firm's local time, no zone: "2026-10-01T09:43:09".
//  - Errors are SOAP faults with HTTP 500 (e.g. NOT_FOUND). No rate limit stated.
import { ExternalApiService, ApiError } from '../ExternalApiService.js';
import { buildEnvelope, NS, parseFault, parseMatters, firstTag } from './soap.js';

export class DocketmonsterApiService extends ExternalApiService {
  constructor({ firmCode, username, password, baseUrl = 'https://docketmonster.tone.fyi', ...rest } = {}) {
    if (!firmCode || !username || !password) throw new Error('Docketmonster firm code, user name and password are required');
    super({ source: 'docketmonster', baseUrl, ...rest });
    this.creds = { firmCode, username, password };
  }

  /** POST one SOAP operation and return the response XML. A SOAP fault becomes an ApiError with its code and text. */
  async soap(operation, params) {
    try {
      const res = await this.request('/CaseManager9/MatterService.asmx', {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}${operation}"` },
        body: buildEnvelope(operation, params, this.creds),
      });
      return await res.text();
    } catch (err) {
      const fault = err instanceof ApiError && err.body ? parseFault(err.body) : null;
      if (fault) {
        const e = new ApiError(`${operation}: ${fault.errorCode ?? fault.faultcode}: ${fault.faultstring}`, { status: err.status, url: err.url, body: err.body });
        e.code = fault.errorCode;
        throw e;
      }
      throw err;
    }
  }

  /** Matters opened from..to (yyyy-MM-dd, inclusive), as flat field objects with string values. */
  async getMattersOpened(from, to) {
    return parseMatters(await this.soap('GetMattersOpened', { FromDate: from, ToDate: to }));
  }

  async getMatterCount(from, to) {
    return Number(firstTag(await this.soap('GetMatterCount', { FromDate: from, ToDate: to }), 'GetMatterCountResult'));
  }

  async getMatter(matterNumber) {
    return parseMatters(await this.soap('GetMatter', { MatterNumber: matterNumber }))[0] ?? null;
  }
}

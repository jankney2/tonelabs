// Minimal SOAP 1.1 helpers for Docketmonster (no XML library: it must run in a Worker too).
// Only handles what this service returns: a flat <Matter> list with text-only children, and <soap:Fault>.

export const NS = 'http://docketmonster.com/cm9/';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
export const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** SOAP envelope with the AuthHeader and one operation. `params` is an object of simple text values. */
export function buildEnvelope(operation, params, { firmCode, username, password }) {
  const body = Object.entries(params).map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>`
    + `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">`
    + `<soap:Header><AuthHeader xmlns="${NS}"><FirmCode>${escapeXml(firmCode)}</FirmCode>`
    + `<UserName>${escapeXml(username)}</UserName><Password>${escapeXml(password)}</Password></AuthHeader></soap:Header>`
    + `<soap:Body><${operation} xmlns="${NS}">${body}</${operation}></soap:Body></soap:Envelope>`;
}

/** Text-only children of an element body, as { Name: 'text' }. Empty elements (<A/>) become ''. Values stay strings, as returned. */
export function parseFields(inner) {
  const out = {};
  for (const m of inner.matchAll(/<(\w+)(?:\s[^>]*)?>([^<]*)<\/\1>|<(\w+)\s*\/>/g)) out[m[1] ?? m[3]] = decodeXml(m[2] ?? '');
  return out;
}

/** Every <Matter>...</Matter> in a response as a field object. */
export const parseMatters = (xml) => [...xml.matchAll(/<Matter>([\s\S]*?)<\/Matter>/g)].map((m) => parseFields(m[1]));

/** The text of one element, or undefined. */
export const firstTag = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`));
  return m ? decodeXml(m[1]) : undefined;
};

/** { faultcode, faultstring, errorCode } if the body is a SOAP fault, else null. */
export function parseFault(xml) {
  if (!/<(\w+:)?Fault[\s>]/.test(xml)) return null;
  return { faultcode: firstTag(xml, 'faultcode'), faultstring: firstTag(xml, 'faultstring'), errorCode: firstTag(xml, 'ErrorCode') };
}

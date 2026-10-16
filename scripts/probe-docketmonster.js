// Prototype: read-only look at the Docketmonster SOAP service. Prints raw XML (truncated) and counts by month.
// Usage: node scripts/probe-docketmonster.js   (never prints the credentials)
import './load-env.js';
const URL_ = 'https://docketmonster.tone.fyi/CaseManager9/MatterService.asmx';
const NS = 'http://docketmonster.com/cm9/';
const call = async (op, inner) => {
  const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header><AuthHeader xmlns="${NS}"><FirmCode>${process.env.DOCKETMONSTER_FIRM_CODE}</FirmCode><UserName>${process.env.DOCKETMONSTER_USER}</UserName><Password>${process.env.DOCKETMONSTER_PASS}</Password></AuthHeader></soap:Header><soap:Body><${op} xmlns="${NS}">${inner}</${op}></soap:Body></soap:Envelope>`;
  const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}${op}"` }, body });
  const text = await res.text();
  console.log(`\n== ${op} ${inner.replace(/<[^>]+>/g, ' ').trim()} -> ${res.status}`);
  return text;
};
const range = (a, b) => `<FromDate>${a}</FromDate><ToDate>${b}</ToDate>`;
const cnt = (x) => x.match(/<GetMatterCountResult>(\d+)/)?.[1] ?? x.slice(0, 300);
console.log(cnt(await call('GetMatterCount', range('2020-01-01', '2026-12-31'))));
for (const [a, b] of [['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31'], ['2025-01-01', '2026-07-31']])
  console.log(a, cnt(await call('GetMatterCount', range(a, b))));
const xml = await call('GetMattersOpened', range('2026-10-01', '2026-10-03'));
console.log(xml.slice(0, 2500));
const one = xml.match(/<MatterNumber>([^<]*)/)?.[1];
if (one) console.log((await call('GetMatter', `<MatterNumber>${one}</MatterNumber>`)).slice(0, 1500));
console.log((await call('GetMatter', '<MatterNumber>NOPE</MatterNumber>')).slice(0, 600));

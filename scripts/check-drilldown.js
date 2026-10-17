// Read-only check that each dashboard drill-down lists exactly as many records as the number it explains.
// Run: node scripts/check-drilldown.js   (uses DATABASE_URL from .env; never writes)
import './load-env.js';
import { neon } from '@neondatabase/serverless';
import { parseParams } from '../src/dashboard/params.js';
import * as q from '../src/dashboard/queries.js';

const sql = neon(process.env.DATABASE_URL);
const ranges = ['from=2026-10-01&to=2026-10-16', 'from=2026-09-01&to=2026-09-30', 'from=2026-08-01&to=2026-10-16&hours=in', 'from=2026-10-10&to=2026-10-16&hours=out'];
const P = (s) => parseParams(new URLSearchParams(s)).params;
let bad = 0;
const check = (label, shown, listed) => {
  const ok = shown === listed;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: number ${shown}, drill-down ${listed}`);
};

for (const r of ranges) {
  console.log(`\n== ${r}`);
  const p = P(r);
  const { calls, ...rest } = { calls: await q.getCallTotals(sql, p), funnel: await q.getFunnel(sql, p) };
  const drill = async (extra) => (await q.getCallDrill(sql, { ...p, ...extra }, 1)).total;
  check('calls: unanswered', calls.inbound - calls.answered, await drill({ handledBy: 'failed' }));
  for (const k of ['employee', 'answering_service', 'missed', 'voicemail']) check(`calls: ${k}`, calls[k === 'employee' ? 'answered' : k], await drill({ handledBy: k }));
  if (p.hours !== 'out') check('calls: unanswered in office hours', calls.failed_in_hours, await drill({ handledBy: 'failed', hours: 'in' })); // the page does not link this tile when After hours is chosen
  for (const c of await q.getCallHeatmap(sql, p)) {
    const t = await drill({ handledBy: 'failed', dow: c.dow, hour: c.hour });
    if (t !== c.failed) check(`heatmap dow ${c.dow} hour ${c.hour}`, c.failed, t);
  }
  const lost = await q.getLostSummary(sql, p);
  check('lost: all people', lost.byType.reduce((n, x) => n + x.people, 0), (await q.getLostDrill(sql, p, 1)).total);
  for (const x of lost.byReason) check(`lost reason ${x.reason_bucket}`, x.people, (await q.getLostDrill(sql, { ...p, reason: x.reason_bucket }, 1)).total);
  for (const x of lost.bySource) for (const t of ['lead_lost', 'unreturned_call', 'lead_not_called', 'chat_lead_unanswered'])
    if (x[t]) check(`lost ${x.source} / ${t}`, x[t], (await q.getLostDrill(sql, { ...p, source: x.source, lossType: t }, 1)).total);
  const f = rest.funnel;
  check('funnel: leads', f.leads, (await q.getLeadDrill(sql, { ...p, step: 'leads' }, 1)).total);
  check('funnel: contacted', f.contacted, (await q.getLeadDrill(sql, { ...p, step: 'contacted' }, 1)).total);
  check('funnel: retained', f.retained, (await q.getLeadDrill(sql, { ...p, step: 'retained' }, 1)).total);
  for (const e of await q.getEmployees(sql, p)) {
    for (const [leg, key, res] of [['rung', 'rung', null], ['accepted', 'accepted', 'Accepted'], ['missed', 'missed', 'Missed']])
      check(`${e.name}: legs ${leg}`, e[key], await drill({ employees: [e.employee_id], legResult: res }));
  }
}
console.log(bad ? `\n${bad} mismatches` : '\nall drill-downs match their numbers');
process.exit(bad ? 1 : 0);

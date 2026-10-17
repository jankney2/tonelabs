// Dashboard page. Reads /api/dashboard/* with the filters in the form (and the URL), then draws tiles, charts and tables.
// All text goes in with textContent (never innerHTML), because names and sources come from the firm's systems.

const FILTERS = ['from', 'to', 'employee', 'source', 'stage', 'hours'];
const form = document.getElementById('filters');

const LOSS_LABELS = {
  lead_lost: 'Lead marked lost',
  unreturned_call: 'Called, nobody called back',
  lead_not_called: 'Lead never contacted',
  chat_lead_unanswered: 'Chat lead never contacted',
};
const REASON_LABELS = { slow_or_unreachable: 'Slow or unreachable', price: 'Price', went_elsewhere: 'Went to another firm', not_a_fit: 'Not a fit' };

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('en-US');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const waiting = (h) => (h >= 48 ? `${Math.round(h / 24)} days` : `${h} h`);

/** el('td', {class: 'n'}, 'text') — builds a DOM node; children are text or nodes, never HTML. */
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const kid of kids.flat()) node.append(kid instanceof Node ? kid : String(kid ?? ''));
  return node;
}

function table(id, columns, rows, empty) {
  const t = document.getElementById(id);
  t.replaceChildren(el('thead', {}, el('tr', {}, columns.map((c) => el('th', c.num ? { class: 'n' } : {}, c.label)))));
  const body = el('tbody');
  if (!rows.length) body.append(el('tr', {}, el('td', { colspan: columns.length }, empty)));
  for (const r of rows) body.append(el('tr', {}, columns.map((c) => el('td', c.num ? { class: 'n' } : {}, c.cell(r)))));
  t.append(body);
}

/** items: [number, label, bad?, drill?]; a tile with a drill is a button that opens the records behind the number. */
function tiles(id, items) {
  document.getElementById(id).replaceChildren(...items.map(([num, label, bad, drill]) => {
    const node = el(drill ? 'button' : 'div', { class: bad ? 'tile bad' : 'tile', ...(drill ? { type: 'button', title: 'Show these' } : {}) },
      el('div', { class: 'num' }, num), el('div', { class: 'label' }, label));
    if (drill) node.addEventListener('click', () => openDrill(...drill));
    return node;
  }));
}

// One Chart.js instance per canvas; drawing again replaces the old one.
const charts = {};
function chart(id, config) {
  charts[id]?.destroy();
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.color = css.getPropertyValue('--muted');
  Chart.defaults.borderColor = css.getPropertyValue('--line');
  charts[id] = new Chart(document.getElementById(id), config);
}
/** Chart.js onClick that calls fn(index, datasetIndex) for the bar or segment under the pointer. */
const onBar = (fn) => (_ev, hit) => { if (hit.length) fn(hit[0].index, hit[0].datasetIndex); };
const COLORS = ['#2a5db0', '#c0504d', '#e0a24a', '#4f9d69', '#8064a2', '#7f7f7f'];

// ---- filters <-> URL ----------------------------------------------------------------------------------------------

function readUrlIntoForm() {
  const q = new URLSearchParams(location.search);
  for (const name of FILTERS) if (q.has(name)) form.elements[name].value = q.get(name);
}

function queryString(only) {
  const q = new URLSearchParams();
  for (const name of only ?? FILTERS) {
    const v = form.elements[name].value;
    if (v && v !== 'any') q.set(name, v);
  }
  return q.toString();
}

function chicagoDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
}

function applyPreset(name) {
  const today = chicagoDate();
  if (name === 'mtd') { form.elements.from.value = ''; form.elements.to.value = ''; } // blank = the server's month to date
  if (name === '7d') { form.elements.from.value = chicagoDate(-6); form.elements.to.value = today; }
  if (name === 'lastmonth') {
    const first = new Date(`${today.slice(0, 8)}01T12:00:00Z`);
    const last = new Date(first.getTime() - 86400000);
    form.elements.from.value = `${last.toISOString().slice(0, 8)}01`;
    form.elements.to.value = last.toISOString().slice(0, 10);
  }
  load();
}

// ---- loading and drawing --------------------------------------------------------------------------------------------

async function api(path, qs) {
  const res = await fetch(`/api/dashboard/${path}?${qs}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  return res.json();
}

async function load() {
  const error = document.getElementById('error');
  error.hidden = true;
  const qs = queryString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  try {
    const [summary, lost, people, team, calls] = await Promise.all([
      api('summary', qs), api('lost', qs), api('lost/people', qs), api('employees', qs), api('calls', qs),
    ]);
    form.elements.from.value = summary.range.from; // show the dates the server used (month to date when blank)
    form.elements.to.value = summary.range.to;
    drawMissed(summary, lost, people.people);
    drawTeam(summary, team.employees);
    drawHeatmap(calls.heatmap);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
}

function drawMissed(summary, lost, people) {
  const { calls, funnel } = summary;
  const lostPeople = lost.byType.reduce((n, r) => n + r.people, 0);
  const lostValue = lost.byType.reduce((n, r) => n + r.est_value, 0);
  tiles('missed-tiles', [
    [int.format(calls.inbound - calls.answered), `of ${int.format(calls.inbound)} inbound calls never reached a person (${pct(calls.inbound - calls.answered, calls.inbound)})`, true,
      ['Inbound calls no person answered', 'calls', { handled_by: 'failed' }]],
    [int.format(calls.failed_in_hours), 'of those came in during office hours', true,
      // with "After hours" chosen this number is 0 and there is nothing to list (forcing hours=in would show calls the tile does not count)
      calls.failed_in_hours && form.elements.hours.value !== 'out' ? ['Unanswered calls during office hours', 'calls', { handled_by: 'failed', hours: 'in' }] : undefined],
    [int.format(lostPeople), `people lost${lostValue ? `, est. ${usd.format(lostValue)} in case value` : ''}`, false,
      ['People lost', 'lost', {}]],
    [int.format(funnel.retained), `retained from ${int.format(funnel.leads)} new leads (${pct(funnel.retained, funnel.leads)})`, false,
      ['Leads retained', 'leads', { step: 'retained' }]],
  ]);

  chart('chart-funnel', {
    type: 'bar',
    data: { labels: ['New leads', 'Contacted by us', 'Retained'], datasets: [{ data: [funnel.leads, funnel.contacted, funnel.retained], backgroundColor: COLORS[0] }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, onClick: onBar((i) => {
      const step = ['leads', 'contacted', 'retained'][i];
      openDrill(`Leads: ${['new', 'contacted by us', 'retained'][i]}`, 'leads', { step });
    }) },
  });
  chart('chart-reasons', {
    type: 'bar',
    data: { labels: lost.byReason.map((r) => REASON_LABELS[r.reason_bucket] ?? r.reason_bucket), datasets: [{ data: lost.byReason.map((r) => r.people), backgroundColor: COLORS[1] }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, onClick: onBar((i) => {
      const r = lost.byReason[i].reason_bucket;
      openDrill(`Leads lost: ${REASON_LABELS[r] ?? r}`, 'lost', { reason: r });
    }) },
  });
  chart('chart-sources', {
    type: 'bar',
    data: {
      labels: lost.bySource.map((r) => r.source),
      datasets: Object.keys(LOSS_LABELS).map((k, i) => ({ label: LOSS_LABELS[k], data: lost.bySource.map((r) => r[k]), backgroundColor: COLORS[i] })),
    },
    options: { scales: { x: { stacked: true }, y: { stacked: true } }, onClick: onBar((i, d) => {
      const type = Object.keys(LOSS_LABELS)[d], source = lost.bySource[i].source;
      openDrill(`${LOSS_LABELS[type]}: ${source}`, 'lost', { loss_type: type, source });
    }) },
  });

  table('people-table', [
    { label: 'Name', cell: (r) => el('button', { type: 'button', class: 'person', 'data-id': r.person_id }, r.display_name || '(no name)') },
    { label: 'Phone', cell: (r) => r.primary_phone },
    { label: 'What happened', cell: (r) => LOSS_LABELS[r.loss_type] + (r.failed_inbound ? ` (${r.failed_inbound} call${r.failed_inbound > 1 ? 's' : ''})` : '') },
    { label: 'Lead source', cell: (r) => r.source },
    { label: 'Waiting', num: true, cell: (r) => waiting(r.hours_waiting) },
    { label: 'Est. value', num: true, cell: (r) => (r.estimated_value ? usd.format(r.estimated_value) : '—') },
    { label: '', cell: (r) => (r.shared_phone ? el('span', { class: 'flag' }, 'shared number') : '') },
  ], people, 'Nobody waiting for these filters.');
}

function drawTeam(summary, employees) {
  const { calls } = summary;
  tiles('team-tiles', [
    [pct(calls.answered, calls.inbound), `of ${int.format(calls.inbound)} inbound calls answered by a person`, false, ['Calls answered by a person', 'calls', { handled_by: 'employee' }]],
    [int.format(calls.answering_service), 'forwarded to the answering service', false, ['Calls forwarded to the answering service', 'calls', { handled_by: 'answering_service' }]],
    [int.format(calls.missed), 'rang out with no answer', true, ['Calls that rang out', 'calls', { handled_by: 'missed' }]],
    [int.format(calls.voicemail), 'went to voicemail', false, ['Calls that went to voicemail', 'calls', { handled_by: 'voicemail' }]],
  ]);

  chart('chart-employees', {
    type: 'bar',
    data: {
      labels: employees.map((e) => e.name),
      datasets: [
        { label: 'Answered', data: employees.map((e) => e.accepted), backgroundColor: COLORS[3] },
        { label: 'Rang out', data: employees.map((e) => e.missed), backgroundColor: COLORS[1] },
      ],
    },
    options: { scales: { x: { stacked: true }, y: { stacked: true } }, onClick: onBar((i, d) => drillEmployee(employees[i], d === 0 ? 'accepted' : 'missed')) },
  });

  table('employee-table', [
    { label: 'Employee', cell: (e) => e.name },
    { label: 'Calls rung', num: true, cell: (e) => drillLink(int.format(e.rung), e.rung, () => drillEmployee(e, 'rung')) },
    { label: 'Answered', num: true, cell: (e) => drillLink(int.format(e.accepted), e.accepted, () => drillEmployee(e, 'accepted')) },
    { label: 'Rang out', num: true, cell: (e) => drillLink(int.format(e.missed), e.missed, () => drillEmployee(e, 'missed')) },
    { label: 'Answer rate', num: true, cell: (e) => el('span', { class: e.rung && e.accepted / e.rung < 0.6 ? 'bad' : '' }, pct(e.accepted, e.rung)) },
    { label: 'Rung first', num: true, cell: (e) => `${int.format(e.first_rung)} (${pct(e.first_rung_accepted, e.first_rung)} answered)` },
    { label: 'Talk time (min)', num: true, cell: (e) => int.format(e.talk_minutes) },
    { label: 'Calls made', num: true, cell: (e) => `${int.format(e.outbound)} (${int.format(e.connected)} connected)` },
    { label: 'Call-backs in 24 h', num: true, cell: (e) => (e.callbacks ? `${e.within_24h} of ${e.callbacks}` : '—') },
    { label: 'Median call-back (h)', num: true, cell: (e) => e.median_hours ?? '—' },
  ], employees, 'No intake employees match.');

  const idle = employees.filter((e) => e.rung === 0 && e.outbound > 0).map((e) => e.name);
  document.getElementById('team-note').textContent =
    (idle.length ? `${idle.join(', ')} ${idle.length > 1 ? 'were' : 'was'} not rung on any inbound call in this period but made outbound calls. ` : '') +
    'A call-back counts when the person was the first employee to call or speak to the caller after a call that was not answered by a person.';
}

// ---- heatmap ----------------------------------------------------------------------------------------------------------

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`));

/** Weekday x hour grid. Colour = share of calls in that slot no person answered; text = how many failed. */
function drawHeatmap(rows) {
  const by = new Map(rows.map((r) => [`${r.dow}-${r.hour}`, r]));
  const hours = [...new Set(rows.map((r) => r.hour))];
  const lo = rows.length ? Math.min(...hours, 7) : 7, hi = rows.length ? Math.max(...hours, 18) : 18;
  const range = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const t = document.getElementById('heatmap');
  const head = el('tr', {}, el('th', {}, ''), range.map((h) => el('th', {}, HOUR_LABELS[h])));
  const body = DAYS.map(([dow, name]) => el('tr', {}, el('th', {}, name), range.map((h) => {
    const r = by.get(`${dow}-${h}`);
    const open = dow >= 1 && dow <= 5 && h >= 8 && h < 18;
    const td = el('td', { class: open ? 'cell' : 'cell off' }, r ? r.failed : '');
    if (r) {
      td.title = `${name} ${HOUR_LABELS[h]}: ${r.failed} of ${r.inbound} calls not answered by a person`;
      td.classList.add('drill');
      td.addEventListener('click', () => openDrill(`Unanswered calls: ${name} ${HOUR_LABELS[h]}`, 'calls', { handled_by: 'failed', dow, hour: h }));
      td.style.background = `color-mix(in srgb, var(--bad) ${Math.round((r.failed / r.inbound) * 85)}%, transparent)`;
    }
    return td;
  })));
  t.replaceChildren(el('thead', {}, head), el('tbody', {}, body));
}

// ---- drill-down: the records behind a number ----------------------------------------------------------------------------

// Which filters each kind of list obeys, matching the number it explains (the call totals ignore source and stage, and so on).
const DRILL_FILTERS = { calls: ['from', 'to', 'hours'], lost: ['from', 'to', 'stage', 'source'], leads: ['from', 'to', 'stage', 'source'] };
const HANDLED_LABELS = { employee: 'Answered', answering_service: 'Answering service', missed: 'Rang out', voicemail: 'Voicemail' };

const personButton = (r) => (r.person_id ? el('button', { type: 'button', class: 'person', 'data-id': r.person_id }, r.display_name || '(no name)') : '(unknown caller)');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium' }) : '—');

const DRILL_COLUMNS = {
  calls: [
    { label: 'When (Chicago)', cell: (r) => when(r.occurred_at) },
    { label: 'Caller', cell: personButton },
    { label: 'Phone', cell: (r) => r.primary_phone ?? '—' },
    { label: 'What happened', cell: (r) => HANDLED_LABELS[r.handled_by] ?? r.handled_by },
    { label: 'Person at the firm', cell: (r) => r.employee_name ?? '—' },
    { label: 'Secs', num: true, cell: (r) => r.duration_s ?? '—' },
    { label: 'After hours', cell: (r) => (r.office_hours ? '' : 'yes') },
  ],
  lost: [
    { label: 'Name', cell: personButton },
    { label: 'Phone', cell: (r) => r.primary_phone },
    { label: 'What happened', cell: (r) => LOSS_LABELS[r.loss_type] + (r.reason_bucket ? ` (${REASON_LABELS[r.reason_bucket]})` : '') },
    { label: 'Lead source', cell: (r) => r.source },
    { label: 'Waiting', num: true, cell: (r) => waiting(r.hours_waiting) },
    { label: 'Est. value', num: true, cell: (r) => (r.estimated_value ? usd.format(r.estimated_value) : '—') },
    { label: '', cell: (r) => (r.shared_phone ? el('span', { class: 'flag' }, 'shared number') : '') },
  ],
  leads: [
    { label: 'Name', cell: personButton },
    { label: 'Phone', cell: (r) => r.primary_phone },
    { label: 'Lead created', cell: (r) => day(r.lead_created_at) },
    { label: 'Status', cell: (r) => r.status_name ?? '—' },
    { label: 'Lead source', cell: (r) => r.source },
    { label: 'Employee contacts', num: true, cell: (r) => r.employee_touches + r.outbound_attempts },
    { label: 'Est. value', num: true, cell: (r) => (r.estimated_value ? usd.format(r.estimated_value) : '—') },
  ],
};

/** A number in a table that opens its records when clicked; zero stays plain text. */
function drillLink(text, count, open) {
  if (!count) return text;
  const b = el('button', { type: 'button', class: 'link', title: 'Show these calls' }, text);
  b.addEventListener('click', open);
  return b;
}

const drillEmployee = (e, leg) => openDrill(`${e.name}: calls ${{ rung: 'rung', accepted: 'answered', missed: 'that rang out' }[leg]}`, 'calls', { employee: e.employee_id, leg });

/** Lists the records behind one number. `extra` adds to (or overrides) the current filters; the list obeys the same filters as the number. */
async function openDrill(title, kind, extra = {}) {
  const dlg = document.getElementById('drill');
  const q = new URLSearchParams(queryString(DRILL_FILTERS[kind]));
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  try {
    const data = await api(`drill/${kind}`, q.toString());
    document.getElementById('drill-title').textContent = title;
    document.getElementById('drill-meta').textContent =
      `${data.range.from} to ${data.range.to} (Chicago days). ` + (data.total > data.rows.length ? `Showing the newest ${int.format(data.rows.length)} of ${int.format(data.total)}.` : `${int.format(data.total)} in total.`);
    table('drill-table', DRILL_COLUMNS[kind], data.rows, 'Nothing here for these filters.');
    if (!dlg.open) dlg.showModal();
  } catch (err) {
    const error = document.getElementById('error');
    error.textContent = err.message;
    error.hidden = false;
  }
}

document.getElementById('drill-table').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-id]');
  if (b) openPerson(b.dataset.id);
});
document.getElementById('drill-close').addEventListener('click', () => document.getElementById('drill').close());

// ---- one person ---------------------------------------------------------------------------------------------------------

const KIND_LABELS = { call_in: 'Inbound call', call_out: 'Outbound call', voicemail: 'Voicemail', form: 'Web form', lead_created: 'Lead created', matter_opened: 'Matter opened', ad_charge: 'Google ad charge', message: 'Answering-service message' };
const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });

async function openPerson(id) {
  const dlg = document.getElementById('person');
  try {
    const res = await fetch(`/api/dashboard/people/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
    const { person, events, links } = await res.json();
    document.getElementById('person-name').textContent = person.display_name || '(no name)';
    document.getElementById('person-meta').textContent =
      `${person.primary_phone} · ${person.stage}${person.shared_phone ? ' · shared number (several names)' : ''}${person.is_automated ? ' · automated caller' : ''}`;
    table('person-events', [
      { label: 'When (Chicago)', cell: (e) => when(e.occurred_at) },
      { label: 'What', cell: (e) => KIND_LABELS[e.kind] ?? e.kind },
      { label: 'Result', cell: (e) => [e.handled_by, e.outcome].filter(Boolean).join(' / ') || '—' },
      { label: 'Person at the firm', cell: (e) => e.employee ?? '—' },
      { label: 'Channel', cell: (e) => e.channel ?? '—' },
      { label: 'Secs', num: true, cell: (e) => e.duration_s ?? '—' },
      { label: 'After hours', cell: (e) => (e.office_hours ? '' : 'yes') },
    ], events, 'No events.');
    table('person-links', [
      { label: 'Source', cell: (l) => l.source_table.replace(/^raw_/, '') },
      { label: 'Matched by', cell: (l) => l.method },
      { label: 'Confidence', num: true, cell: (l) => l.confidence },
      { label: 'Reason', cell: (l) => l.reason },
      { label: 'Name in that system', cell: (l) => l.name_seen ?? '—' },
    ], links, 'No links.');
    dlg.showModal();
  } catch (err) {
    const error = document.getElementById('error');
    error.textContent = err.message;
    error.hidden = false;
  }
}

document.getElementById('people-table').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-id]');
  if (b) openPerson(b.dataset.id);
});
document.getElementById('person-close').addEventListener('click', () => document.getElementById('person').close());

// ---- reset ---------------------------------------------------------------------------------------------------------------

/** Back to the defaults: month to date, everyone, all sources, all statuses, any time of day. */
document.getElementById('reset').addEventListener('click', () => {
  form.reset();
  for (const name of FILTERS) form.elements[name].value = name === 'hours' ? 'any' : '';
  load();
});

// ---- start up ---------------------------------------------------------------------------------------------------------

document.querySelectorAll('nav [role=tab]').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('nav [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  document.getElementById('tab-missed').hidden = tab.dataset.tab !== 'missed';
  document.getElementById('tab-team').hidden = tab.dataset.tab !== 'team';
}));
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
form.addEventListener('change', load);

(async function start() {
  try {
    const f = await api('filters', '');
    const asOf = f.dataAsOf.rebuiltAt ? new Date(f.dataAsOf.rebuiltAt).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) : 'unknown';
    document.getElementById('asof').textContent = `Data rebuilt ${asOf} Chicago time. Times and dates are Chicago time.`;
    for (const e of f.employees.filter((x) => x.isIntake)) form.elements.employee.append(el('option', { value: e.id }, e.name));
    for (const s of f.sources) form.elements.source.append(el('option', { value: s }, s));
  } catch (err) {
    document.getElementById('asof').textContent = 'Could not load filters.';
  }
  readUrlIntoForm();
  load();
})();

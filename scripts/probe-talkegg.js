// Prototype: print the shape of TalkEgg CDR and voicemail responses (never prints credentials).
// Usage: node scripts/probe-talkegg.js [MM/DD/YYYY start] [MM/DD/YYYY end]
import './load-env.js';
import { TalkEggApiService } from '../src/integrations/talkegg/TalkEggApiService.js';

const api = new TalkEggApiService({ username: process.env.TALKEGG_USER, password: process.env.TALKEGG_PASS });
const show = (label, text) => {
  const lines = text.split('\n');
  console.log(`--- ${label}: ${text.length} chars, ${lines.length} lines`);
  console.log(lines.slice(0, 4).join('\n'));
};
const today = new Date();
const start = process.argv[2] ?? new Date(today - 3 * 864e5);
const end = process.argv[3] ?? today;
for (const format of ['csv', 'html']) {
  try { show(`cdr ${format}`, await api.getCdrText({ start, end, format })); } catch (e) { console.log(`cdr ${format} failed:`, e.message, e.body ?? ''); }
}
for (const box of [10, 100]) {
  try { show(`vm box ${box}`, await api.getVoicemailText(box)); } catch (e) { console.log(`vm ${box} failed:`, e.message, e.body ?? ''); }
}

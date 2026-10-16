// Prototype: look at the Mostlyanswered file area. Prints status, headers, a listing sample and the head of one file.
// Usage: node scripts/probe-mostlyanswered.js [path-relative-to-MOSTLY_ANSWERED_URL]   (never prints credentials)
import './load-env.js';
const base = process.env.MOSTLY_ANSWERED_URL;
const basic = 'Basic ' + Buffer.from(`${process.env.MOSTLY_ANSWERED_USER}:${process.env.MOSTLY_ANSWERED_PASS}`).toString('base64');
const target = new URL(process.argv[2] ?? '', base.endsWith('/') ? base : base + '/');
for (const [label, headers] of [['no auth', {}], ['basic auth', { Authorization: basic }]]) {
  const res = await fetch(target, { headers, redirect: 'manual' });
  const text = await res.text();
  console.log(`\n== GET ${target.pathname} (${label}) -> ${res.status}`);
  console.log('headers:', JSON.stringify(Object.fromEntries([...res.headers].filter(([k]) => /content-type|content-length|last-modified|location|www-auth|etag/i.test(k)))));
  console.log(text.slice(0, 1500));
  if (res.ok) break;
}

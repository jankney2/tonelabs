// Apply one of our own SQL files (sql/*.sql). Refuses anything that mentions the `ops` schema.
// Usage: npm run db:apply -- sql/001_hp_schema.sql
import './load-env.js';
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const file = process.argv[2];
if (!file) throw new Error('usage: apply-sql.js <file>');
const text = readFileSync(file, 'utf8');
const statements = text
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);
for (const s of statements) {
  if (/\bops\./i.test(s) || /\bschema\s+(if\s+not\s+exists\s+)?ops\b/i.test(s)) throw new Error(`Refusing: touches ops:\n${s}`);
  if (/\b(drop|truncate|delete|update)\b/i.test(s)) throw new Error(`Refusing destructive statement:\n${s}`);
}
const sql = neon(process.env.DATABASE_URL);
for (const s of statements) {
  await sql.query(s);
  console.log('ok:', s.split('\n')[0].slice(0, 80));
}

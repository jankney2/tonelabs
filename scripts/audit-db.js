// Read-only audit: lists tables with row counts and newest timestamp column.
// Never writes. Run: npm run audit
import './load-env.js';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const tables = await sql`
  SELECT table_schema, table_name FROM information_schema.tables
  WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')
  ORDER BY 1, 2`;

console.log(`Tables found: ${tables.length}`);
for (const { table_schema: s, table_name: t } of tables) {
  const [{ n }] = await sql.query(`SELECT count(*)::int AS n FROM "${s}"."${t}"`);
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = ${s} AND table_name = ${t}
      AND (data_type LIKE 'timestamp%' OR data_type = 'date')`;
  let newest = '';
  for (const { column_name: c } of cols) {
    const [{ m }] = await sql.query(`SELECT max("${c}") AS m FROM "${s}"."${t}"`);
    newest += ` ${c}=${m ? new Date(m).toISOString() : 'null'}`;
  }
  console.log(`${s}.${t}: ${n} rows;${newest || ' (no timestamp cols)'}`);
}

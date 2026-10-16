// Drizzle client over Neon's HTTP driver (works in Workers and Node).
// The `ops` schema is firm data: read it, never write to it. Our own tables go in other schemas/tables.
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as opsSchema from './ops-schema.js';

export function createDb(databaseUrl) {
  return drizzle(neon(databaseUrl), { schema: opsSchema });
}
export * from './ops-schema.js';

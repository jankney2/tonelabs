// Our own tables, schema `hp`. Mirrors sql/001_hp_schema.sql (the SQL file is what creates them).
import { pgSchema, bigserial, text, uuid, integer, jsonb, timestamp, boolean } from 'drizzle-orm/pg-core';

export const hp = pgSchema('hp');

export const integrationLogs = hp.table('integration_logs', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  source: text().notNull(),
  runId: uuid('run_id'),
  event: text().notNull(),
  method: text(),
  path: text(),
  status: integer(),
  durationMs: integer('duration_ms'),
  message: text(),
  details: jsonb(),
});

export const rawRingsnitchCalls = hp.table('raw_ringsnitch_calls', {
  sourceId: text('source_id').primaryKey(),
  payload: jsonb().notNull(),
  contentHash: text('content_hash').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  notInLatestPull: boolean('not_in_latest_pull').notNull().default(false),
});

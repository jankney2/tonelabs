// Our own tables, schema `hp`. Mirrors sql/001_hp_schema.sql (the SQL file is what creates them).
import { pgSchema, bigserial, bigint, text, uuid, integer, jsonb, timestamp, boolean, numeric, unique } from 'drizzle-orm/pg-core';

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

export const rawRingsnitchCallsHistory = hp.table('raw_ringsnitch_calls_history', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  sourceId: text('source_id').notNull(),
  payload: jsonb().notNull(),
  contentHash: text('content_hash').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'string' }).notNull(),
  supersededAt: timestamp('superseded_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

// Trackers and users share the calls table shape (one row per id + a history table).
const rawTable = (name) => hp.table(name, {
  sourceId: text('source_id').primaryKey(),
  payload: jsonb().notNull(),
  contentHash: text('content_hash').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  notInLatestPull: boolean('not_in_latest_pull').notNull().default(false),
});
const historyTable = (name) => hp.table(name, {
  id: bigserial({ mode: 'number' }).primaryKey(),
  sourceId: text('source_id').notNull(),
  payload: jsonb().notNull(),
  contentHash: text('content_hash').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'string' }).notNull(),
  supersededAt: timestamp('superseded_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const rawRingsnitchTrackers = rawTable('raw_ringsnitch_trackers');
export const rawRingsnitchTrackersHistory = historyTable('raw_ringsnitch_trackers_history');
export const rawRingsnitchUsers = rawTable('raw_ringsnitch_users');
export const rawRingsnitchUsersHistory = historyTable('raw_ringsnitch_users_history');

// Jigglewire (sql/004_raw_jigglewire.sql): same shape again, one table per endpoint.
export const rawJigglewireCallLog = rawTable('raw_jigglewire_call_log');
export const rawJigglewireCallLogHistory = historyTable('raw_jigglewire_call_log_history');
export const rawJigglewireExtensions = rawTable('raw_jigglewire_extensions');
export const rawJigglewireExtensionsHistory = historyTable('raw_jigglewire_extensions_history');
export const rawJigglewireVoicemails = rawTable('raw_jigglewire_voicemails');
export const rawJigglewireVoicemailsHistory = historyTable('raw_jigglewire_voicemails_history');
export const rawJigglewireQueuePresence = rawTable('raw_jigglewire_queue_presence');
export const rawJigglewireQueuePresenceHistory = historyTable('raw_jigglewire_queue_presence_history');

// Lawllama (sql/005_raw_lawllama.sql): one table per endpoint. Contacts never hold SSN/date of birth/immigration status.
export const rawLawllamaLeads = rawTable('raw_lawllama_leads');
export const rawLawllamaLeadsHistory = historyTable('raw_lawllama_leads_history');
export const rawLawllamaContacts = rawTable('raw_lawllama_contacts');
export const rawLawllamaContactsHistory = historyTable('raw_lawllama_contacts_history');
export const rawLawllamaLeadStatuses = rawTable('raw_lawllama_lead_statuses');
export const rawLawllamaLeadStatusesHistory = historyTable('raw_lawllama_lead_statuses_history');
export const rawLawllamaUsers = rawTable('raw_lawllama_users');
export const rawLawllamaUsersHistory = historyTable('raw_lawllama_users_history');

// Blankety (sql/006_raw_blankety.sql): one table per endpoint. Questions have source_id "<formId>:<qid>".
export const rawBlanketyForms = rawTable('raw_blankety_forms');
export const rawBlanketyFormsHistory = historyTable('raw_blankety_forms_history');
export const rawBlanketyQuestions = rawTable('raw_blankety_questions');
export const rawBlanketyQuestionsHistory = historyTable('raw_blankety_questions_history');
export const rawBlanketySubmissions = rawTable('raw_blankety_submissions');
export const rawBlanketySubmissionsHistory = historyTable('raw_blankety_submissions_history');

// Docketmonster (sql/007_raw_docketmonster.sql): matters, source_id = MatterNumber, payload = the SOAP Matter fields as strings.
export const rawDocketmonsterMatters = rawTable('raw_docketmonster_matters');
export const rawDocketmonsterMattersHistory = historyTable('raw_docketmonster_matters_history');

// Mostlyanswered (sql/010_raw_mostlyanswered.sql): daily CSV files (source_id = file name) and their message rows (source_id = "<file>:<row>").
export const rawMostlyansweredFiles = rawTable('raw_mostlyanswered_files');
export const rawMostlyansweredFilesHistory = historyTable('raw_mostlyanswered_files_history');
export const rawMostlyansweredMessages = rawTable('raw_mostlyanswered_messages');
export const rawMostlyansweredMessagesHistory = historyTable('raw_mostlyanswered_messages_history');

// Identity (sql/008_identity.sql): people by phone, links back to raw records, employees, one event timeline.
const ts = (name) => timestamp(name, { withTimezone: true, mode: 'string' });

export const people = hp.table('people', {
  personId: bigserial('person_id', { mode: 'number' }).primaryKey(),
  primaryPhone: text('primary_phone').notNull().unique(),
  displayName: text('display_name'),
  stage: text().notNull().default('caller'),
  firstContactAt: ts('first_contact_at'),
  lastContactAt: ts('last_contact_at'),
  isAutomated: boolean('is_automated').notNull().default(false),
  sharedPhone: boolean('shared_phone').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  modifiedAt: ts('modified_at').notNull().defaultNow(),
});

export const personLinks = hp.table('person_links', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  sourceTable: text('source_table').notNull(),
  sourceId: text('source_id').notNull(),
  personId: bigint('person_id', { mode: 'number' }).references(() => people.personId),
  method: text().notNull(),
  confidence: numeric({ precision: 3, scale: 2 }).notNull(),
  reason: text().notNull(),
  nameSeen: text('name_seen'),
  nameKey: text('name_key'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [unique().on(t.sourceTable, t.sourceId)]);

export const matchReview = hp.table('match_review', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  kind: text().notNull(),
  personId: bigint('person_id', { mode: 'number' }).references(() => people.personId),
  phone: text(),
  evidence: jsonb().notNull().default({}),
  resolved: boolean().notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const employees = hp.table('employees', {
  employeeId: bigserial('employee_id', { mode: 'number' }).primaryKey(),
  name: text().notNull(),
  role: text(),
  email: text().unique(),
  isIntake: boolean('is_intake').notNull().default(false),
  schedule: text(),
});

export const employeeIdentifiers = hp.table('employee_identifiers', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  employeeId: bigint('employee_id', { mode: 'number' }).notNull().references(() => employees.employeeId),
  system: text().notNull(),
  externalId: text('external_id').notNull(),
}, (t) => [unique().on(t.system, t.externalId)]);

export const contactEvents = hp.table('contact_events', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  sourceTable: text('source_table').notNull(),
  sourceId: text('source_id').notNull(),
  personId: bigint('person_id', { mode: 'number' }).references(() => people.personId),
  employeeId: bigint('employee_id', { mode: 'number' }).references(() => employees.employeeId),
  kind: text().notNull(),
  occurredAt: ts('occurred_at').notNull(),
  answered: boolean(),
  handledBy: text('handled_by'),
  outcome: text(),
  durationS: integer('duration_s'),
  channel: text(),
  officeHours: boolean('office_hours').notNull(),
  amountUsd: numeric('amount_usd'),
}, (t) => [unique().on(t.sourceTable, t.sourceId)]);

export const callLegs = hp.table('call_legs', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  eventId: bigint('event_id', { mode: 'number' }).notNull().references(() => contactEvents.id),
  ringOrder: integer('ring_order').notNull(),
  employeeId: bigint('employee_id', { mode: 'number' }).references(() => employees.employeeId),
  extension: text(),
  result: text(),
  durationS: integer('duration_s'),
}, (t) => [unique().on(t.eventId, t.ringOrder)]);

export const identityRuns = hp.table('identity_runs', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  status: text().notNull().default('running'),
  stats: jsonb(),
});

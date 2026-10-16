// Introspected from the live database with `npm run db:pull` (read-only). Never run migrations against `ops`.
import { pgTable, pgSchema, text, date, integer, timestamp, numeric } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const ops = pgSchema("ops");


export const staffInOps = ops.table("staff", {
	ext: text(),
	name: text(),
	email: text(),
	role: text(),
	startDate: date("start_date"),
	ringOrder: integer("ring_order"),
	schedule: text(),
	languages: text(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const marketingSpendInOps = ops.table("marketing_spend", {
	month: date(),
	trackerId: text("tracker_id"),
	trackingNumber: text("tracking_number"),
	channel: text(),
	lineItem: text("line_item"),
	spendUsd: numeric("spend_usd", { precision: 10, scale:  2 }),
	note: text(),
});

export const lsaChargesInOps = ops.table("lsa_charges", {
	leadId: text("lead_id"),
	leadReceivedAt: timestamp("lead_received_at", { withTimezone: true, mode: 'string' }),
	leadType: text("lead_type"),
	callerPhone: text("caller_phone"),
	category: text(),
	location: text(),
	chargeUsd: numeric("charge_usd", { precision: 8, scale:  2 }),
	chargeStatus: text("charge_status"),
	disputeStatus: text("dispute_status"),
});

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  date,
  numeric,
  index,
} from "drizzle-orm/pg-core";

export const callStatus = pgEnum("call_status", ["in_progress", "completed", "dropped"]);
export const callOrigin = pgEnum("call_origin", ["live", "simulation"]);
export const verdict = pgEnum("verdict", ["green", "amber", "red", "not_a_lead"]);
export const route = pgEnum("route", [
  "book", // green: book + designer handoff
  "book_with_note", // amber on budget/decision-maker/timeline: book, flag uncertainty
  "review", // amber on scope/area: front desk decides before a designer's time is spent
  "nurture", // not now, but likely later (e.g. "after Diwali", "just exploring")
  "close", // fails a criterion: declined gracefully on the call
  "escalate", // existing client complaint or urgent human need
  "log", // vendor, job seeker, wrong number, silent/dropped call
]);
export const bookingMode = pgEnum("booking_mode", ["site_visit", "studio", "video"]);
export const bookingStatus = pgEnum("booking_status", [
  "booked",
  "confirmed",
  "held", // post-call check disagreed with the in-call decision; awaiting front desk
  "reassigned",
  "cancelled",
  "completed",
  "no_show",
]);
export const dealStage = pgEnum("deal_stage", [
  "consult_booked",
  "consult_done",
  "proposal_sent",
  "won",
  "lost",
  "nurture",
]);
export const taskKind = pgEnum("task_kind", [
  "escalation", // complaint / urgent: callback promised
  "review", // amber on scope or area: front desk decides
  "booking_failed", // couldn't book on the call; front desk fixes a time
  "mismatch", // agent booked but the rules say no — booking held
  "unconfirmed", // designer hasn't confirmed in time
  "nurture_due", // follow-up date reached
  "guardrail", // agent said a price — must never happen
]);
export const costProvider = pgEnum("cost_provider", ["vaani", "gemini", "telephony", "other"]);

export const designers = pgTable("designers", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  telegramChatId: text(),
  calcomUserId: text(),
  // e.g. ["residential", "commercial"]; used to route commercial leads
  specialties: text().array().notNull().default([]),
  active: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const callers = pgTable("callers", {
  id: uuid().primaryKey().defaultRandom(),
  phone: text().notNull().unique(), // E.164
  name: text(),
  isExistingClient: boolean().notNull().default(false),
  lastSummary: text(), // so a repeat caller isn't asked everything again
  firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const calls = pgTable(
  "calls",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Vaani's id for the call; unique so a retried webhook never double-logs
    vaaniCallId: text().notNull().unique(),
    callerId: uuid().references(() => callers.id),
    origin: callOrigin().notNull().default("live"),
    status: callStatus().notNull().default("in_progress"),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    endedAt: timestamp({ withTimezone: true }),
    durationSec: integer(),
    afterHours: boolean().notNull().default(false), // outside 10am–7pm IST
    language: text(),
    transcript: text(),
    recordingUrl: text(),
    rawPayload: jsonb(),
    processAttempts: integer().notNull().default(0), // sweeper retries failed processing up to 3×
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.callerId), index().on(t.startedAt)],
);

export const qualifications = pgTable("qualifications", {
  id: uuid().primaryKey().defaultRandom(),
  callId: uuid()
    .notNull()
    .references(() => calls.id)
    .unique(),
  extracted: jsonb().notNull(), // structured fields from Gemini
  criteria: jsonb().notNull(), // per-criterion pass/fail/unclear with reasons
  verdict: verdict().notNull(),
  route: route().notNull(),
  flags: text().array().notNull().default([]),
  handoffNote: text(),
  estimatedValueInr: integer(), // internal only, never shown to callers
  agentBooked: boolean().notNull().default(false), // what the voice agent did on the call
  mismatch: boolean().notNull().default(false), // agent booked but rules say otherwise
  model: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const bookings = pgTable("bookings", {
  id: uuid().primaryKey().defaultRandom(),
  callId: uuid().references(() => calls.id),
  callerId: uuid()
    .notNull()
    .references(() => callers.id),
  designerId: uuid().references(() => designers.id),
  calcomBookingUid: text().unique(),
  startsAt: timestamp({ withTimezone: true }).notNull(),
  mode: bookingMode().notNull().default("studio"),
  status: bookingStatus().notNull().default("booked"),
  autoBooked: boolean().notNull().default(false), // booked after the call (no live tools), designer confirms time
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const handoffs = pgTable("handoffs", {
  id: uuid().primaryKey().defaultRandom(),
  qualificationId: uuid()
    .notNull()
    .references(() => qualifications.id),
  bookingId: uuid().references(() => bookings.id),
  designerId: uuid()
    .notNull()
    .references(() => designers.id),
  telegramMessageId: text(),
  messageHtml: text(), // kept so a reassign can resend the same brief
  sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  confirmBy: timestamp({ withTimezone: true }), // unconfirmed past this → front desk alert
  confirmedAt: timestamp({ withTimezone: true }),
  overdueAlertedAt: timestamp({ withTimezone: true }),
  reassignedAt: timestamp({ withTimezone: true }),
  leadQuality: text(), // "up" | "down" — designer feedback on the rubric
});

// One row per lead. Doubles as the HubSpot sync queue: hubspotSyncedAt null = pending.
export const deals = pgTable("deals", {
  id: uuid().primaryKey().defaultRandom(),
  callerId: uuid()
    .notNull()
    .references(() => callers.id),
  qualificationId: uuid().references(() => qualifications.id),
  stage: dealStage().notNull(),
  estimatedValueInr: integer(),
  source: text(), // instagram, referral, google, linkedin...
  referrer: text(),
  followUpOn: date(), // nurture leads
  lostReason: text(),
  hubspotDealId: text(),
  hubspotSyncedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Front-desk work queue: escalations, reviews, failed bookings, overdue confirmations.
export const escalations = pgTable("escalations", {
  id: uuid().primaryKey().defaultRandom(),
  kind: taskKind().notNull().default("escalation"),
  callId: uuid().references(() => calls.id),
  callerId: uuid().references(() => callers.id),
  reason: text().notNull(),
  priority: text().notNull().default("high"),
  owner: text(), // who is on it
  dueAt: timestamp({ withTimezone: true }).notNull(), // callback promised by
  resolvedAt: timestamp({ withTimezone: true }),
  lastAlertedAt: timestamp({ withTimezone: true }),
  notes: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const costs = pgTable(
  "costs",
  {
    id: uuid().primaryKey().defaultRandom(),
    callId: uuid().references(() => calls.id), // null for fixed costs (number rental etc.)
    provider: costProvider().notNull(),
    units: numeric().notNull(),
    unitLabel: text().notNull(), // "minutes", "tokens", "month"
    amountInr: numeric().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.occurredAt)],
);

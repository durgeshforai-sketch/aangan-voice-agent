import { and, eq, gte, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { callEvents, fetchCall, normaliseCall } from "./vaani";
import { processCall } from "./pipeline";
import { notifyFrontDesk, raiseTask } from "./alerts";
import { escapeHtml as e } from "./telegram";
import { formatIst, callbackDueAt } from "./hours";
import { upsertContact, upsertDeal } from "./hubspot";
import type { ExtractedLead } from "./lead";

// Runs every ~10 minutes (GitHub Actions → /api/cron/sweep). Each step is independent and idempotent.
export async function sweep() {
  const report: Record<string, number | string> = {};
  for (const [name, step] of Object.entries({ retryCalls, overdueHandoffs, overdueTasks, nurtureDue, syncHubspot })) {
    try {
      report[name] = await step();
    } catch (err) {
      console.error(`sweep ${name} failed`, err);
      report[name] = `error: ${String(err).slice(0, 200)}`;
    }
  }
  return report;
}

/** Calls whose processing failed after the webhook was acked. */
async function retryCalls() {
  const db = getDb();
  const now = Date.now();
  const stuck = await db
    .select({ id: schema.calls.vaaniCallId, raw: schema.calls.rawPayload })
    .from(schema.calls)
    .where(
      and(
        eq(schema.calls.origin, "live"),
        lt(schema.calls.processAttempts, 3),
        lt(schema.calls.createdAt, new Date(now - 3 * 60_000)),
        gte(schema.calls.createdAt, new Date(now - 2 * 24 * 3600_000)),
        notExists(db.select().from(schema.qualifications).where(eq(schema.qualifications.callId, schema.calls.id))),
        or(isNull(schema.calls.transcript), sql`length(${schema.calls.transcript}) >= 40`),
      ),
    )
    .limit(5);
  let n = 0;
  for (const c of stuck) {
    // Prefer the webhook payload we stored (agent webhooks carry the transcript); else ask Vaani's API
    const fromRaw = c.raw && typeof c.raw === "object"
      ? callEvents(c.raw as Record<string, unknown>).map((e) => normaliseCall(e.data, { callId: e.callId, endedAt: e.at })).find((x) => x?.vaaniCallId === c.id)
      : null;
    const full = fromRaw?.transcript ? fromRaw : await fetchCall(c.id);
    if (full) {
      await processCall(full, "live");
      n++;
    }
  }
  return n;
}

async function overdueHandoffs() {
  const db = getDb();
  const rows = await db
    .select({ h: schema.handoffs, d: schema.designers, q: schema.qualifications })
    .from(schema.handoffs)
    .innerJoin(schema.designers, eq(schema.designers.id, schema.handoffs.designerId))
    .innerJoin(schema.qualifications, eq(schema.qualifications.id, schema.handoffs.qualificationId))
    .where(and(lt(schema.handoffs.confirmBy, new Date()), isNull(schema.handoffs.confirmedAt), isNull(schema.handoffs.reassignedAt), isNull(schema.handoffs.overdueAlertedAt)));
  for (const r of rows) {
    const lead = r.q.extracted as ExtractedLead;
    await raiseTask({
      kind: "unconfirmed",
      reason: `${r.d.name} hasn't confirmed ${lead.name ?? "an enquiry"} (${lead.locality ?? "?"}). Call the designer or reassign.`,
      dueAt: callbackDueAt(new Date()),
      callId: r.q.callId,
      callUrl: `${process.env.APP_BASE_URL}/calls/${r.q.callId}`,
    });
    await db.update(schema.handoffs).set({ overdueAlertedAt: new Date() }).where(eq(schema.handoffs.id, r.h.id));
  }
  return rows.length;
}

/** Re-ping overdue front-desk tasks every 30 minutes until someone resolves them. */
async function overdueTasks() {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.escalations)
    .where(
      and(
        isNull(schema.escalations.resolvedAt),
        lt(schema.escalations.dueAt, now),
        or(isNull(schema.escalations.lastAlertedAt), lt(schema.escalations.lastAlertedAt, new Date(now.getTime() - 30 * 60_000))),
      ),
    );
  for (const t of rows) {
    await notifyFrontDesk(`⏰ <b>Overdue (${t.kind})</b> — was due ${formatIst(t.dueAt)}\n${e(t.reason.slice(0, 500))}`);
    await db.update(schema.escalations).set({ lastAlertedAt: now }).where(eq(schema.escalations.id, t.id));
  }
  return rows.length;
}

async function nurtureDue() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ d: schema.deals, c: schema.callers })
    .from(schema.deals)
    .innerJoin(schema.callers, eq(schema.callers.id, schema.deals.callerId))
    .where(and(eq(schema.deals.stage, "nurture"), lte(schema.deals.followUpOn, today)));
  for (const r of rows) {
    await raiseTask({
      kind: "nurture_due",
      reason: `Follow up with ${r.c.name ?? "caller"} (${r.c.phone}). Last time: ${r.c.lastSummary ?? "—"}`,
      dueAt: callbackDueAt(new Date()),
      callerId: r.c.id,
    });
    await db.update(schema.deals).set({ followUpOn: null, updatedAt: new Date() }).where(eq(schema.deals.id, r.d.id));
  }
  return rows.length;
}

async function syncHubspot() {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return "skipped (no token yet)";
  const db = getDb();
  const rows = await db
    .select({ d: schema.deals, c: schema.callers, q: schema.qualifications })
    .from(schema.deals)
    .innerJoin(schema.callers, eq(schema.callers.id, schema.deals.callerId))
    .leftJoin(schema.qualifications, eq(schema.qualifications.id, schema.deals.qualificationId))
    .where(isNull(schema.deals.hubspotSyncedAt))
    .limit(20);
  for (const r of rows) {
    const lead = r.q?.extracted as ExtractedLead | undefined;
    const contactId = await upsertContact({ phone: r.c.phone, name: r.c.name, locality: lead?.locality ?? null, source: r.d.source });
    const dealId = await upsertDeal({
      hubspotDealId: r.d.hubspotDealId,
      contactId,
      name: [r.c.name ?? "Enquiry", lead?.locality, lead?.bhk ? `${lead.bhk}BHK` : lead?.segment].filter(Boolean).join(" · "),
      stage: r.d.stage,
      amountInr: r.d.estimatedValueInr,
      verdict: r.q?.verdict ?? null,
      source: r.d.source,
      referrer: r.d.referrer,
      lostReason: r.d.lostReason,
      followUpOn: r.d.followUpOn,
    });
    await db.update(schema.deals).set({ hubspotDealId: dealId, hubspotSyncedAt: new Date() }).where(eq(schema.deals.id, r.d.id));
  }
  return rows.length;
}

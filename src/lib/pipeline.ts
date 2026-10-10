import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { NormalisedCall } from "./vaani";
import { extractFromTranscript, type Extraction } from "./extract";
import { qualify, type Qualification } from "./qualify";
import { estimatedValueInr } from "./estimate";
import { geminiCostInr, vaaniCostInr } from "./costs";
import { callbackDueAt, isStudioHours } from "./hours";
import { raiseTask } from "./alerts";
import { bookSlot, bookingConfigured, offerSlots } from "./booking";
import { leastLoaded } from "./designers";
import { handoffMessage, confirmButtons } from "./handoff";
import { sendMessage } from "./telegram";
import { normalisePhone } from "./phone";

export { normalisePhone };

// After every call: store → extract (Gemini) → decide (rules) → act (book / hand off / escalate / log).


const appUrl = (path: string) => `${process.env.APP_BASE_URL ?? "http://localhost:3000"}${path}`;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/** When a designer must confirm by: 2h in studio hours, otherwise noon next working day. */
const confirmDeadline = (from: Date) =>
  isStudioHours(from) ? new Date(from.getTime() + 2 * 3600_000) : new Date(callbackDueAt(from).getTime() + 90 * 60_000);

export type ProcessResult = { callId: string; skipped?: string; verdict?: string; route?: string };

export async function processCall(call: NormalisedCall, origin: "live" | "simulation" = "live"): Promise<ProcessResult> {
  const db = getDb();

  // 1. Store the call. Unique vaaniCallId makes webhook retries harmless; a re-run fills in fields.
  const fields = {
    origin,
    status: call.transcript ? ("completed" as const) : ("dropped" as const),
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    durationSec: call.durationSec,
    afterHours: !isStudioHours(call.startedAt),
    language: call.language,
    transcript: call.transcript,
    recordingUrl: call.recordingUrl,
    rawPayload: call.raw as object,
  };
  const [callRow] = await db
    .insert(schema.calls)
    .values({ vaaniCallId: call.vaaniCallId, ...fields, processAttempts: 1 })
    .onConflictDoUpdate({ target: schema.calls.vaaniCallId, set: { ...fields, processAttempts: sql`${schema.calls.processAttempts} + 1` } })
    .returning();
  const already = await db.select({ id: schema.qualifications.id }).from(schema.qualifications).where(eq(schema.qualifications.callId, callRow.id));
  if (already.length) return { callId: callRow.id, skipped: "already processed" };

  await db.delete(schema.costs).where(eq(schema.costs.callId, callRow.id)); // re-run: recompute, don't double count
  if (call.durationSec) {
    await db.insert(schema.costs).values({
      callId: callRow.id,
      provider: "vaani",
      units: String(call.durationSec / 60),
      unitLabel: "minutes",
      amountInr: String(call.costInr ?? vaaniCostInr(call.durationSec)),
      occurredAt: call.startedAt,
    });
  }

  // Too short to be a conversation (T08, T17's first attempt)
  if (!call.transcript || call.transcript.trim().length < 40) {
    await linkCaller(callRow.id, normalisePhone(call.fromPhone), null, null);
    return { callId: callRow.id, skipped: "no conversation" };
  }

  // 2. Extract facts
  const ex = await extractFromTranscript(call.transcript, call.startedAt);
  await db.insert(schema.costs).values({
    callId: callRow.id,
    provider: "gemini",
    units: String(ex.inputTokens + ex.outputTokens),
    unitLabel: "tokens",
    amountInr: String(geminiCostInr(ex.inputTokens, ex.outputTokens)),
    occurredAt: call.startedAt,
  });
  const x = ex.extraction;
  const phone = normalisePhone(x.callerPhoneSpoken) ?? normalisePhone(call.fromPhone);
  const caller = await linkCaller(callRow.id, phone, x.lead.name, x.summary);

  // 3. Decide
  const q = qualify(x.lead, call.startedAt);
  const value = estimatedValueInr(x.lead);
  const callUrl = appUrl(`/calls/${callRow.id}`);
  const label = `${x.lead.name ?? "Caller"}${phone ? ` · ${phone}` : ""}`;

  // A booking the agent made live through our tools during this call
  const liveBooking = caller
    ? (
        await db
          .select()
          .from(schema.bookings)
          .where(and(eq(schema.bookings.callerId, caller.id), isNull(schema.bookings.callId), gte(schema.bookings.createdAt, minutesAgo(90))))
          .orderBy(desc(schema.bookings.createdAt))
          .limit(1)
      )[0]
    : undefined;
  const bookable = q.route === "book" || q.route === "book_with_note";
  const mismatch = (x.agentBooked || !!liveBooking) && !bookable && q.route !== "review";

  const [qual] = await db
    .insert(schema.qualifications)
    .values({
      callId: callRow.id,
      extracted: x.lead,
      criteria: q.criteria ?? {},
      verdict: q.verdict,
      route: q.route,
      flags: q.flags,
      handoffNote: x.summary,
      estimatedValueInr: bookable || q.route === "nurture" ? value : null,
      agentBooked: x.agentBooked || !!liveBooking,
      mismatch,
      model: ex.model,
    })
    .returning();

  if (x.agentQuotedPrice) {
    await raiseTask({ kind: "guardrail", reason: "Extraction says the agent stated a price figure. Review the transcript and the agent prompt now.", dueAt: new Date(), callId: callRow.id, callerId: caller?.id, callerLabel: label, callUrl });
  }

  // 4. Act
  if (liveBooking) await db.update(schema.bookings).set({ callId: callRow.id }).where(eq(schema.bookings.id, liveBooking.id));

  if (mismatch) {
    if (liveBooking) await db.update(schema.bookings).set({ status: "held", updatedAt: new Date() }).where(eq(schema.bookings.id, liveBooking.id));
    await raiseTask({ kind: "mismatch", reason: `Booked on the call but rules say ${q.verdict}/${q.route}: ${failReasons(q)}`, dueAt: callbackDueAt(call.startedAt), callId: callRow.id, callerId: caller?.id, callerLabel: label, callUrl });
  } else if (bookable && caller) {
    await bookAndHandOff({ callId: callRow.id, caller, phone, x, q, value, liveBooking, callUrl, label, qualificationId: qual.id, at: call.startedAt });
  } else if (q.route === "review") {
    await raiseTask({ kind: "review", reason: `${x.summary}\nUnclear: ${unclearReasons(q)}`, dueAt: callbackDueAt(call.startedAt), callId: callRow.id, callerId: caller?.id, callerLabel: label, callUrl });
  } else if (q.route === "escalate") {
    const existing = caller
      ? await db.select().from(schema.escalations).where(and(eq(schema.escalations.callerId, caller.id), eq(schema.escalations.kind, "escalation"), gte(schema.escalations.createdAt, minutesAgo(90))))
      : [];
    if (existing.length) await db.update(schema.escalations).set({ callId: callRow.id, notes: x.summary }).where(eq(schema.escalations.id, existing[0].id));
    else await raiseTask({ kind: "escalation", reason: x.summary, dueAt: callbackDueAt(call.startedAt), callId: callRow.id, callerId: caller?.id, callerLabel: label, callUrl });
  } else if (q.route === "nurture" && caller) {
    const followUp = new Date(call.startedAt.getTime() + 35 * 24 * 3600_000).toISOString().slice(0, 10);
    await db.insert(schema.deals).values({ callerId: caller.id, qualificationId: qual.id, stage: "nurture", estimatedValueInr: value, source: x.lead.source, referrer: x.lead.referrerName, followUpOn: followUp });
  }
  // close / log: stored with reasons for the dashboard; nothing forwarded (qualified.md)

  return { callId: callRow.id, verdict: q.verdict, route: q.route };
}

async function linkCaller(callId: string, phone: string | null, name: string | null, summary: string | null) {
  if (!phone) return null;
  const db = getDb();
  const [caller] = await db
    .insert(schema.callers)
    .values({ phone, name, lastSummary: summary })
    .onConflictDoUpdate({ target: schema.callers.phone, set: { phone, ...(name ? { name } : {}), ...(summary ? { lastSummary: summary } : {}) } })
    .returning();
  await db.update(schema.calls).set({ callerId: caller.id }).where(eq(schema.calls.id, callId));
  return caller;
}

const failReasons = (q: Qualification) =>
  q.criteria ? Object.values(q.criteria).filter((c) => c.status === "fail").map((c) => c.reason).join("; ") || q.route : q.route;
const unclearReasons = (q: Qualification) =>
  q.criteria ? Object.values(q.criteria).filter((c) => c.status === "unclear").map((c) => c.reason).join("; ") : "";

async function bookAndHandOff(a: {
  callId: string;
  caller: typeof schema.callers.$inferSelect;
  phone: string | null;
  x: Extraction;
  q: Qualification;
  value: number;
  liveBooking: typeof schema.bookings.$inferSelect | undefined;
  callUrl: string;
  label: string;
  qualificationId: string;
  at: Date;
}) {
  const db = getDb();
  const mode = a.x.lead.consultPreference === "unspecified" ? "studio" : a.x.lead.consultPreference;
  let booking = a.liveBooking ?? null;
  let designer = booking?.designerId
    ? (await db.select().from(schema.designers).where(eq(schema.designers.id, booking.designerId)))[0] ?? null
    : null;

  const briefArgs = { lead: a.x.lead, q: a.q, summary: a.x.summary, phone: a.phone, estimatedValueInr: a.value, callUrl: a.callUrl };

  // No live booking (Vaani flow without tools, or the tool failed): book the first slot that fits
  // what the caller said. The full brief goes in the booking notes, so it reaches the consultant in
  // Cal.com's booking email. The consultant confirms the time with the client.
  if (!booking && bookingConfigured()) {
    try {
      // A site visit needs the site: wait for possession / move-out. A preferred *execution* start
      // ("January start") doesn't delay the first consultation.
      const later = mode === "site_visit" ? a.x.lead.siteAvailableFrom : null;
      const { slots } = await offerSlots(a.x.lead.availabilityNotes, 1, later);
      if (slots[0]) {
        const r = await bookSlot({
          start: slots[0].start,
          name: a.x.lead.name ?? "Aangan enquiry",
          phone: a.caller.phone,
          mode,
          segment: a.x.lead.segment,
          // Compact for Cal.com's notes limit; the full brief is behind the link
          notes: [
            "Auto-booked after the call: please call the client to confirm the time.",
            a.x.summary,
            a.q.flags.length ? `Flags: ${a.q.flags.join(", ").replaceAll("_", " ")}` : null,
          ].filter(Boolean).join("\n"),
          link: a.callUrl,
          callerId: a.caller.id,
          callId: a.callId,
          autoBooked: true,
        });
        if (r) [booking, designer] = [r.booking, r.designer];
      }
    } catch (err) {
      console.error("post-call booking failed", err);
    }
  }
  if (!booking) {
    await raiseTask({ kind: "booking_failed", reason: `Qualified (${a.q.verdict}) but no slot was booked. ${a.x.lead.availabilityNotes ?? ""}`, dueAt: callbackDueAt(a.at), callId: a.callId, callerId: a.caller.id, callerLabel: a.label, callUrl: a.callUrl });
  }
  designer ??= await leastLoaded(a.x.lead.segment);

  await db.insert(schema.deals).values({
    callerId: a.caller.id,
    qualificationId: a.qualificationId,
    stage: "consult_booked",
    estimatedValueInr: a.value,
    source: a.x.lead.source,
    referrer: a.x.lead.referrerName,
  });

  if (!designer) return; // no designers configured yet — the task above / dashboard still show it
  const [handoff] = await db
    .insert(schema.handoffs)
    .values({ qualificationId: a.qualificationId, bookingId: booking?.id, designerId: designer.id, confirmBy: confirmDeadline(a.at) })
    .returning();
  const text =
    handoffMessage({ ...briefArgs, bookingAt: booking?.startsAt ?? null, bookingMode: booking?.mode ?? null }) +
    (booking?.autoBooked ? "\n\n<i>Slot picked automatically after the call — please call the client to confirm it.</i>" : "");
  await db.update(schema.handoffs).set({ messageHtml: text }).where(eq(schema.handoffs.id, handoff.id));
  if (!designer.telegramChatId) return;
  try {
    const msg = await sendMessage(designer.telegramChatId, text, confirmButtons(handoff.id));
    await db.update(schema.handoffs).set({ telegramMessageId: String(msg.message_id) }).where(eq(schema.handoffs.id, handoff.id));
  } catch (err) {
    console.error("telegram handoff failed", err); // the sweeper flags it as unconfirmed later
  }
}

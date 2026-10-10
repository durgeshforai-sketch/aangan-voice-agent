import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { reassignBooking } from "./booking";
import { leastLoaded } from "./designers";

// What a consultant can do with a handoff — from the dashboard's call page (or Telegram buttons, if used).
// Each update re-queues the deal for HubSpot (hubspotSyncedAt = null).

export const OUTCOME_ACTIONS = ["confirm", "reassign", "done", "noShow", "proposal", "won", "lost", "good", "bad"] as const;
export type OutcomeAction = (typeof OUTCOME_ACTIONS)[number];

const STAGE_FOR: Partial<Record<OutcomeAction, (typeof schema.dealStage.enumValues)[number]>> = {
  done: "consult_done",
  proposal: "proposal_sent",
  won: "won",
  lost: "lost",
};

export type OutcomeResult = { ok: boolean; message: string; reassignedTo?: { handoffId: string; designer: typeof schema.designers.$inferSelect; slotKept: boolean } };

export async function applyOutcome(handoffId: string, action: OutcomeAction): Promise<OutcomeResult> {
  const db = getDb();
  const [h] = await db.select().from(schema.handoffs).where(eq(schema.handoffs.id, handoffId));
  if (!h) return { ok: false, message: "This enquiry no longer exists." };
  const now = new Date();
  const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.qualificationId, h.qualificationId));
  const setDeal = (v: Partial<typeof schema.deals.$inferInsert>) =>
    deal ? db.update(schema.deals).set({ ...v, updatedAt: now, hubspotSyncedAt: null }).where(eq(schema.deals.id, deal.id)) : null;
  const setBooking = (status: (typeof schema.bookingStatus.enumValues)[number]) =>
    h.bookingId ? db.update(schema.bookings).set({ status, updatedAt: now }).where(eq(schema.bookings.id, h.bookingId)) : null;

  switch (action) {
    case "confirm":
      await db.update(schema.handoffs).set({ confirmedAt: now }).where(eq(schema.handoffs.id, h.id));
      await setBooking("confirmed");
      return { ok: true, message: "Confirmed. Update the outcome after the consultation." };

    case "reassign": {
      const [q] = await db.select({ extracted: schema.qualifications.extracted }).from(schema.qualifications).where(eq(schema.qualifications.id, h.qualificationId));
      const segment = (q?.extracted as { segment?: string } | undefined)?.segment ?? "residential";
      let next = h.bookingId ? await reassignBooking(h.bookingId, segment).catch((err) => (console.error("reassign failed", err), null)) : null;
      next ??= await leastLoaded(segment, { exclude: h.designerId });
      if (!next || next.id === h.designerId) return { ok: false, message: "No other consultant is available — the front desk will help." };
      await db.update(schema.handoffs).set({ reassignedAt: now }).where(eq(schema.handoffs.id, h.id));
      const [b] = h.bookingId ? await db.select().from(schema.bookings).where(eq(schema.bookings.id, h.bookingId)) : [];
      const [nh] = await db
        .insert(schema.handoffs)
        .values({ qualificationId: h.qualificationId, bookingId: h.bookingId, designerId: next.id, confirmBy: new Date(now.getTime() + 2 * 3600_000), messageHtml: h.messageHtml })
        .returning();
      return { ok: true, message: `Passed to ${next.name}.`, reassignedTo: { handoffId: nh.id, designer: next, slotKept: b?.designerId === next.id } };
    }

    case "noShow":
      await setBooking("no_show");
      return { ok: true, message: "Marked as no-show." };

    case "done":
    case "proposal":
    case "won":
    case "lost":
      if (action === "done") await setBooking("completed");
      await setDeal({ stage: STAGE_FOR[action]!, ...(action === "lost" ? { lostReason: "Marked lost by consultant" } : {}) });
      return { ok: true, message: `Updated: ${STAGE_FOR[action]!.replace("_", " ")}.` };

    case "good":
    case "bad":
      await db.update(schema.handoffs).set({ leadQuality: action === "good" ? "up" : "down" }).where(eq(schema.handoffs.id, h.id));
      return { ok: true, message: "Thanks — this tunes which enquiries reach you." };
  }
}

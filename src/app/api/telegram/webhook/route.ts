import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { actionFromCode, answerCallback, editButtons, sendMessage, type Action } from "@/lib/telegram";
import { confirmButtons, outcomeButtons } from "@/lib/handoff";
import { reassignBooking } from "@/lib/booking";
import { leastLoaded } from "@/lib/designers";

// Designer taps in Telegram → bookings, deals (and so HubSpot) stay current with zero data entry.

type Update = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
};

const STAGE_FOR: Partial<Record<Action, (typeof schema.dealStage.enumValues)[number]>> = {
  done: "consult_done",
  proposal: "proposal_sent",
  won: "won",
  lost: "lost",
};

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new Response("unauthorised", { status: 401 });
  }
  const u = (await req.json()) as Update;

  // Onboarding: a designer sends /start and gets their chat id to paste into the designers table
  if (u.message?.text?.startsWith("/start")) {
    await sendMessage(String(u.message.chat.id), `Hi! Your Telegram chat id is <code>${u.message.chat.id}</code>. Share it with the studio admin to receive enquiry handoffs.`);
    return Response.json({ ok: true });
  }

  const cb = u.callback_query;
  if (!cb?.data || !cb.message) return Response.json({ ok: true });
  const [code, handoffId] = cb.data.split(":");
  const action = actionFromCode(code);
  if (!action || !handoffId) return Response.json({ ok: true });

  const db = getDb();
  const [h] = await db.select().from(schema.handoffs).where(eq(schema.handoffs.id, handoffId));
  if (!h) {
    await answerCallback(cb.id, "This enquiry no longer exists.");
    return Response.json({ ok: true });
  }
  const [designer] = await db.select().from(schema.designers).where(eq(schema.designers.id, h.designerId));
  if (String(cb.message.chat.id) !== designer?.telegramChatId) {
    await answerCallback(cb.id, "This enquiry is assigned to someone else.");
    return Response.json({ ok: true });
  }
  const chat = String(cb.message.chat.id);
  const msgId = cb.message.message_id;
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
      await editButtons(chat, msgId, outcomeButtons(h.id));
      await answerCallback(cb.id, "Confirmed. Update the outcome here after the consultation.");
      break;

    case "reassign": {
      const [q] = await db.select({ extracted: schema.qualifications.extracted }).from(schema.qualifications).where(eq(schema.qualifications.id, h.qualificationId));
      const segment = (q?.extracted as { segment?: string } | undefined)?.segment ?? "residential";
      // Move the calendar event to someone free at the same time; otherwise hand over without a slot
      let next = h.bookingId ? await reassignBooking(h.bookingId, segment).catch((err) => (console.error("reassign failed", err), null)) : null;
      next ??= await leastLoaded(segment, { exclude: h.designerId });
      if (!next || next.id === h.designerId) {
        await answerCallback(cb.id, "No other designer is available — the front desk will help.");
        break;
      }
      await db.update(schema.handoffs).set({ reassignedAt: now }).where(eq(schema.handoffs.id, h.id));
      const [b] = h.bookingId ? await db.select().from(schema.bookings).where(eq(schema.bookings.id, h.bookingId)) : [];
      const kept = b?.designerId === next.id; // the event moved with the lead
      const [nh] = await db
        .insert(schema.handoffs)
        .values({ qualificationId: h.qualificationId, bookingId: h.bookingId, designerId: next.id, confirmBy: new Date(now.getTime() + 2 * 3600_000), messageHtml: h.messageHtml })
        .returning();
      if (next.telegramChatId && h.messageHtml) {
        const note = kept ? "" : "\n<i>Nobody else was free at the booked time — please call the client to fix a new slot.</i>";
        const m = await sendMessage(next.telegramChatId, `↪️ <i>Reassigned to you by ${designer.name}</i>${note}\n\n${h.messageHtml}`, confirmButtons(nh.id));
        await db.update(schema.handoffs).set({ telegramMessageId: String(m.message_id) }).where(eq(schema.handoffs.id, nh.id));
      }
      await editButtons(chat, msgId, []);
      await answerCallback(cb.id, `Passed to ${next.name}.`);
      break;
    }

    case "noShow":
      await setBooking("no_show");
      await answerCallback(cb.id, "Marked as no-show.");
      break;

    case "done":
    case "proposal":
    case "won":
    case "lost":
      if (action === "done") await setBooking("completed");
      await setDeal({ stage: STAGE_FOR[action]!, ...(action === "lost" ? { lostReason: "Marked lost by designer" } : {}) });
      await answerCallback(cb.id, `Updated: ${STAGE_FOR[action]!.replace("_", " ")}.`);
      break;

    case "good":
    case "bad":
      await db.update(schema.handoffs).set({ leadQuality: action === "good" ? "up" : "down" }).where(eq(schema.handoffs.id, h.id));
      await answerCallback(cb.id, "Thanks — this tunes which enquiries reach you.");
      break;
  }
  return Response.json({ ok: true });
}

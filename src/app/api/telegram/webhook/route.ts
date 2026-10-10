import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { actionFromCode, answerCallback, editButtons, sendMessage } from "@/lib/telegram";
import { confirmButtons, outcomeButtons } from "@/lib/handoff";
import { applyOutcome } from "@/lib/outcomes";

// Optional channel: designer taps in Telegram → same outcomes as the dashboard buttons (src/lib/outcomes.ts).

type Update = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
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
  const r = await applyOutcome(h.id, action);
  if (action === "confirm" && r.ok) await editButtons(chat, cb.message.message_id, outcomeButtons(h.id));
  if (r.reassignedTo) {
    const { designer: next, handoffId, slotKept } = r.reassignedTo;
    if (next.telegramChatId && h.messageHtml) {
      const note = slotKept ? "" : "\n<i>Nobody else was free at the booked time — please call the client to fix a new slot.</i>";
      const m = await sendMessage(next.telegramChatId, `↪️ <i>Reassigned to you by ${designer.name}</i>${note}\n\n${h.messageHtml}`, confirmButtons(handoffId));
      await db.update(schema.handoffs).set({ telegramMessageId: String(m.message_id) }).where(eq(schema.handoffs.id, handoffId));
    }
    await editButtons(chat, cb.message.message_id, []);
  }
  await answerCallback(cb.id, r.message);
  return Response.json({ ok: true });
}

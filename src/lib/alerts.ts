import { getDb, schema } from "@/db";
import { sendMessage, escapeHtml as e } from "./telegram";
import { formatIst } from "./hours";

const TITLES: Record<string, string> = {
  escalation: "🚨 Escalation — callback promised",
  review: "🟠 Review needed before booking a designer",
  booking_failed: "📅 Couldn't book on the call — please fix a time",
  mismatch: "⚠️ Agent booked a lead the rules don't qualify — booking held",
  unconfirmed: "⏰ Designer hasn't confirmed a handoff",
  nurture_due: "🌱 Nurture follow-up due",
  guardrail: "🛑 GUARDRAIL: the agent may have quoted a price",
};

type Kind = (typeof schema.taskKind.enumValues)[number];

/** Creates a front-desk task and pings the escalation chat. Alerts never throw — the task row is the source of truth. */
export async function raiseTask(t: {
  kind: Kind;
  reason: string;
  dueAt: Date;
  callId?: string | null;
  callerId?: string | null;
  callerLabel?: string;
  callUrl?: string;
  priority?: "high" | "normal";
}) {
  const db = getDb();
  const [row] = await db
    .insert(schema.escalations)
    .values({
      kind: t.kind,
      reason: t.reason,
      dueAt: t.dueAt,
      callId: t.callId ?? null,
      callerId: t.callerId ?? null,
      priority: t.priority ?? (t.kind === "escalation" || t.kind === "guardrail" ? "high" : "normal"),
    })
    .returning();
  await notifyFrontDesk(
    [
      `<b>${TITLES[t.kind]}</b>`,
      t.callerLabel ? e(t.callerLabel) : null,
      e(t.reason),
      `Due: ${formatIst(t.dueAt)}`,
      t.callUrl ? `<a href="${t.callUrl}">Open call</a>` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return row;
}

export async function notifyFrontDesk(html: string) {
  const chat = process.env.TELEGRAM_ESCALATION_CHAT_ID;
  if (!chat) return;
  try {
    await sendMessage(chat, html);
  } catch (err) {
    console.error("front desk alert failed", err);
  }
}

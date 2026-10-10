import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { bookSlot, offerSlots } from "@/lib/booking";
import { callbackDueAt, formatIst, isStudioHours } from "@/lib/hours";
import { normalisePhone } from "@/lib/pipeline";
import { raiseTask } from "@/lib/alerts";

// Tools the voice agent calls DURING a live call (if the Vaani flow builder supports HTTP tools).
// Every response has `say`: a short line the agent can use as-is, plus structured fields.
// Contract is documented in docs/vaani-setup.md. Auth: x-aangan-tool-secret header.

export const maxDuration = 20;

type Args = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function authorised(req: Request) {
  const secret = process.env.VAANI_TOOL_SECRET;
  // Vaani custom tools let us set any header; accept "Authorization: Bearer …" or x-aangan-tool-secret
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const got = bearer || req.headers.get("x-aangan-tool-secret") || new URL(req.url).searchParams.get("key");
  if (!secret || !got) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  if (!authorised(req)) return Response.json({ error: "unauthorised" }, { status: 401 });
  const { tool } = await ctx.params;
  const text = req.method === "GET" ? "" : await req.text();
  let body: Args = {};
  try {
    body = text ? (JSON.parse(text) as Args) : {};
  } catch {
    body = Object.fromEntries(new URLSearchParams(text));
  }
  const nested = [body.args, body.arguments, body.parameters, body.params].find((v) => v && typeof v === "object") as Args | undefined;
  const args: Args = { ...Object.fromEntries(new URL(req.url).searchParams), ...body, ...nested };
  // Tool calls that never arrive were the main failure seen in Vaani tests — log arrivals (names only)
  console.log(`tool ${tool} called`, Object.keys(args));
  try {
    // One combined tool ("aangan_desk", action=…) so the Vaani console needs a single custom tool
    const name = tool === "desk" ? String(args.action ?? "").replace(/_/g, "-") : tool;
    switch (name) {
      case "lookup-caller":
        return Response.json(await lookupCaller(args));
      case "check-availability":
        return Response.json(await checkAvailability(args));
      case "book-consultation":
        return Response.json(await book(args));
      case "escalate":
        return Response.json(await escalate(args));
      default:
        return Response.json(
          { ok: false, error: `unknown tool ${name || tool}`, say: "Something went wrong on my side. Use action check_availability, book_consultation or escalate." },
          { status: tool === "desk" ? 200 : 404 },
        );
    }
  } catch (err) {
    console.error(`tool ${tool} failed`, err);
    // Never leave the agent without a line to say
    return Response.json({
      ok: false,
      say: "I'm having trouble with our calendar right now. I'll make sure the studio calls you back to confirm a time.",
    });
  }
}

async function lookupCaller(a: Args) {
  const phone = normalisePhone(s(a.phone));
  if (!phone) return { status: "new", say: null };
  const db = getDb();
  const [caller] = await db.select().from(schema.callers).where(eq(schema.callers.phone, phone));
  if (!caller) return { status: "new", say: null };
  if (caller.isExistingClient) {
    return { status: "existing_client", name: caller.name, say: `Caller is an existing client${caller.name ? ` (${caller.name})` : ""}. Listen, apologise if needed, and escalate.` };
  }
  return {
    status: "repeat_caller",
    name: caller.name,
    previous: caller.lastSummary,
    say: `They've called before. Previous notes: ${caller.lastSummary ?? "none"}. Greet them by name, don't re-ask what's known.`,
  };
}

async function checkAvailability(a: Args) {
  const { slots, matchedPreference } = await offerSlots(s(a.preference), 4, s(a.from_date));
  if (!slots.length) return { ok: false, slots: [], say: "No slots are open in the next ten days. Offer to have the studio call back with a time." };
  return {
    ok: true,
    slots,
    matchedPreference,
    say: `Offer these two: ${slots.slice(0, 2).map((x) => x.label).join(" or ")}.${matchedPreference ? "" : " Nothing matched their preference exactly — say so."}`,
  };
}

async function book(a: Args) {
  const start = s(a.start);
  const phone = normalisePhone(s(a.phone));
  const name = s(a.name) ?? "Aangan enquiry";
  const mode = (s(a.mode) as "site_visit" | "studio" | "video" | null) ?? "studio";
  if (!start || !phone) return { ok: false, say: "I need the slot and the caller's phone number to book." };
  const db = getDb();
  const [caller] = await db
    .insert(schema.callers)
    .values({ phone, name })
    .onConflictDoUpdate({ target: schema.callers.phone, set: { name } })
    .returning();
  // callId is attached after the call by the pipeline (Vaani's call id may not be known yet)
  // The call isn't finished yet, so the email links to this caller's calls; the full brief appears there after the call
  const notes = [s(a.notes), `Full brief, transcript + Confirm/outcome buttons (after the call): ${process.env.APP_BASE_URL}/calls?phone=${encodeURIComponent(phone)}`].filter(Boolean).join("\n");
  const r = await bookSlot({ start, name, phone, mode, address: s(a.address), segment: s(a.segment) ?? "residential", notes, callerId: caller.id });
  if (!r) {
    const { slots } = await offerSlots(null, 2);
    return {
      ok: false,
      slots,
      say: slots.length ? `That slot was just taken. Offer: ${slots.map((x) => x.label).join(" or ")}.` : "That slot was just taken. Say the studio will call to confirm a time.",
    };
  }
  const when = formatIst(r.booking.startsAt);
  return {
    ok: true,
    bookingId: r.booking.id,
    when,
    say: `Booked: ${when}, ${mode.replace("_", " ")}. Read it back to them, and tell them their designer will have everything they've shared.`,
  };
}

async function escalate(a: Args) {
  const phone = normalisePhone(s(a.phone));
  const db = getDb();
  const caller = phone
    ? (await db.insert(schema.callers).values({ phone, name: s(a.name) }).onConflictDoUpdate({ target: schema.callers.phone, set: { phone } }).returning())[0]
    : null;
  // Don't double-raise if the agent calls escalate twice on one call
  if (caller) {
    const recent = await db.select().from(schema.escalations)
      .where(and(eq(schema.escalations.callerId, caller.id), eq(schema.escalations.kind, "escalation"), gte(schema.escalations.createdAt, new Date(Date.now() - 30 * 60_000))))
      .orderBy(desc(schema.escalations.createdAt)).limit(1);
    if (recent[0]) return { ok: true, say: `Already flagged. Someone senior will call by ${formatIst(recent[0].dueAt)}.` };
  }
  const now = new Date();
  const due = callbackDueAt(now);
  await raiseTask({ kind: "escalation", reason: s(a.reason) ?? "Caller asked for a senior person", dueAt: due, callerId: caller?.id, callerLabel: `${s(a.name) ?? "Caller"}${phone ? ` · ${phone}` : ""}` });
  return {
    ok: true,
    callbackBy: due.toISOString(),
    say: isStudioHours(now)
      ? `Flagged as urgent. Someone senior will call within 15 minutes, by ${formatIst(due)}.`
      : `Flagged as urgent for the studio head. Someone senior will call by ${formatIst(due)}.`,
  };
}

export const POST = handle;
export const GET = handle;

import { createHmac, timingSafeEqual } from "node:crypto";

// Vaani Labs integration.
// Two webhook shapes exist and both are accepted:
//  - What agent webhooks really send (observed 10 Oct 2026 by another MESA team on the same platform):
//      header  x-webhook-signature: sha256=<hex HMAC of raw body>
//      body    { event, timestamp, events: [{ event: "call_postprocessing", call_id, timestamp,
//                data: { call_id, room_name, call_duration, end_reason, summary, entities, dispositions,
//                        recording_url, transcript: "Agent: …\nUser: …" } }] }
//  - What the public API docs describe: header X-VaaniVoice-Signature, body { id, type: "call.completed", data }.
// Fields aren't guaranteed, so everything reads several candidate keys. Chat tests in Vaani send no webhook.

const BASE = "https://www.vaanilabs.in";

/** The signature header in either format. */
export const signatureHeader = (h: Headers) => h.get("x-webhook-signature") ?? h.get("x-vaanivoice-signature");

export function verifySignature(rawBody: string, header: string | null, secret = process.env.VAANI_WEBHOOK_SECRET) {
  if (!secret || !header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

const CALL_DONE = new Set(["call_postprocessing", "call.completed", "call_completed", "call.failed"]);
export const isTestPing = (body: Record<string, unknown>) => /test|ping/i.test(String(body.event ?? body.type ?? ""));

export type CallEvent = { event: string; callId: string | null; at: Date | null; data: Record<string, unknown> };

/** Finished-call events from either envelope shape. Test pings and other events return []. */
export function callEvents(body: Record<string, unknown>): CallEvent[] {
  const toDate = (v: unknown) => (v == null ? null : date(v));
  if (Array.isArray(body.events)) {
    return (body.events as Record<string, unknown>[])
      .filter((e) => e && CALL_DONE.has(String(e.event)) && e.data && typeof e.data === "object")
      .map((e) => ({ event: String(e.event), callId: str(e.call_id), at: toDate(e.timestamp), data: e.data as Record<string, unknown> }));
  }
  const type = String(body.type ?? body.event ?? "");
  if (CALL_DONE.has(type) && body.data && typeof body.data === "object") {
    return [{ event: type, callId: null, at: toDate(body.created ?? body.timestamp), data: body.data as Record<string, unknown> }];
  }
  return [];
}

export type NormalisedCall = {
  vaaniCallId: string;
  fromPhone: string | null; // may be masked by Vaani; prefer the number confirmed on the call
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  transcript: string | null;
  recordingUrl: string | null;
  language: string | null;
  costInr: number | null;
  raw: unknown;
};

type Obj = Record<string, unknown>;
const pick = (o: Obj | undefined, ...keys: string[]): unknown => {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Obj)[part] : undefined), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && !isNaN(+v) ? +v : null);
const date = (v: unknown) => {
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};

/** Transcript can arrive as a string or as turns [{role|speaker, text|content|message}]. */
export function transcriptToText(t: unknown): string | null {
  if (typeof t === "string") {
    if (!t.trim()) return null;
    // Real calls: "[15:23:07] AGENT: …" / "[15:23:10] USER: …" → "Agent: …" / "Caller: …"
    return t
      .replace(/^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/gm, "")
      .replace(/^(AGENT|ASSISTANT|BOT)\s*:/gim, "Agent:")
      .replace(/^(USER|CUSTOMER|HUMAN|CALLER)\s*:/gim, "Caller:");
  }
  if (!Array.isArray(t)) return null;
  return t
    .map((turn: Obj) => {
      const who = str(pick(turn, "role", "speaker", "from")) ?? "";
      const text = str(pick(turn, "text", "content", "message", "transcript")) ?? "";
      const label = /agent|assistant|bot|ai/i.test(who) ? "Agent" : /user|caller|customer|human/i.test(who) ? "Caller" : who;
      return `${label}: ${text}`;
    })
    .join("\n");
}

export function normaliseCall(payload: Obj, fallback: { callId?: string | null; endedAt?: Date | null } = {}): NormalisedCall | null {
  const c = (pick(payload, "call", "data.call") as Obj | undefined) ?? payload;
  const id = str(pick(c, "call_id", "id", "callId", "session_id", "sid", "room_name")) ?? fallback.callId ?? null;
  if (!id) return null;
  const durationRaw = num(pick(c, "call_duration", "duration_sec", "duration_seconds", "duration", "units"));
  const endedAt = date(pick(c, "ended_at", "endedAt", "end_time")) ?? fallback.endedAt ?? null;
  const startedAt =
    date(pick(c, "started_at", "startedAt", "start_time", "call_start_time", "created_at")) ??
    (endedAt && durationRaw != null ? new Date(endedAt.getTime() - durationRaw * 1000) : endedAt) ??
    new Date();
  // Vaani reports fractional seconds (237.06); the column is an integer
  const duration = durationRaw != null ? Math.round(durationRaw) : endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : null;
  const paise = num(pick(c, "cost_paise", "costPaise"));
  return {
    vaaniCallId: id,
    fromPhone: str(pick(c, "from", "from_number", "caller", "caller_number", "caller_id", "customer_number", "customer_phone", "user_number", "phone_number", "phone", "customer.number")),
    startedAt,
    endedAt,
    durationSec: duration,
    transcript: transcriptToText(pick(c, "transcript", "transcript_text", "transcription", "messages", "conversation")),
    recordingUrl: str(pick(c, "recording_url", "recordingUrl", "recording", "recording.url", "audio_url")),
    language: str(pick(c, "language", "lang")),
    costInr: paise != null ? paise / 100 : num(pick(c, "cost_inr", "cost")),
    raw: payload,
  };
}

/** Fetch full call details (transcript, recording) — the webhook body may be thin. */
export async function fetchCall(callId: string): Promise<NormalisedCall | null> {
  const key = process.env.VAANI_API_KEY;
  if (!key) throw new Error("VAANI_API_KEY is not set");
  const res = await fetch(`${BASE}/api/calls/${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Vaani GET /api/calls/${callId} → ${res.status}`);
  return normaliseCall((await res.json()) as Obj);
}

/** Merge the webhook's fields with the fetched call; fetched wins where present. */
export function mergeCalls(a: NormalisedCall, b: NormalisedCall | null): NormalisedCall {
  if (!b) return a;
  const out = { ...a } as Record<string, unknown>;
  for (const [k, v] of Object.entries(b)) if (v !== null && v !== undefined) out[k] = v;
  return out as NormalisedCall;
}

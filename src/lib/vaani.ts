import { createHmac, timingSafeEqual } from "node:crypto";

// Vaani Labs integration. Documented: signed webhook envelope + GET /api/calls/{id}.
// The call payload's fields are NOT documented ("defensive-parse — no sub-field is guaranteed"),
// so everything below reads several candidate keys. Tighten once we've seen a real payload.

const BASE = "https://www.vaanilabs.in";

export function verifySignature(rawBody: string, header: string | null, secret = process.env.VAANI_WEBHOOK_SECRET) {
  if (!secret || !header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type VaaniEnvelope = { id: string; type: string; created: number; data: Record<string, unknown> };

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
  if (typeof t === "string") return t;
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

export function normaliseCall(payload: Obj): NormalisedCall | null {
  const c = (pick(payload, "call", "data.call", "data") as Obj | undefined) ?? payload;
  const id = str(pick(c, "id", "call_id", "callId", "session_id", "sid"));
  if (!id) return null;
  const startedAt = date(pick(c, "started_at", "startedAt", "start_time", "created_at")) ?? new Date();
  const endedAt = date(pick(c, "ended_at", "endedAt", "end_time"));
  const duration =
    num(pick(c, "duration_sec", "duration_seconds", "duration", "units")) ??
    (endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : null);
  const paise = num(pick(c, "cost_paise", "costPaise"));
  return {
    vaaniCallId: id,
    fromPhone: str(pick(c, "from", "from_number", "caller", "caller_number", "phone", "customer.number")),
    startedAt,
    endedAt,
    durationSec: duration,
    transcript: transcriptToText(pick(c, "transcript", "transcription", "messages", "conversation")),
    recordingUrl: str(pick(c, "recording_url", "recordingUrl", "recording", "recording.url")),
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

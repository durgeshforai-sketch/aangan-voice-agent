import { createSign } from "node:crypto";

// Google Calendar (free) as the booking engine. Each designer shares their calendar with our
// service account ("Make changes to events"). We read busy times, offer consultation slots inside
// studio consultation hours, and create the event on the chosen designer's calendar.
// No attendee invites are sent — callers rarely give an email on the phone.

const TZ = "Asia/Kolkata";
const API = "https://www.googleapis.com/calendar/v3";

type ServiceAccount = { client_email: string; private_key: string };
function serviceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json) as ServiceAccount;
}

let cached: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Google token → ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

async function g<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google Calendar ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// Consultation hours (IST). Override via env, e.g. CONSULT_DAYS=Mon,Tue,Wed,Thu,Fri,Sat
const num = (v: string | undefined, d: number) => (v ? Number(v) : d);
export const CONSULT = {
  days: (process.env.CONSULT_DAYS ?? "Mon,Tue,Wed,Thu,Fri,Sat").split(","),
  startHour: num(process.env.CONSULT_START_HOUR, 10),
  endHour: num(process.env.CONSULT_END_HOUR, 19), // last slot starts endHour - length
  minutes: num(process.env.CONSULT_MINUTES, 60),
  leadHours: num(process.env.CONSULT_LEAD_HOURS, 20), // earliest slot from now
};

export type Interval = { start: Date; end: Date };
export type Slot = { start: string; end: string; calendarIds: string[] };

export async function busyTimes(calendarIds: string[], from: Date, to: Date): Promise<Record<string, Interval[]>> {
  if (!calendarIds.length) return {};
  const body = await g<{ calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>("/freeBusy", {
    method: "POST",
    body: { timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: TZ, items: calendarIds.map((id) => ({ id })) },
  });
  const out: Record<string, Interval[]> = {};
  for (const id of calendarIds) {
    const cal = body.calendars[id];
    // A calendar we can't read (not shared yet) is treated as fully busy, never as free
    out[id] = cal?.errors?.length ? [{ start: from, end: to }] : (cal?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }
  return out;
}

const istParts = (d: Date) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return { weekday: get("weekday"), ymd: `${get("year")}-${get("month")}-${get("day")}` };
};

/** Candidate slot starts inside consultation hours. Pure — tested. */
export function candidateSlots(from: Date, days: number, c = CONSULT, now = new Date()): Interval[] {
  const out: Interval[] = [];
  const earliest = new Date(Math.max(from.getTime(), now.getTime() + c.leadHours * 3600_000));
  for (let i = 0; i <= days; i++) {
    const day = new Date(from.getTime() + i * 24 * 3600_000);
    const { weekday, ymd } = istParts(day);
    if (!c.days.includes(weekday)) continue;
    for (let m = c.startHour * 60; m + c.minutes <= c.endHour * 60; m += c.minutes) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const start = new Date(`${ymd}T${hh}:${mm}:00+05:30`);
      if (start < earliest) continue;
      out.push({ start, end: new Date(start.getTime() + c.minutes * 60_000) });
    }
  }
  return out;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Slots where at least one of the given calendars is free. Pure — tested. */
export function freeSlots(candidates: Interval[], busy: Record<string, Interval[]>): Slot[] {
  return candidates
    .map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      calendarIds: Object.keys(busy).filter((id) => !busy[id].some((b) => overlaps(s, b))),
    }))
    .filter((s) => s.calendarIds.length > 0);
}

export async function findSlots(calendarIds: string[], from = new Date(), days = 10): Promise<Slot[]> {
  const cands = candidateSlots(from, days);
  if (!cands.length) return [];
  const busy = await busyTimes(calendarIds, cands[0].start, cands[cands.length - 1].end);
  return freeSlots(cands, busy);
}

export async function isFree(calendarId: string, start: Date, end: Date) {
  const busy = await busyTimes([calendarId], start, end);
  return !busy[calendarId].some((b) => overlaps({ start, end }, b));
}

export async function createEvent(calendarId: string, e: { start: Date; end: Date; summary: string; description: string; location?: string | null; callId?: string }) {
  const ev = await g<{ id: string; htmlLink: string }>(`/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`, {
    method: "POST",
    body: {
      summary: e.summary,
      description: e.description,
      location: e.location ?? undefined,
      start: { dateTime: e.start.toISOString(), timeZone: TZ },
      end: { dateTime: e.end.toISOString(), timeZone: TZ },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
      extendedProperties: { private: { source: "aangan-voice-agent", ...(e.callId ? { callId: e.callId } : {}) } },
    },
  });
  return ev;
}

export async function deleteEvent(calendarId: string, eventId: string) {
  await g(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: "DELETE" });
}

export async function getEvent(calendarId: string, eventId: string) {
  return g<{ id: string; summary: string; description?: string; location?: string; start: { dateTime: string }; end: { dateTime: string } }>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
}

/** Pick slots that match what the caller said: weekday evening / weekend / morning etc. */
export function filterByPreference<T extends { start: string }>(slots: T[], pref: string | null | undefined): T[] {
  if (!pref) return slots;
  const p = pref.toLowerCase();
  const fmt = (s: T, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o }).format(new Date(s.start));
  return slots.filter((s) => {
    const wd = fmt(s, { weekday: "short" });
    const hr = Number(fmt(s, { hour: "numeric", hourCycle: "h23" }));
    const weekend = wd === "Sat" || wd === "Sun";
    if (/weekend|saturday|sunday|shanivar|ravivar/.test(p) && /evening|after\s*6|after 6pm/.test(p)) return weekend || hr >= 18; // W01
    if (/saturday|shanivar/.test(p) && !/sunday/.test(p)) return wd === "Sat" && (!/morning|subah/.test(p) || hr < 12);
    if (/weekend/.test(p)) return weekend;
    if (/evening|after\s*6|shaam/.test(p)) return hr >= 17;
    if (/morning|subah/.test(p)) return hr < 12;
    if (/afternoon|dopahar/.test(p)) return hr >= 12 && hr < 17;
    return true;
  });
}

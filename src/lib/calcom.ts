// Cal.com API v2 — team round-robin "Free consultation" event type.
const BASE = "https://api.cal.com/v2";
const TZ = "Asia/Kolkata";

function headers(version: string) {
  const key = process.env.CALCOM_API_KEY;
  if (!key) throw new Error("CALCOM_API_KEY is not set");
  return { Authorization: `Bearer ${key}`, "cal-api-version": version, "Content-Type": "application/json" };
}
const eventTypeId = () => {
  const id = Number(process.env.CALCOM_EVENT_TYPE_ID);
  if (!id) throw new Error("CALCOM_EVENT_TYPE_ID is not set");
  return id;
};

export type Slot = { start: string; end: string };

export async function getSlots(from: Date, to: Date): Promise<Slot[]> {
  const q = new URLSearchParams({
    eventTypeId: String(eventTypeId()),
    start: from.toISOString(),
    end: to.toISOString(),
    timeZone: TZ,
    format: "range",
  });
  const res = await fetch(`${BASE}/slots?${q}`, { headers: headers("2024-09-04"), cache: "no-store" });
  if (!res.ok) throw new Error(`Cal.com slots → ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data: Record<string, Slot[]> };
  return Object.values(body.data).flat();
}

export type Booking = {
  uid: string;
  start: string;
  end: string;
  status: string;
  hosts: { id: number; name: string; email: string }[];
};

export async function createBooking(input: {
  start: string;
  name: string;
  phone: string;
  email?: string | null;
  mode: "site_visit" | "studio" | "video";
  address?: string | null;
  notes?: string;
  metadata?: Record<string, string>;
}): Promise<Booking> {
  const res = await fetch(`${BASE}/bookings`, {
    method: "POST",
    headers: headers("2026-02-25"),
    body: JSON.stringify({
      start: new Date(input.start).toISOString(),
      eventTypeId: eventTypeId(),
      attendee: {
        name: input.name,
        // Cal.com requires an email; phone callers rarely give one reliably. Placeholder on a
        // reserved domain (.invalid) so nothing is ever delivered to a stranger.
        email: input.email || `${input.phone.replace(/\D/g, "")}@phone.aangan.invalid`,
        phoneNumber: input.phone,
        timeZone: TZ,
        language: "en",
      },
      location:
        input.mode === "site_visit" && input.address
          ? { type: "attendeeAddress", address: input.address }
          : undefined,
      bookingFieldsResponses: input.notes ? { notes: input.notes } : undefined,
      metadata: { mode: input.mode, ...input.metadata },
    }),
  });
  if (!res.ok) throw new Error(`Cal.com booking → ${res.status} ${await res.text()}`);
  return ((await res.json()) as { data: Booking }).data;
}

export async function reassignBooking(uid: string): Promise<Booking> {
  const res = await fetch(`${BASE}/bookings/${uid}/reassign`, { method: "POST", headers: headers("2024-08-13") });
  if (!res.ok) throw new Error(`Cal.com reassign → ${res.status} ${await res.text()}`);
  return ((await res.json()) as { data: Booking }).data;
}

/** Pick slots that match what the caller said: weekday evening / weekend / morning etc. */
export function filterByPreference(slots: Slot[], pref: string | null | undefined): Slot[] {
  if (!pref) return slots;
  const p = pref.toLowerCase();
  const fmt = (s: Slot, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o }).format(new Date(s.start));
  return slots.filter((s) => {
    const wd = fmt(s, { weekday: "short" });
    const hr = Number(fmt(s, { hour: "numeric", hourCycle: "h23" }));
    const weekend = wd === "Sat" || wd === "Sun";
    if (/weekend|saturday|sunday|shanivar|ravivar/.test(p) && /evening|after\s*6|after 6pm/.test(p))
      return weekend || hr >= 18; // "weekdays after 6pm or weekends" (W01)
    if (/saturday/.test(p) && !/sunday/.test(p)) return wd === "Sat" && (!/morning|subah/.test(p) || hr < 12);
    if (/weekend/.test(p)) return weekend;
    if (/evening|after\s*6/.test(p)) return hr >= 17;
    if (/morning|subah/.test(p)) return hr < 12;
    if (/afternoon/.test(p)) return hr >= 12 && hr < 17;
    return true;
  });
}

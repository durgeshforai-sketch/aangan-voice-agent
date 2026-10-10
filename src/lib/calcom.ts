// Cal.com API v2 — one free (individual) account with a "Free design consultation" event type.
// Every booking lands on that account's calendar; our backend decides which consultant it's for.
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
      // Address goes in the notes: a location type the event isn't configured for would reject the booking
      bookingFieldsResponses: {
        notes: [input.mode === "site_visit" ? `SITE VISIT${input.address ? `: ${input.address}` : ""}` : "Studio consultation", `Phone: ${input.phone}`, input.notes]
          .filter(Boolean)
          .join("\n"),
      },
      metadata: { mode: input.mode, ...input.metadata },
    }),
  });
  if (!res.ok) throw new Error(`Cal.com booking → ${res.status} ${await res.text()}`);
  return ((await res.json()) as { data: Booking }).data;
}

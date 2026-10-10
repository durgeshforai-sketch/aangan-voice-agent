import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { activeDesigners, leastLoaded, type Designer } from "./designers";
import { busyTimes, createEvent, deleteEvent, filterByPreference, findSlots, getEvent } from "./gcal";
import { formatIst } from "./hours";
import * as calcom from "./calcom";

// Booking: offer slots, assign a consultant fairly, move on reassign.
// BOOKING_PROVIDER=calcom (default): one free Cal.com account; the consultant is assigned on our side.
// BOOKING_PROVIDER=gcal: each designer's own Google Calendar; we pick whoever is free.

type Mode = (typeof schema.bookingMode.enumValues)[number];
const MODE_LABEL: Record<Mode, string> = { site_visit: "site visit", studio: "studio", video: "video call" };

const withCalendars = async () => (await activeDesigners()).filter((d) => d.calendarId);
export const provider = () => (process.env.BOOKING_PROVIDER === "gcal" ? "gcal" : "calcom");
export const bookingConfigured = () =>
  provider() === "gcal" ? !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON : !!(process.env.CALCOM_API_KEY && process.env.CALCOM_EVENT_TYPE_ID);

export async function offerSlots(preference: string | null | undefined, limit = 4, fromDate?: string | null) {
  // Callers often want a date weeks out (e.g. after possession). Start the 10-day window there.
  const parsed = fromDate ? new Date(`${fromDate.slice(0, 10)}T00:00:00+05:30`) : null;
  const from = parsed && !isNaN(parsed.getTime()) && parsed > new Date() ? parsed : new Date();
  let all: { start: string; end: string }[];
  if (provider() === "calcom") {
    const earliest = new Date(Math.max(from.getTime(), Date.now() + 20 * 3600_000));
    all = await calcom.getSlots(earliest, new Date(earliest.getTime() + 10 * 24 * 3600_000));
  } else {
    const team = await withCalendars();
    if (!team.length) return { slots: [], matchedPreference: false };
    all = await findSlots(team.map((d) => d.calendarId!), from);
  }
  const fitting = filterByPreference(all, preference);
  const chosen = (fitting.length ? fitting : all).slice(0, limit);
  return { slots: chosen.map((s) => ({ start: s.start, end: s.end, label: formatIst(new Date(s.start)) })), matchedPreference: fitting.length > 0 };
}

/** Designers whose calendars are free for [start, end). */
async function freeDesigners(start: Date, end: Date, team?: Designer[]) {
  const ds = team ?? (await withCalendars());
  const busy = await busyTimes(ds.map((d) => d.calendarId!), start, end);
  return ds.filter((d) => !(busy[d.calendarId!] ?? []).some((b) => b.start < end && start < b.end));
}

export async function bookSlot(input: {
  start: string;
  minutes?: number;
  name: string;
  phone: string;
  mode: Mode;
  address?: string | null;
  segment: string;
  notes?: string | null;
  callerId: string;
  callId?: string | null;
  autoBooked?: boolean;
}) {
  const start = new Date(input.start);
  const end = new Date(start.getTime() + (input.minutes ?? 60) * 60_000);

  if (provider() === "calcom") {
    const designer = await leastLoaded(input.segment);
    const b = await calcom.createBooking({
      start: input.start,
      name: input.name,
      phone: input.phone,
      mode: input.mode,
      address: input.address,
      notes: [designer ? `Consultant: ${designer.name}` : null, input.notes].filter(Boolean).join("\n"),
      metadata: { ...(input.callId ? { callId: input.callId } : {}), ...(designer ? { consultant: designer.name.slice(0, 40) } : {}) },
    });
    const [booking] = await getDb()
      .insert(schema.bookings)
      .values({ callId: input.callId ?? null, callerId: input.callerId, designerId: designer?.id, calendarEventId: b.uid, startsAt: new Date(b.start), mode: input.mode, autoBooked: input.autoBooked ?? false })
      .returning();
    return designer ? { booking, designer } : null;
  }

  const free = await freeDesigners(start, end);
  const designer = await leastLoaded(input.segment, { among: free.map((d) => d.id) });
  if (!designer?.calendarId) return null; // slot was taken meanwhile, or no calendars shared yet

  const ev = await createEvent(designer.calendarId, {
    start,
    end,
    summary: `Aangan consult · ${input.name} · ${MODE_LABEL[input.mode]}`,
    description: [
      `Free design consultation booked by Aanya (AI phone assistant).`,
      `Client: ${input.name} · ${input.phone}`,
      input.address ? `Site: ${input.address}` : null,
      input.notes ? `\n${input.notes}` : null,
      input.callId ? `\nCall: ${process.env.APP_BASE_URL}/calls/${input.callId}` : null,
      `\nFull brief is in Telegram. Please confirm there.`,
    ].filter(Boolean).join("\n"),
    location: input.mode === "site_visit" ? input.address : "Aangan Studio",
    callId: input.callId ?? undefined,
  });
  const [booking] = await getDb()
    .insert(schema.bookings)
    .values({
      callId: input.callId ?? null,
      callerId: input.callerId,
      designerId: designer.id,
      calendarEventId: ev.id,
      startsAt: start,
      mode: input.mode,
      autoBooked: input.autoBooked ?? false,
    })
    .returning();
  return { booking, designer };
}

/** Move a booking to another designer who is free at the same time. Null if nobody is. */
export async function reassignBooking(bookingId: string, segment: string) {
  const db = getDb();
  const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!b?.designerId) return null;
  const [from] = await db.select().from(schema.designers).where(eq(schema.designers.id, b.designerId));
  if (provider() === "calcom") {
    // One shared Cal.com calendar: the slot stays, only the consultant changes
    const to = await leastLoaded(segment, { exclude: b.designerId });
    if (!to) return null;
    await db.update(schema.bookings).set({ designerId: to.id, updatedAt: new Date() }).where(eq(schema.bookings.id, b.id));
    return to;
  }
  const end = new Date(b.startsAt.getTime() + 60 * 60_000);
  const free = (await freeDesigners(b.startsAt, end)).filter((d) => d.id !== b.designerId);
  const to = await leastLoaded(segment, { among: free.map((d) => d.id) });
  if (!to?.calendarId) return null;

  let summary = "Aangan consult";
  let description = "";
  let location: string | undefined;
  if (from?.calendarId && b.calendarEventId) {
    try {
      const old = await getEvent(from.calendarId, b.calendarEventId);
      summary = old.summary;
      description = old.description ?? "";
      location = old.location;
    } catch (err) {
      console.error("could not read original event", err);
    }
  }
  const ev = await createEvent(to.calendarId, { start: b.startsAt, end, summary, description: `↪️ Reassigned from ${from?.name ?? "another designer"}\n\n${description}`, location, callId: b.callId ?? undefined });
  if (from?.calendarId && b.calendarEventId) await deleteEvent(from.calendarId, b.calendarEventId).catch((err) => console.error("could not delete original event", err));
  await db.update(schema.bookings).set({ designerId: to.id, calendarEventId: ev.id, status: "booked", updatedAt: new Date() }).where(eq(schema.bookings.id, b.id));
  return to;
}

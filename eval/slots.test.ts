import { describe, expect, it } from "vitest";
import { candidateSlots, filterByPreference, freeSlots } from "../src/lib/gcal";

const C = { days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], startHour: 10, endHour: 19, minutes: 60, leadHours: 20 };
const ist = (s: string) => new Date(`${s}+05:30`);

describe("consultation slots", () => {
  // Fri 9 Oct 2026, 3pm IST
  const from = ist("2026-10-09T15:00:00");
  const cands = candidateSlots(from, 3, C, from);

  it("starts no earlier than the lead time and skips Sundays", () => {
    expect(cands[0].start.toISOString()).toBe(ist("2026-10-10T11:00:00").toISOString()); // Sat 11am (20h after Fri 3pm)
    expect(cands.some((s) => s.start.toISOString().startsWith("2026-10-11"))).toBe(false); // Sunday in IST
  });

  it("keeps slots inside 10:00–19:00 IST", () => {
    const hours = cands.map((s) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(s.start)));
    expect(Math.min(...hours)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...hours)).toBe(18); // last 60-min slot starts at 6pm
  });

  it("only offers a slot when some designer is free, and says who", () => {
    const busy = {
      a: [{ start: ist("2026-10-10T11:00:00"), end: ist("2026-10-10T13:00:00") }],
      b: [{ start: ist("2026-10-10T10:00:00"), end: ist("2026-10-10T12:00:00") }],
    };
    const slots = freeSlots(cands, busy);
    const at = (t: string) => slots.find((s) => s.start === ist(t).toISOString());
    expect(at("2026-10-10T11:00:00")).toBeUndefined(); // both busy
    expect(at("2026-10-10T12:00:00")?.calendarIds).toEqual(["b"]);
    expect(at("2026-10-10T13:00:00")?.calendarIds).toEqual(["a", "b"]);
  });

  it("matches caller preferences", () => {
    const slots = cands.map((s) => ({ start: s.start.toISOString() }));
    const evening = filterByPreference(slots, "weekdays after 6pm or weekends"); // W01
    expect(evening.every((s) => {
      const d = new Date(s.start);
      const wd = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" }).format(d);
      const hr = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(d));
      return wd === "Sat" || hr >= 18;
    })).toBe(true);
    const satMorning = filterByPreference(slots, "Koi bhi Saturday subah"); // W03
    expect(satMorning.length).toBeGreaterThan(0);
    expect(satMorning.every((s) => s.start.startsWith("2026-10-10") && new Date(s.start) < ist("2026-10-10T12:00:00"))).toBe(true);
  });
});

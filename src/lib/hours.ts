// Studio hours: 10am–7pm IST, Mon–Fri (W05: "we're closed over the weekend"). Used for after-hours stats and escalation behaviour.
const TZ = "Asia/Kolkata";
const WEEKEND = new Set(["Sat", "Sun"]);

function istParts(d: Date) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(d);
  return { hour: Number(p.find((x) => x.type === "hour")!.value), weekday: p.find((x) => x.type === "weekday")!.value };
}

export function isStudioHours(d: Date): boolean {
  const { hour, weekday } = istParts(d);
  return !WEEKEND.has(weekday) && hour >= 10 && hour < 19;
}

/** When a promised callback is due: 15 min in studio hours, otherwise 10:30am next working day. */
export function callbackDueAt(from: Date): Date {
  if (isStudioHours(from)) return new Date(from.getTime() + 15 * 60_000);
  const d = new Date(from);
  for (let i = 0; i < 80; i++) {
    const { hour, weekday } = istParts(d);
    if (!WEEKEND.has(weekday) && hour < 10) break;
    d.setTime(d.getTime() + 3600_000);
  }
  // d is now inside the IST hour before 10am on a working day; snap to 10:30 IST
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  return new Date(`${ymd}T10:30:00+05:30`);
}

export const formatIst = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);

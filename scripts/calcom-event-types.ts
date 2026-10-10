// Lists the Cal.com account's event types with their ids → pick one for CALCOM_EVENT_TYPE_ID.
//   npm run calcom:event-types
import { config } from "dotenv";
config({ path: ".env.local" });
const res = await fetch("https://api.cal.com/v2/event-types", {
  headers: { Authorization: `Bearer ${process.env.CALCOM_API_KEY}`, "cal-api-version": "2024-06-14" },
});
if (!res.ok) throw new Error(`Cal.com event-types → ${res.status} ${await res.text()}`);
const body = (await res.json()) as { data: { id: number; title: string; slug: string; lengthInMinutes?: number; length?: number }[] };
for (const e of body.data) console.log(String(e.id).padEnd(10), `${e.lengthInMinutes ?? e.length ?? "?"} min`.padEnd(8), e.title, `(${e.slug})`);

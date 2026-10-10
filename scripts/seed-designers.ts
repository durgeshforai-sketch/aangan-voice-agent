// Adds or updates designers from scripts/designers.json:
// [{ "name": "Aryan", "telegramChatId": "123", "calendarId": "aryan@gmail.com", "specialties": ["residential"] }]
// Each designer gets their chat id by sending /start to the bot.
//   npm run designers            (main branch)     DB_TARGET=test npm run designers
import { config } from "dotenv";
config({ path: ".env.local" });
if (process.env.DB_TARGET === "test") process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
const { readFileSync } = await import("node:fs");
const { eq } = await import("drizzle-orm");
const { getDb, schema } = await import("../src/db");

type D = { name: string; telegramChatId?: string; calendarId?: string; specialties?: string[]; active?: boolean };
const list = JSON.parse(readFileSync("scripts/designers.json", "utf8")) as D[];
const db = getDb();
for (const d of list) {
  const [existing] = await db.select().from(schema.designers).where(eq(schema.designers.name, d.name));
  const values = { name: d.name, telegramChatId: d.telegramChatId ?? null, calendarId: d.calendarId ?? null, specialties: d.specialties ?? ["residential"], active: d.active ?? true };
  if (existing) await db.update(schema.designers).set(values).where(eq(schema.designers.id, existing.id));
  else await db.insert(schema.designers).values(values);
  console.log(existing ? "updated" : "added", d.name);
}

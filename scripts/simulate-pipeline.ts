// Runs the 40 seed transcripts through the FULL post-call pipeline (store → Gemini → rules → tasks/deals)
// against the Neon TEST branch, as origin=simulation. Lets you see the dashboard populated end to end.
// Telegram / Google Calendar / HubSpot are switched off for this run so nobody gets pinged.
//   npm run simulate             (all)      npm run simulate -- T01 T09
import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.DATABASE_URL_TEST) throw new Error("Set DATABASE_URL_TEST (Neon test branch) first");
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
for (const k of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ESCALATION_CHAT_ID", "GOOGLE_SERVICE_ACCOUNT_JSON", "HUBSPOT_ACCESS_TOKEN"]) delete process.env[k];

const { readFileSync } = await import("node:fs");
const { seedCases } = await import("../eval/seed-cases");
const { processCall } = await import("../src/lib/pipeline");

const DURATION: Record<string, number> = { phone: 300, whatsapp: 280, form: 240 };
const only = process.argv.slice(2);
for (const c of seedCases.filter((x) => !only.length || only.includes(x.id))) {
  const transcript = readFileSync(`eval/transcripts/${c.id}.txt`, "utf8");
  const startedAt = new Date(c.receivedAt);
  const r = await processCall(
    {
      vaaniCallId: `sim-${c.id}`,
      fromPhone: `+9198220${c.id.replace(/\D/g, "").padStart(5, "1")}`,
      startedAt,
      endedAt: new Date(startedAt.getTime() + DURATION[c.channel] * 1000),
      durationSec: c.id === "T08" ? 4 : DURATION[c.channel],
      transcript: c.id === "T08" ? null : transcript,
      recordingUrl: null,
      language: c.facts.language,
      costInr: null,
      raw: { simulated: true, case: c.id },
    },
    "simulation",
  );
  console.log(c.id, r.skipped ?? `${r.verdict}/${r.route}`, `(expected ${c.expect.verdict}/${c.expect.route})`);
}

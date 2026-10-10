// Runs the 40 seed transcripts through the FULL post-call pipeline (store → Gemini → rules → tasks/deals)
// against the Neon TEST branch, as origin=simulation. Lets you see the dashboard populated end to end.
// Telegram / calendars / HubSpot are switched off for this run so nobody gets pinged.
//   npm run simulate             (all)      npm run simulate -- T01 T09      npm run simulate:main
import { config } from "dotenv";
config({ path: ".env.local" });
// Default: Neon test branch. SIM_TARGET=main loads the trial set into the production database
// (still origin=simulation, so it shows under "Show test calls" and never in live numbers).
if (process.env.SIM_TARGET !== "main") {
  if (!process.env.DATABASE_URL_TEST) throw new Error("Set DATABASE_URL_TEST (Neon test branch) first");
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
for (const k of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ESCALATION_CHAT_ID", "GOOGLE_SERVICE_ACCOUNT_JSON", "CALCOM_API_KEY", "HUBSPOT_ACCESS_TOKEN"]) delete process.env[k];

const { readFileSync } = await import("node:fs");
const { seedCases } = await import("../eval/seed-cases");
const { processCall } = await import("../src/lib/pipeline");

// A unique fake mobile per enquiry: T01 → +91 98221 00001, W01 → +91 98222 00001, F01 → +91 98223 00001
const simPhone = (id: string) => `+919822${{ T: 1, W: 2, F: 3 }[id[0] as "T" | "W" | "F"]}${id.slice(1).padStart(5, "0")}`;
const DURATION: Record<string, number> = { phone: 300, whatsapp: 280, form: 240 };
const only = process.argv.slice(2);
for (const c of seedCases.filter((x) => !only.length || only.includes(x.id))) {
  const transcript = readFileSync(`eval/transcripts/${c.id}.txt`, "utf8");
  const startedAt = new Date(c.receivedAt);
  const r = await processCall(
    {
      vaaniCallId: `sim-${c.id}`,
      fromPhone: simPhone(c.id),
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

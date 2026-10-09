// Creates the custom HubSpot properties we write (source, referrer, verdict, follow-up date)
// and prints the deal pipeline stages so HUBSPOT_STAGE_MAP can be set if needed.
//   npm run setup:hubspot
import { config } from "dotenv";
config({ path: ".env.local" });
const { ensureProperties } = await import("../src/lib/hubspot");
await ensureProperties();
const res = await fetch("https://api.hubapi.com/crm/v3/pipelines/deals", { headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` } });
const body = (await res.json()) as { results: { id: string; label: string; stages: { id: string; label: string }[] }[] };
for (const p of body.results) {
  console.log(`Pipeline "${p.label}" id=${p.id}`);
  for (const s of p.stages) console.log(`   ${s.id.padEnd(28)} ${s.label}`);
}
console.log("Custom properties ready.");

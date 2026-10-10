import { config } from "dotenv"; config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { seedCases } from "./eval/seed-cases";
import { extractFromTranscript } from "./src/lib/extract";
import { qualify } from "./src/lib/qualify";
for (const id of process.argv.slice(2)) {
  const c = seedCases.find((x) => x.id === id)!;
  const { extraction: x } = await extractFromTranscript(readFileSync(`eval/transcripts/${id}.txt`, "utf8"), new Date(c.receivedAt));
  const q = qualify(x.lead, new Date(c.receivedAt));
  const l = x.lead;
  console.log(`\n${id} → ${q.verdict}/${q.route}`, JSON.stringify({ callType: l.callType, complaint: l.complaint, frustrated: l.frustrated, readiness: l.readiness, completionNeededBy: l.completionNeededBy, siteAvailableFrom: l.siteAvailableFrom, flex: l.timelineFlexible, later: l.openToLaterStart, notes: l.timelineNotes, budget: [l.budgetMinLakh, l.budgetMaxLakh], scope: l.scopeLevel, rooms: l.roomsInScope }));
  for (const [k, r] of Object.entries(q.criteria ?? {})) if (r.status !== "pass") console.log(`   ${k}: ${r.status} — ${r.reason}`);
}

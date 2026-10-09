// Gemini extraction accuracy on the 40 real September transcripts.
//   npm run eval:extraction            (all)
//   npm run eval:extraction -- T02 F06 (some)
// For each enquiry: Gemini reads the transcript → our rules decide → compare with the labels in seed-cases.ts.
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { seedCases } from "./seed-cases";
import { extractFromTranscript } from "../src/lib/extract";
import { qualify } from "../src/lib/qualify";
import type { ExtractedLead } from "../src/lib/lead";

const FIELDS: (keyof ExtractedLead)[] = [
  "callType", "city", "segment", "scopeLevel", "wantsExecution", "decisionMaker",
  "budgetVolunteered", "askedAboutPricing", "mentionsFounderConnection", "consultPreference",
];

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

const only = process.argv.slice(2);
const cases = seedCases.filter((c) => !only.length || only.includes(c.id));

const results = await pool(cases, 4, async (c) => {
  const transcript = readFileSync(`eval/transcripts/${c.id}.txt`, "utf8");
  try {
    const { extraction, inputTokens, outputTokens } = await extractFromTranscript(transcript, new Date(c.receivedAt));
    const q = qualify(extraction.lead, new Date(c.receivedAt));
    const fieldMisses = FIELDS.filter((f) => JSON.stringify(extraction.lead[f]) !== JSON.stringify(c.facts[f]))
      .map((f) => `${f}: got ${JSON.stringify(extraction.lead[f])}, want ${JSON.stringify(c.facts[f])}`);
    return {
      id: c.id,
      verdictOk: q.verdict === c.expect.verdict,
      routeOk: q.route === c.expect.route,
      got: `${q.verdict}/${q.route}`,
      want: `${c.expect.verdict}/${c.expect.route}`,
      fieldMisses,
      quotedPrice: extraction.agentQuotedPrice,
      tokens: inputTokens + outputTokens,
    };
  } catch (err) {
    return { id: c.id, verdictOk: false, routeOk: false, got: `ERROR ${String(err).slice(0, 80)}`, want: "", fieldMisses: [], quotedPrice: false, tokens: 0 };
  }
});

let fieldTotal = 0;
for (const r of results) {
  fieldTotal += r.fieldMisses.length;
  const mark = r.routeOk ? "✓" : r.verdictOk ? "~" : "✗";
  console.log(`${mark} ${r.id.padEnd(4)} got ${r.got.padEnd(26)} want ${r.want}`);
  for (const m of r.fieldMisses) console.log(`      · ${m}`);
  if (r.quotedPrice) console.log("      · front desk flagged as quoting a price");
}
const n = results.length;
const routeAcc = results.filter((r) => r.routeOk).length;
const verdictAcc = results.filter((r) => r.verdictOk).length;
// The costly mistakes: a lead that should be declined gets booked, or a good lead gets declined
const bookable = (s: string) => s.endsWith("/book") || s.endsWith("/book_with_note");
const falseBook = results.filter((r) => bookable(r.got) && !bookable(r.want)).map((r) => r.id);
const falseDecline = results.filter((r) => r.got.endsWith("/close") && bookable(r.want)).map((r) => r.id);
console.log(`\nVerdict ${verdictAcc}/${n} · Route ${routeAcc}/${n} · Field mismatches ${fieldTotal} (${FIELDS.length * n} checked)`);
console.log(`Booked but shouldn't be: ${falseBook.join(", ") || "none"} · Declined but shouldn't be: ${falseDecline.join(", ") || "none"}`);
console.log(`Tokens used: ${results.reduce((a, r) => a + r.tokens, 0).toLocaleString()}`);
process.exit(falseBook.length || falseDecline.length ? 1 : 0);

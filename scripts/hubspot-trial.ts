// Pushes the trial set (test calls) into HubSpot, clearly labelled "[Test]", so the pipeline and
// Sales Dashboard have data to look at during the test stage. Real calls sync on their own (sweeper).
// Re-runnable: deals already pushed are updated, not duplicated. Remove them later by filtering "[Test]".
//   npm run hubspot:trial
import { config } from "dotenv";
config({ path: ".env.local" });
const { neon } = await import("@neondatabase/serverless");
const { upsertContact, upsertDeal } = await import("../src/lib/hubspot");
const sql = neon(process.env.DATABASE_URL!);

const rows = await sql`
  select d.id, d.stage, d.estimated_value_inr, d.source, d.referrer, d.follow_up_on, d.lost_reason, d.hubspot_deal_id,
         c.phone, c.name, q.verdict, q.extracted
  from deals d join callers c on c.id = d.caller_id
  join qualifications q on q.id = d.qualification_id join calls k on k.id = q.call_id
  where k.origin = 'simulation'
  order by k.started_at`;

let n = 0;
for (const r of rows) {
  const lead = r.extracted as { locality?: string; bhk?: number; segment?: string };
  const contactId = await upsertContact({ phone: r.phone, name: `${r.name ?? "Enquiry"} (test)`, locality: lead.locality ?? null, source: r.source });
  const dealId = await upsertDeal({
    hubspotDealId: r.hubspot_deal_id,
    contactId,
    name: "[Test] " + [r.name ?? "Enquiry", lead.locality, lead.bhk ? `${lead.bhk}BHK` : lead.segment].filter(Boolean).join(" · "),
    stage: r.stage,
    amountInr: r.estimated_value_inr,
    verdict: r.verdict,
    source: r.source,
    referrer: r.referrer,
    lostReason: r.lost_reason,
    followUpOn: r.follow_up_on ? String(r.follow_up_on).slice(0, 10) : null,
  });
  // Remember the HubSpot id so a re-run updates instead of duplicating (sweeper still ignores test deals)
  await sql`update deals set hubspot_deal_id = ${dealId} where id = ${r.id}`;
  n++;
}
console.log(`${n} test deals in HubSpot (labelled [Test])`);

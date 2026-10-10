import { sql } from "drizzle-orm";
import { getDb } from "@/db";

// Everything Nikhil used to count by hand, plus what the system itself costs.

export type Range = "7d" | "30d" | "90d" | "mtd";
export const RANGES: { key: Range; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "mtd", label: "Month to date" },
  { key: "90d", label: "Last 90 days" },
];

export function rangeStart(r: Range, now = new Date()): Date {
  if (r === "mtd") {
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now).slice(0, 8) + "01";
    return new Date(`${ymd}T00:00:00+05:30`);
  }
  const days = { "7d": 7, "30d": 30, "90d": 90 }[r];
  return new Date(now.getTime() - days * 24 * 3600_000);
}

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? 0 : Number(v));

export async function overview(r: Range, origin: "live" | "simulation") {
  const db = getDb();
  const from = rangeStart(r).toISOString();
  const q = async (s: ReturnType<typeof sql>) => ((await db.execute(s)) as unknown as { rows: Row[] }).rows;

  const [calls] = await q(sql`
    select count(*) as calls,
           count(*) filter (where after_hours) as after_hours,
           count(*) filter (where status = 'dropped') as dropped,
           coalesce(sum(duration_sec), 0) as seconds
    from calls where origin = ${origin} and started_at >= ${from}`);

  const verdicts = await q(sql`
    select q.verdict, q.route, count(*) as n
    from qualifications q join calls c on c.id = q.call_id
    where c.origin = ${origin} and c.started_at >= ${from}
    group by 1, 2`);

  const [bookings] = await q(sql`
    select count(*) as booked,
           count(*) filter (where b.auto_booked) as auto_booked,
           count(*) filter (where b.status = 'completed') as completed,
           count(*) filter (where b.status = 'no_show') as no_show
    from bookings b left join calls c on c.id = b.call_id
    where b.created_at >= ${from} and coalesce(c.origin, 'live') = ${origin}`);

  const stages = await q(sql`
    select d.stage, count(*) as n, coalesce(sum(d.estimated_value_inr), 0) as value
    from deals d left join qualifications q on q.id = d.qualification_id left join calls c on c.id = q.call_id
    where coalesce(c.origin, 'live') = ${origin}
    group by 1`);

  const costs = await q(sql`
    select k.provider, coalesce(sum(k.amount_inr), 0) as inr
    from costs k join calls c on c.id = k.call_id
    where k.occurred_at >= ${from} and c.origin = ${origin}
    group by 1`);

  const weekly = await q(sql`
    select to_char(date_trunc('week', c.started_at at time zone 'Asia/Kolkata'), 'DD Mon') as week,
           min(c.started_at) as sort,
           count(*) filter (where q.verdict = 'green') as green,
           count(*) filter (where q.verdict = 'amber') as amber,
           count(*) filter (where q.verdict = 'red') as red,
           count(*) filter (where q.verdict = 'not_a_lead' or q.verdict is null) as other
    from calls c left join qualifications q on q.call_id = c.id
    where c.origin = ${origin} and c.started_at >= ${from}
    group by 1 order by 2`);

  const sources = await q(sql`
    select coalesce(d.source, 'unknown') as source, count(*) as leads,
           count(*) filter (where d.stage = 'won') as won,
           coalesce(sum(d.estimated_value_inr) filter (where d.stage not in ('lost')), 0) as value
    from deals d left join qualifications q on q.id = d.qualification_id left join calls c on c.id = q.call_id
    where d.created_at >= ${from} and coalesce(c.origin, 'live') = ${origin}
    group by 1 order by 2 desc`);

  const redReasons = await q(sql`
    select r.value->>'reason' as reason, count(*) as n
    from qualifications q join calls c on c.id = q.call_id,
         jsonb_each(q.criteria) r
    where c.origin = ${origin} and c.started_at >= ${from} and q.verdict = 'red' and r.value->>'status' = 'fail'
    group by 1 order by 2 desc limit 6`);

  const [designers] = await q(sql`
    select count(*) as handoffs,
           count(*) filter (where h.confirmed_at is not null) as confirmed,
           percentile_cont(0.5) within group (order by extract(epoch from h.confirmed_at - h.sent_at) / 60) as median_confirm_min,
           count(*) filter (where h.lead_quality = 'up') as up,
           count(*) filter (where h.lead_quality = 'down') as down
    from handoffs h join qualifications q on q.id = h.qualification_id join calls c on c.id = q.call_id
    where h.sent_at >= ${from} and c.origin = ${origin}`);

  const [tasks] = await q(sql`
    select count(*) filter (where e.resolved_at is null) as open,
           count(*) filter (where e.resolved_at is null and e.due_at < now()) as overdue,
           count(*) filter (where kind = 'guardrail' and e.created_at >= ${from}) as guardrail
    from escalations e left join calls c on c.id = e.call_id
    where coalesce(c.origin, 'live') = ${origin}`);

  const fixed = await q(sql`select coalesce(sum(amount_inr), 0) as inr from costs where call_id is null and occurred_at >= ${from}`);

  const costByProvider = Object.fromEntries(costs.map((c) => [String(c.provider), n(c.inr)]));
  const totalCost = Object.values(costByProvider).reduce((a, b) => a + b, 0) + (origin === "live" ? n(fixed[0]?.inr) : 0);
  const stageMap = Object.fromEntries(stages.map((s) => [String(s.stage), { n: n(s.n), value: n(s.value) }]));
  const open = ["consult_booked", "consult_done", "proposal_sent"].reduce((a, k) => a + (stageMap[k]?.value ?? 0), 0);
  const vCount = (v: string) => verdicts.filter((x) => x.verdict === v).reduce((a, x) => a + n(x.n), 0);

  return {
    calls: n(calls.calls),
    afterHours: n(calls.after_hours),
    dropped: n(calls.dropped),
    minutes: n(calls.seconds) / 60,
    verdict: { green: vCount("green"), amber: vCount("amber"), red: vCount("red"), notLead: vCount("not_a_lead") },
    routes: Object.fromEntries(verdicts.map((x) => [String(x.route), n(x.n)])),
    booked: n(bookings.booked),
    autoBooked: n(bookings.auto_booked),
    completed: n(bookings.completed),
    noShow: n(bookings.no_show),
    stages: stageMap,
    pipelineOpen: open,
    won: stageMap.won?.value ?? 0,
    cost: { total: totalCost, byProvider: costByProvider },
    weekly: weekly.map((w) => ({ week: String(w.week), green: n(w.green), amber: n(w.amber), red: n(w.red), other: n(w.other) })),
    sources: sources.map((s) => ({ source: String(s.source), leads: n(s.leads), won: n(s.won), value: n(s.value) })),
    redReasons: redReasons.map((x) => ({ reason: String(x.reason), n: n(x.n) })),
    designers: {
      handoffs: n(designers.handoffs),
      confirmed: n(designers.confirmed),
      medianConfirmMin: designers.median_confirm_min == null ? null : n(designers.median_confirm_min),
      up: n(designers.up),
      down: n(designers.down),
    },
    tasks: { open: n(tasks.open), overdue: n(tasks.overdue), guardrail: n(tasks.guardrail) },
  };
}

export type Overview = Awaited<ReturnType<typeof overview>>;

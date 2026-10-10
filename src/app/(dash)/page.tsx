import { connection } from "next/server";
import Link from "next/link";
import { overview, RANGES, type Range } from "@/lib/metrics";
import { Filters, Kpi, ViewSwitch, inr, parseView, pct } from "@/components/ui";
import { ValueBars, WeeklyOutcomes } from "@/components/charts";

const STAGE_LABEL: Record<string, string> = {
  consult_booked: "Consult booked",
  consult_done: "Consult done",
  proposal_sent: "Proposal sent",
  won: "Won",
  nurture: "Nurture",
  lost: "Lost",
};

export default async function Overview({ searchParams }: { searchParams: Promise<{ range?: string; view?: string }> }) {
  await connection(); // per-request: these pages read the clock and the database
  const sp = await searchParams;
  const origin = parseView(sp.view);
  // The seed enquiries are from September, so any view with test calls opens on 90 days
  const range = (RANGES.some((r) => r.key === sp.range) ? sp.range : origin === "live" ? "30d" : "90d") as Range;
  const m = await overview(range, origin);

  const leads = m.verdict.green + m.verdict.amber + m.verdict.red;
  const qualified = m.verdict.green + m.verdict.amber;
  const costPerBooking = m.booked ? m.cost.total / m.booked : 0;

  return (
    <>
      <div className="filters" style={{ justifyContent: "space-between" }}>
        <Filters base={`/?view=${origin}`} current={range} items={RANGES} />
        <ViewSwitch path="/" view={origin} extra={`&range=${range}`} />
      </div>
      {origin === "all" && <div className="notice">Test stage: counting real calls and the 40 September test enquiries together. Switch to “Live only” for real calls.</div>}
      {origin === "simulation" && <div className="notice">Showing test calls only — the September enquiries and end-to-end tests, not real callers.</div>}
      {m.tasks.guardrail > 0 && (
        <div className="notice" style={{ boxShadow: "0 0 0 1.5px var(--critical)" }}>
          🛑 {m.tasks.guardrail} call(s) flagged for a possible price quote. <Link href="/queue">Review now</Link>
        </div>
      )}

      <section className="grid kpis">
        <Kpi hero label="Open pipeline" value={inr(m.pipelineOpen)} sub={`Won: ${inr(m.won)} · internal estimates`} />
        <Kpi label="Calls answered" value={String(m.calls)} sub={`${pct(m.afterHours, m.calls)} after hours · 100% answered`} />
        <Kpi label="Qualified" value={String(qualified)} sub={`${pct(qualified, leads)} of ${leads} enquiries`} />
        <Kpi label="Consultations booked" value={String(m.booked)} sub={`${m.completed} held · ${m.noShow} no-show`} />
        <Kpi label="Cost to run" value={inr(m.cost.total)} sub={m.booked ? `${inr(costPerBooking)} per booked consult` : `${m.minutes.toFixed(0)} call minutes`} />
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Calls per week, by outcome</h2>
          <WeeklyOutcomes data={m.weekly} />
        </div>
        <div className="card">
          <h2>Pipeline by stage</h2>
          <ValueBars
            rows={Object.entries(STAGE_LABEL)
              .filter(([k]) => m.stages[k])
              .map(([k, label]) => ({ label, value: m.stages[k].value, sub: `${m.stages[k].n} deals` }))}
          />
          <p className="muted" style={{ marginBottom: 0 }}>Values are internal estimates from the pricing guide — never quoted to clients.</p>
        </div>
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Where qualified leads come from</h2>
          {m.sources.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Source</th><th className="r">Leads</th><th className="r">Won</th><th className="r">Pipeline</th></tr></thead>
                <tbody>
                  {m.sources.map((s) => (
                    <tr key={s.source}><td>{s.source}</td><td className="r">{s.leads}</td><td className="r">{s.won}</td><td className="r">{inr(s.value)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty">No qualified leads yet.</p>}
        </div>
        <div className="card">
          <h2>Why enquiries were declined</h2>
          {m.redReasons.length ? (
            <table>
              <tbody>{m.redReasons.map((r) => <tr key={r.reason}><td>{r.reason}</td><td className="r">{r.n}</td></tr>)}</tbody>
            </table>
          ) : <p className="empty">None declined in this range.</p>}
        </div>
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Designers</h2>
          <table>
            <tbody>
              <tr><td>Handoffs sent</td><td className="r">{m.designers.handoffs}</td></tr>
              <tr><td>Confirmed</td><td className="r">{pct(m.designers.confirmed, m.designers.handoffs)}</td></tr>
              <tr><td>Median time to confirm</td><td className="r">{m.designers.medianConfirmMin == null ? "—" : `${Math.round(m.designers.medianConfirmMin)} min`}</td></tr>
              <tr><td>Lead quality 👍 / 👎</td><td className="r">{m.designers.up} / {m.designers.down}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>What the system costs</h2>
          <table>
            <tbody>
              <tr><td>Voice (Vaani) · {m.minutes.toFixed(0)} min</td><td className="r">{inr(m.cost.byProvider.vaani ?? 0)}</td></tr>
              <tr><td>AI extraction (Gemini Flash)</td><td className="r">{inr(m.cost.byProvider.gemini ?? 0)}</td></tr>
              <tr><td>Telephony + fixed</td><td className="r">{inr(m.cost.total - (m.cost.byProvider.vaani ?? 0) - (m.cost.byProvider.gemini ?? 0))}</td></tr>
              <tr><td><b>Total</b></td><td className="r"><b>{inr(m.cost.total)}</b></td></tr>
              <tr><td>Per call answered</td><td className="r">{m.calls ? inr(m.cost.total / m.calls) : "—"}</td></tr>
            </tbody>
          </table>
          <p className="muted" style={{ marginBottom: 0 }}>
            Front desk queue: {m.tasks.open} open{m.tasks.overdue ? `, ${m.tasks.overdue} overdue` : ""}. <Link href="/queue">Open queue</Link>
          </p>
        </div>
      </section>
    </>
  );
}

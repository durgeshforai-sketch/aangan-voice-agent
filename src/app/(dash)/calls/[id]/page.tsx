import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ROUTE_LABEL, VerdictBadge, inr } from "@/components/ui";
import { formatIst } from "@/lib/hours";
import type { ExtractedLead } from "@/lib/lead";
import type { Criteria } from "@/lib/qualify";

const CRITERIA_LABEL: Record<keyof Criteria, string> = {
  realProject: "1 · Real project (design + execution)",
  serviceArea: "2 · In Pune / PCMC",
  timeline: "3 · Realistic timeline",
  budget: "4 · Budget band (only if volunteered)",
  decisionMaker: "5 · Decision-maker",
};
const STATUS_ICON = { pass: "✓", fail: "✕", unclear: "?" };

export default async function CallDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const [row] = await db
    .select({ c: schema.calls, q: schema.qualifications, caller: schema.callers })
    .from(schema.calls)
    .leftJoin(schema.qualifications, eq(schema.qualifications.callId, schema.calls.id))
    .leftJoin(schema.callers, eq(schema.callers.id, schema.calls.callerId))
    .where(eq(schema.calls.id, id));
  if (!row) notFound();
  const { c, q, caller } = row;
  const l = q?.extracted as ExtractedLead | undefined;
  const criteria = q?.criteria as Criteria | undefined;
  const bookings = await db
    .select({ b: schema.bookings, d: schema.designers })
    .from(schema.bookings)
    .leftJoin(schema.designers, eq(schema.designers.id, schema.bookings.designerId))
    .where(eq(schema.bookings.callId, id));
  const costs = await db.select().from(schema.costs).where(eq(schema.costs.callId, id));
  const cost = costs.reduce((a, k) => a + Number(k.amountInr), 0);

  return (
    <>
      <section className="grid two">
        <div className="card">
          <h2>{caller?.name ?? l?.name ?? "Unknown caller"} <span className="muted">{caller?.phone}</span></h2>
          <p style={{ marginTop: 0 }}>
            <VerdictBadge v={q?.verdict} /> · <span className="ink2">{q ? ROUTE_LABEL[q.route] : "Not processed yet"}</span>
            {q?.mismatch && <span className="error"> · booking held for review</span>}
          </p>
          <p className="ink2">{q?.handoffNote}</p>
          <dl className="facts">
            <dt>When</dt><dd>{formatIst(c.startedAt)}{c.afterHours ? " · after hours" : ""}</dd>
            <dt>Length</dt><dd>{c.durationSec ? `${Math.round(c.durationSec / 60)} min` : "—"} · cost {inr(cost)}</dd>
            {l && <>
              <dt>Where</dt><dd>{l.locality ?? "?"} ({l.city})</dd>
              <dt>Property</dt><dd>{[l.bhk && `${l.bhk}BHK`, l.propertyType, l.carpetAreaSqft && `${l.carpetAreaSqft} sq ft`].filter(Boolean).join(" · ")}</dd>
              <dt>Scope</dt><dd>{l.scopeLevel.replace("_", " ")}{l.roomsInScope.length ? ` — ${l.roomsInScope.join(", ")}` : ""}</dd>
              <dt>Source</dt><dd>{l.source}{l.referrerName ? ` — ${l.referrerName}` : ""}</dd>
              {q?.estimatedValueInr != null && <><dt>Internal est.</dt><dd>{inr(q.estimatedValueInr)}</dd></>}
            </>}
            {q?.flags.length ? <><dt>Flags</dt><dd>{q.flags.join(", ").replaceAll("_", " ")}</dd></> : null}
          </dl>
        </div>
        <div className="card">
          <h2>Nikhil&apos;s five criteria</h2>
          {criteria && Object.keys(criteria).length ? (
            <table>
              <tbody>
                {(Object.keys(CRITERIA_LABEL) as (keyof Criteria)[]).map((k) => (
                  <tr key={k}>
                    <td>{CRITERIA_LABEL[k]}</td>
                    <td>
                      <span className="badge"><b aria-hidden>{STATUS_ICON[criteria[k].status]}</b> {criteria[k].status}</span>
                      <div className="muted">{criteria[k].reason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="empty">Not a new enquiry — criteria not applied.</p>}
          <h2 style={{ marginTop: 16 }}>Booking</h2>
          {bookings.length ? bookings.map(({ b, d }) => (
            <p key={b.id} style={{ margin: "4px 0" }}>
              {formatIst(b.startsAt)} · {b.mode.replace("_", " ")} · {d?.name ?? "unassigned"} · <span className="ink2">{b.status}{b.autoBooked ? " (auto, after call)" : ""}</span>
            </p>
          )) : <p className="muted">No booking.</p>}
        </div>
      </section>
      <section className="card">
        <h2>Transcript</h2>
        {c.recordingUrl && <p><a href={c.recordingUrl} target="_blank" rel="noreferrer">▶ Recording</a></p>}
        <pre className="transcript">{c.transcript ?? "No transcript."}</pre>
      </section>
    </>
  );
}

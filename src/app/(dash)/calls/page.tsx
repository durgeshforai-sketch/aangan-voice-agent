import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ROUTE_LABEL, VerdictBadge } from "@/components/ui";
import { formatIst } from "@/lib/hours";
import type { ExtractedLead } from "@/lib/lead";

export default async function Calls({ searchParams }: { searchParams: Promise<{ origin?: string; phone?: string }> }) {
  const sp = await searchParams;
  const origin = sp.origin === "simulation" ? "simulation" : "live";
  const phone = sp.phone?.trim() || null;
  const rows = await getDb()
    .select({ c: schema.calls, q: schema.qualifications, caller: schema.callers })
    .from(schema.calls)
    .leftJoin(schema.qualifications, eq(schema.qualifications.callId, schema.calls.id))
    .leftJoin(schema.callers, eq(schema.callers.id, schema.calls.callerId))
    .where(phone ? and(eq(schema.calls.origin, origin), eq(schema.callers.phone, phone)) : eq(schema.calls.origin, origin))
    .orderBy(desc(schema.calls.startedAt))
    .limit(200);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2>{origin === "live" ? "Calls" : "Simulated test calls"}</h2>
        <Link className="chip" href={origin === "live" ? "/calls?origin=simulation" : "/calls"}>
          {origin === "live" ? "Show test calls" : "← Live calls"}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="empty">No calls yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Caller</th><th>Project</th><th>Outcome</th><th>Route</th><th className="r">Length</th></tr>
            </thead>
            <tbody>
              {rows.map(({ c, q, caller }) => {
                const l = q?.extracted as ExtractedLead | undefined;
                return (
                  <tr key={c.id}>
                    <td><Link href={`/calls/${c.id}`}>{formatIst(c.startedAt)}</Link>{c.afterHours && <div className="muted">after hours</div>}</td>
                    <td>{caller?.name ?? l?.name ?? <span className="muted">Unknown</span>}<div className="muted">{caller?.phone}</div></td>
                    <td>{l ? [l.locality, l.bhk && `${l.bhk}BHK`, l.segment !== "unknown" && l.segment].filter(Boolean).join(" · ") : <span className="muted">—</span>}</td>
                    <td><VerdictBadge v={q?.verdict} />{q?.mismatch && <div className="error">booking held</div>}</td>
                    <td className="ink2">{q ? ROUTE_LABEL[q.route] : c.status}</td>
                    <td className="r">{c.durationSec ? `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

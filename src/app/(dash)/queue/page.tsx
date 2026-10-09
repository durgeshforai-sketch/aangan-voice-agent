import Link from "next/link";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatIst } from "@/lib/hours";

const KIND_LABEL: Record<string, string> = {
  escalation: "🚨 Escalation",
  review: "🟠 Review",
  booking_failed: "📅 Booking failed",
  mismatch: "⚠️ Booking held",
  unconfirmed: "⏰ Unconfirmed handoff",
  nurture_due: "🌱 Nurture follow-up",
  guardrail: "🛑 Price guardrail",
};

async function resolve(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const owner = String(formData.get("owner") || "") || null;
  const notes = String(formData.get("notes") || "") || null;
  await getDb().update(schema.escalations).set({ resolvedAt: new Date(), owner, notes }).where(eq(schema.escalations.id, id));
  revalidatePath("/queue");
}

export default async function Queue() {
  await connection();
  const db = getDb();
  const open = await db
    .select({ t: schema.escalations, caller: schema.callers })
    .from(schema.escalations)
    .leftJoin(schema.callers, eq(schema.callers.id, schema.escalations.callerId))
    .where(isNull(schema.escalations.resolvedAt))
    .orderBy(asc(schema.escalations.dueAt));
  const done = await db
    .select()
    .from(schema.escalations)
    .where(and(isNotNull(schema.escalations.resolvedAt)))
    .orderBy(desc(schema.escalations.resolvedAt))
    .limit(20);
  const now = new Date();

  return (
    <>
      <section className="card" style={{ marginBottom: 12 }}>
        <h2>Open ({open.length})</h2>
        {open.length === 0 ? <p className="empty">Nothing waiting. 🎉</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Due</th><th>What</th><th>Caller</th><th>Details</th><th>Resolve</th></tr></thead>
              <tbody>
                {open.map(({ t, caller }) => (
                  <tr key={t.id}>
                    <td className={t.dueAt < now ? "error" : ""}>{formatIst(t.dueAt)}{t.dueAt < now ? <div>overdue</div> : null}</td>
                    <td>{KIND_LABEL[t.kind]}</td>
                    <td>{caller?.name ?? "—"}<div className="muted">{caller?.phone}</div></td>
                    <td style={{ maxWidth: 380, whiteSpace: "pre-wrap" }}>{t.reason}{t.callId && <div><Link href={`/calls/${t.callId}`}>Open call</Link></div>}</td>
                    <td>
                      <form action={resolve} style={{ display: "grid", gap: 6, minWidth: 180 }}>
                        <input type="hidden" name="id" value={t.id} />
                        <input name="owner" placeholder="Handled by" aria-label="Handled by" />
                        <input name="notes" placeholder="What happened" aria-label="Notes" />
                        <button type="submit">Mark done</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Recently resolved</h2>
        {done.length === 0 ? <p className="empty">None yet.</p> : (
          <table>
            <tbody>
              {done.map((t) => (
                <tr key={t.id}>
                  <td>{KIND_LABEL[t.kind]}</td>
                  <td className="ink2">{t.reason.slice(0, 120)}</td>
                  <td>{t.owner ?? "—"}</td>
                  <td className="muted">{t.resolvedAt && formatIst(t.resolvedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

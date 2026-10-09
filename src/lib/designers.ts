import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Match the Cal.com host to our designer row; fall back to the least-loaded active designer. */
export async function designerForBooking(host: { id?: number; email?: string } | null, segment: string) {
  const db = getDb();
  if (host?.id) {
    const [d] = await db.select().from(schema.designers).where(eq(schema.designers.calcomUserId, String(host.id)));
    if (d) return d;
  }
  return leastLoaded(segment);
}

export async function leastLoaded(segment: string, excludeId?: string) {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const rows = await db
    .select({
      d: schema.designers,
      load: sql<number>`count(${schema.handoffs.id})`.mapWith(Number),
    })
    .from(schema.designers)
    .leftJoin(schema.handoffs, and(eq(schema.handoffs.designerId, schema.designers.id), gte(schema.handoffs.sentAt, since)))
    .where(eq(schema.designers.active, true))
    .groupBy(schema.designers.id);
  const pool = rows.filter((r) => r.d.id !== excludeId);
  // Commercial leads go to designers who do commercial work, if any are set up
  const specialists = pool.filter((r) => r.d.specialties.includes(segment));
  const candidates = specialists.length ? specialists : pool;
  candidates.sort((a, b) => a.load - b.load);
  return candidates[0]?.d ?? null;
}

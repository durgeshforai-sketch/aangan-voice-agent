import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type Designer = typeof schema.designers.$inferSelect;

export async function activeDesigners(): Promise<Designer[]> {
  return getDb().select().from(schema.designers).where(eq(schema.designers.active, true));
}

/**
 * Fair assignment: fewest handoffs in the last 30 days wins. Commercial leads go to designers who
 * do commercial work when any are available. `among` limits the choice (e.g. to those free at a slot).
 */
export async function leastLoaded(segment: string, opts: { exclude?: string; among?: string[] } = {}) {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const rows = await db
    .select({ d: schema.designers, load: sql<number>`count(${schema.handoffs.id})`.mapWith(Number) })
    .from(schema.designers)
    .leftJoin(schema.handoffs, and(eq(schema.handoffs.designerId, schema.designers.id), gte(schema.handoffs.sentAt, since)))
    .where(eq(schema.designers.active, true))
    .groupBy(schema.designers.id);
  const pool = rows.filter((r) => r.d.id !== opts.exclude && (!opts.among || opts.among.includes(r.d.id)));
  const specialists = pool.filter((r) => r.d.specialties.includes(segment));
  const candidates = specialists.length ? specialists : pool;
  candidates.sort((a, b) => a.load - b.load || a.d.name.localeCompare(b.d.name));
  return candidates[0]?.d ?? null;
}

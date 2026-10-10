import { sql } from "drizzle-orm";
import { schema } from "@/db";

// Rows that belong to real calls (not the simulated trial set). Used wherever an action could reach
// a real person or system: sweeper alerts, the front-desk queue, HubSpot sync.
export const liveQualification = sql`exists (select 1 from calls c where c.id = ${schema.qualifications.callId} and c.origin = 'live')`;
export const liveTask = sql`(${schema.escalations.callId} is null or exists (select 1 from calls c where c.id = ${schema.escalations.callId} and c.origin = 'live'))`;
export const liveDeal = sql`(${schema.deals.qualificationId} is null or exists (select 1 from qualifications q join calls c on c.id = q.call_id where q.id = ${schema.deals.qualificationId} and c.origin = 'live'))`;

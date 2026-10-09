import type { ExtractedLead } from "./lead";

// Internal pipeline estimates from knowledge/pricing.md.
// NEVER spoken to a caller or shown to them — pipeline value and budget sanity only.
const RES_STANDARD_LOW = 1800; // ₹/sq ft
const RES_STANDARD_MID = 2400;
const COM_BASIC_LOW = 1200;
const COM_MID = 2300;
const ROOM_LOW = 350_000; // single room all-in, low end
const ROOM_MID = 575_000;
const FALLBACK_AVG = 1_100_000; // brief: average project ₹8–14 lakh

function roomCount(lead: ExtractedLead): number | null {
  if (lead.scopeLevel === "single_room") return 1;
  if (lead.scopeLevel === "partial") return Math.max(lead.roomsInScope.length, 2);
  return null;
}

/** Lowest plausible cost for the described scope, or null if we can't tell. */
export function minimumPlausibleInr(lead: ExtractedLead): number | null {
  const rooms = roomCount(lead);
  if (rooms) return rooms * ROOM_LOW;
  if (lead.scopeLevel === "full_home" && lead.carpetAreaSqft) {
    const rate = lead.segment === "commercial" ? COM_BASIC_LOW : RES_STANDARD_LOW;
    return lead.carpetAreaSqft * rate;
  }
  return null;
}

/** Mid-band estimate used as the HubSpot deal amount. */
export function estimatedValueInr(lead: ExtractedLead): number {
  if (lead.budgetVolunteered && lead.budgetMaxLakh) {
    const min = lead.budgetMinLakh ?? lead.budgetMaxLakh;
    return Math.round(((min + lead.budgetMaxLakh) / 2) * 100_000);
  }
  const rooms = roomCount(lead);
  if (rooms) return rooms * ROOM_MID;
  if (lead.carpetAreaSqft) {
    const rate = lead.segment === "commercial" ? COM_MID : RES_STANDARD_MID;
    return Math.round(lead.carpetAreaSqft * rate);
  }
  return FALLBACK_AVG;
}

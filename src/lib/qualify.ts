import type { ExtractedLead } from "./lead";
import { minimumPlausibleInr } from "./estimate";

// Nikhil's five criteria (knowledge/qualified.md) as deterministic code.
// The LLM extracts facts; this file makes the decision, so it is testable and explainable.

export type CriterionResult = { status: "pass" | "fail" | "unclear"; reason: string };
export type Criteria = {
  realProject: CriterionResult;
  serviceArea: CriterionResult;
  timeline: CriterionResult;
  budget: CriterionResult;
  decisionMaker: CriterionResult;
};
export type Verdict = "green" | "amber" | "red" | "not_a_lead";
export type Route = "book" | "book_with_note" | "review" | "nurture" | "close" | "escalate" | "log";
export type Qualification = { verdict: Verdict; route: Route; criteria: Criteria | null; flags: string[] };

// Rule choices where the seed files disagree — decided 2026-10-10, see docs/agent-spec.md
export const RULES = {
  minWeeksToCompletion: 8, // under this: cannot serve (qualified.md: room = 8–10 weeks end to end)
  comfortableWeeksToCompletion: 12, // 8–12 weeks: possible but tight → designer must set expectations
  maxWeeksUntilSiteAvailable: 10, // qualified.md: site available within 8–10 weeks of consultation
  commercialMinSqft: 500, // front-desk practice (T18), not in services.md → amber, not red
  commercialMaxSqft: 3000, // services.md: "up to approximately 3,000 sq ft"
  budgetClearlyBelowRatio: 0.6, // volunteered max < 60% of lowest plausible cost → misaligned
};

const OUT_OF_SCOPE_TYPES = new Set(["restaurant", "hotel", "retail", "gym"]);
const NOT_A_PROJECT = new Set(["advice_only", "decor_only", "furniture_only", "vastu_only"]);
// services.md names these explicitly as outside the area; the LLM may still label them "pune"
const EXCLUDED_PLACES = ["talegaon", "lonavala", "nashik", "mumbai", "thane", "navi mumbai"];

const weeksBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / (7 * 24 * 3600 * 1000);

function realProject(l: ExtractedLead): CriterionResult {
  if (OUT_OF_SCOPE_TYPES.has(l.propertyType))
    return { status: "fail", reason: `${l.propertyType} interiors are out of scope` };
  if (NOT_A_PROJECT.has(l.scopeLevel))
    return { status: "fail", reason: `Wants ${l.scopeLevel.replace("_", " ")}, not design + execution` };
  if (l.wantsExecution === "no") return { status: "fail", reason: "Does not want execution" };
  if (l.segment === "commercial" && l.carpetAreaSqft) {
    if (l.carpetAreaSqft < RULES.commercialMinSqft)
      return { status: "unclear", reason: `${l.carpetAreaSqft} sq ft commercial is below the usual ${RULES.commercialMinSqft} sq ft` };
    if (l.carpetAreaSqft > RULES.commercialMaxSqft * 1.2)
      return { status: "unclear", reason: `${l.carpetAreaSqft} sq ft is above the ~${RULES.commercialMaxSqft} sq ft commercial limit` };
  }
  if (l.scopeLevel === "unknown" || l.wantsExecution === "unclear")
    return { status: "unclear", reason: "Scope or execution intent not established" };
  return { status: "pass", reason: `${l.scopeLevel.replace("_", " ")} with execution` };
}

function serviceArea(l: ExtractedLead): CriterionResult {
  const place = (l.locality ?? "").toLowerCase();
  const excluded = EXCLUDED_PLACES.find((p) => place.includes(p));
  if (excluded) return { status: "fail", reason: `${l.locality} is outside Pune/PCMC` };
  if (l.city === "other") return { status: "fail", reason: `${l.locality ?? "Location"} is outside Pune/PCMC` };
  if (l.city === "unknown") return { status: "unclear", reason: "Location not established" };
  return { status: "pass", reason: `${l.locality ?? l.city.toUpperCase()} is in the service area` };
}

function timeline(l: ExtractedLead, now: Date): CriterionResult {
  if (l.completionNeededBy) {
    const weeks = weeksBetween(now, new Date(l.completionNeededBy));
    if (weeks < RULES.minWeeksToCompletion)
      return { status: "fail", reason: `Needs completion in ~${Math.max(0, Math.round(weeks))} weeks` };
    if (weeks < RULES.comfortableWeeksToCompletion)
      return { status: "unclear", reason: `Tight: completion needed in ~${Math.round(weeks)} weeks` };
  }
  if (l.siteAvailableFrom) {
    const weeks = weeksBetween(now, new Date(l.siteAvailableFrom));
    if (weeks > RULES.maxWeeksUntilSiteAvailable)
      return { status: "fail", reason: `Site not available for ~${Math.round(weeks)} weeks` };
  }
  if (l.completionNeededBy || l.siteAvailableFrom || l.timelineFlexible)
    return { status: "pass", reason: l.timelineNotes ?? "Timeline workable" };
  return { status: "unclear", reason: "Timeline not established" };
}

function budget(l: ExtractedLead): CriterionResult {
  // qualified.md: don't probe; not mentioned = qualified
  if (!l.budgetVolunteered || l.budgetMaxLakh == null) return { status: "pass", reason: "Not volunteered" };
  const min = minimumPlausibleInr(l);
  if (!min) return { status: "pass", reason: `Volunteered ₹${l.budgetMaxLakh}L; scope too vague to compare` };
  const ratio = (l.budgetMaxLakh * 100_000) / min;
  if (ratio < RULES.budgetClearlyBelowRatio)
    return { status: "fail", reason: `Volunteered ₹${l.budgetMaxLakh}L is clearly below this scope` };
  if (ratio < 1) return { status: "pass", reason: `Volunteered ₹${l.budgetMaxLakh}L — near the low end for this scope` };
  return { status: "pass", reason: `Volunteered ₹${l.budgetMaxLakh}L` };
}

function decisionMaker(l: ExtractedLead): CriterionResult {
  switch (l.decisionMaker) {
    case "self":
      return { status: "pass", reason: "Owner/decision-maker on the call" };
    case "authorised":
      return { status: "pass", reason: "Authorised by the decision-maker" };
    case "represented":
      return { status: "unclear", reason: "Calling for owners who will decide" };
    case "research_only":
      return { status: "unclear", reason: "Initial research for someone else" };
    default:
      return { status: "unclear", reason: "Decision-maker not established" };
  }
}

function flagsFor(l: ExtractedLead, c: Criteria): string[] {
  const f: string[] = [];
  if (l.mentionsFounderConnection) f.push("vip_referral");
  if (l.frustrated) f.push("frustrated");
  if (l.callType === "returning_enquiry") f.push("repeat_caller");
  if (l.askedAboutPricing) f.push("price_sensitive");
  if (l.consultPreference === "site_visit") f.push("site_visit_requested");
  if (l.rented) f.push("rented");
  if (l.structuralChangesWanted) f.push("wants_structural_changes");
  if (c.budget.reason.includes("low end")) f.push("budget_tight");
  if (c.timeline.status === "unclear" && c.timeline.reason.startsWith("Tight")) f.push("timeline_tight");
  return f;
}

export function qualify(l: ExtractedLead, now = new Date()): Qualification {
  if (l.callType === "existing_client" || l.complaint)
    return { verdict: "not_a_lead", route: "escalate", criteria: null, flags: l.frustrated ? ["frustrated"] : [] };
  if (["vendor_or_job", "wrong_number", "silent_or_dropped", "other"].includes(l.callType))
    return { verdict: "not_a_lead", route: "log", criteria: null, flags: [] };

  const criteria: Criteria = {
    realProject: realProject(l),
    serviceArea: serviceArea(l),
    timeline: timeline(l, now),
    budget: budget(l),
    decisionMaker: decisionMaker(l),
  };
  const flags = flagsFor(l, criteria);
  const all = Object.values(criteria);
  const fails = Object.entries(criteria).filter(([, r]) => r.status === "fail").map(([k]) => k);

  if (fails.length > 0) {
    // Only the timeline is wrong and the caller would start later → keep the relationship warm
    const nurture = fails.length === 1 && fails[0] === "timeline" && l.openToLaterStart === true;
    return { verdict: "red", route: nurture ? "nurture" : "close", criteria, flags };
  }
  if (l.readiness === "exploring") return { verdict: "amber", route: "nurture", criteria, flags };
  // Unresolved scope or area would waste a designer's site visit → front desk decides
  if (criteria.realProject.status === "unclear" || criteria.serviceArea.status === "unclear")
    return { verdict: "amber", route: "review", criteria, flags };
  if (all.some((r) => r.status === "unclear")) return { verdict: "amber", route: "book_with_note", criteria, flags };
  return { verdict: "green", route: "book", criteria, flags };
}

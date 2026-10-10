import type { ExtractedLead } from "./lead";
import type { Qualification } from "./qualify";
import { escapeHtml as e, ACTIONS, type Button } from "./telegram";
import { formatIst } from "./hours";

// The designer's 30-second brief. Everything they'd otherwise re-ask on the first call.

const FLAG_LABELS: Record<string, string> = {
  vip_referral: "⭐ Personal connection to Nikhil",
  frustrated: "⚠️ Caller was frustrated — handle with care",
  repeat_caller: "🔁 Has contacted us before",
  price_sensitive: "💬 Asked about price (deflected; no number given)",
  site_visit_requested: "📍 Wants a site visit",
  rented: "🏠 Rented — no structural changes",
  wants_structural_changes: "🧱 Mentioned structural changes (we don't do these)",
  budget_tight: "₹ Volunteered budget is near the low end for this scope",
  timeline_tight: "⏱ Timeline is tight — set expectations early",
};

const lakh = (inr: number) => `₹${(inr / 100_000).toFixed(inr >= 10_000_000 ? 0 : 1)}L`;

export function handoffMessage(args: {
  lead: ExtractedLead;
  q: Qualification;
  summary: string;
  phone: string | null;
  bookingAt: Date | null;
  bookingMode: string | null;
  estimatedValueInr: number;
  callUrl: string;
  forCalendar?: boolean; // the Cal.com email already shows the time, and has its own links
}): string {
  const { lead: l, q } = args;
  const badge = q.verdict === "green" ? "🟢 Qualified" : "🟠 Qualified — check notes";
  const size = [l.bhk ? `${l.bhk}BHK` : null, l.carpetAreaSqft ? `${l.carpetAreaSqft.toLocaleString("en-IN")} sq ft` : null]
    .filter(Boolean)
    .join(", ");
  const scope = l.roomsInScope.length ? l.roomsInScope.join(", ") : l.scopeLevel.replace("_", " ");
  const timeline = [
    l.completionNeededBy && `complete by ${l.completionNeededBy}`,
    l.siteAvailableFrom && `site available ${l.siteAvailableFrom}`,
    l.timelineNotes,
    l.timelineFlexible && "flexible",
  ]
    .filter(Boolean)
    .join("; ") || "not stated";
  const budget = l.budgetVolunteered && l.budgetMaxLakh ? `₹${l.budgetMinLakh ?? ""}${l.budgetMinLakh ? "–" : ""}${l.budgetMaxLakh}L (caller's own figure)` : "not discussed";
  const decider = {
    self: "caller (owner)",
    authorised: "caller, authorised by co-owner",
    represented: "owners — caller is representing them",
    research_only: "unclear — caller researching for someone else",
    unknown: "not established",
  }[l.decisionMaker];
  const source = l.referrerName ? `${l.source} — ${l.referrerName}` : l.source;
  const uncertain = q.criteria
    ? Object.values(q.criteria).filter((c) => c.status === "unclear").map((c) => c.reason)
    : [];

  const lines = [
    `<b>${badge}</b> · new enquiry`,
    `<b>${e(l.name ?? "Caller")}</b>${args.phone ? ` · ${e(args.phone)}` : ""}`,
    "",
    e(args.summary),
    "",
    `📍 ${e(l.locality ?? "?")}${size ? ` · ${e(size)}` : ""} · ${l.segment}`,
    `🛠 ${e(scope)}`,
    `🗓 ${e(timeline)}`,
    `👤 Decides: ${decider}`,
    `₹ Budget: ${e(budget)} · internal est. ${lakh(args.estimatedValueInr)}`,
    `📣 Source: ${e(source)}`,
  ];
  if (l.stylePreferences) lines.push(`🎨 ${e(l.stylePreferences)}`);
  if (l.availabilityNotes) lines.push(`🕒 Prefers: ${e(l.availabilityNotes)}`);
  if (l.otherNotes) lines.push(`📝 ${e(l.otherNotes)}`);
  const flags = q.flags.map((f) => FLAG_LABELS[f]).filter(Boolean);
  if (flags.length || uncertain.length) {
    lines.push("", "<b>Heads-up</b>");
    for (const f of flags) lines.push(f);
    for (const u of uncertain) lines.push(`❔ ${e(u)}`);
  }
  lines.push("");
  if (!args.forCalendar)
    lines.push(
      args.bookingAt
        ? `<b>Consultation:</b> ${formatIst(args.bookingAt)} · ${args.bookingMode?.replace("_", " ")}`
        : "<b>Consultation:</b> not booked yet — please call to fix a time",
    );
  lines.push(
    "Already asked on the call: scope, area, size, timeline, decision-maker, source. <i>Don't re-ask; confirm.</i>",
    args.forCalendar ? `Transcript, recording + Confirm / outcome buttons: ${args.callUrl}` : `<a href="${args.callUrl}">Transcript + recording</a>`,
  );
  return lines.join("\n");
}

/** Plain text for places without HTML (Cal.com booking notes → the consultant's booking email). */
export const toPlain = (html: string) =>
  html
    .replace(/<a href="([^"]+)">([^<]+)<\/a>/g, "$2: $1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

export const confirmButtons = (handoffId: string): Button[][] => [
  [
    { text: "✅ Confirm", callback_data: `${ACTIONS.confirm}:${handoffId}` },
    { text: "↪️ Reassign", callback_data: `${ACTIONS.reassign}:${handoffId}` },
  ],
];

export const outcomeButtons = (handoffId: string): Button[][] => [
  [
    { text: "Consult done", callback_data: `${ACTIONS.done}:${handoffId}` },
    { text: "No-show", callback_data: `${ACTIONS.noShow}:${handoffId}` },
  ],
  [
    { text: "Proposal sent", callback_data: `${ACTIONS.proposal}:${handoffId}` },
    { text: "Won 🎉", callback_data: `${ACTIONS.won}:${handoffId}` },
    { text: "Lost", callback_data: `${ACTIONS.lost}:${handoffId}` },
  ],
  [
    { text: "👍 Good lead", callback_data: `${ACTIONS.good}:${handoffId}` },
    { text: "👎 Not worth it", callback_data: `${ACTIONS.bad}:${handoffId}` },
  ],
];

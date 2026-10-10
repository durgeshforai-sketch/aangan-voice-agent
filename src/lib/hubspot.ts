// HubSpot CRM (free). Deals queue in Neon (deals.hubspotSyncedAt IS NULL) and sync here,
// so HubSpot can be connected last without losing anything.
const BASE = "https://api.hubapi.com";

async function hs<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not set");
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new Error(`HubSpot ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// Our stage → HubSpot default sales pipeline stage ids. Override with HUBSPOT_STAGE_MAP (JSON)
// if the pipeline HubSpot's setup creates uses different ids.
const DEFAULT_STAGES: Record<string, string> = {
  consult_booked: "appointmentscheduled",
  consult_done: "qualifiedtobuy",
  proposal_sent: "presentationscheduled",
  won: "closedwon",
  lost: "closedlost",
  nurture: "appointmentscheduled",
};
export const stageId = (stage: string) => {
  const map = process.env.HUBSPOT_STAGE_MAP ? { ...DEFAULT_STAGES, ...JSON.parse(process.env.HUBSPOT_STAGE_MAP) } : DEFAULT_STAGES;
  return map[stage] ?? DEFAULT_STAGES.consult_booked;
};

export async function upsertContact(c: { phone: string; name: string | null; locality: string | null; source: string | null }) {
  const found = await hs<{ results: { id: string }[] }>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: { filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: c.phone }] }], limit: 1 },
  });
  const [first, ...rest] = (c.name ?? "").split(" ");
  const properties = {
    phone: c.phone,
    firstname: first || "Caller",
    lastname: rest.join(" "),
    city: c.locality ?? "",
    hs_lead_status: "NEW",
    aangan_source: c.source ?? "",
  };
  if (found.results[0]) {
    await hs(`/crm/v3/objects/contacts/${found.results[0].id}`, { method: "PATCH", body: { properties } });
    return found.results[0].id;
  }
  return (await hs<{ id: string }>("/crm/v3/objects/contacts", { method: "POST", body: { properties } })).id;
}

export type DealInput = {
  hubspotDealId: string | null;
  contactId: string;
  name: string;
  stage: string;
  amountInr: number | null;
  verdict: string | null;
  source: string | null;
  referrer: string | null;
  lostReason: string | null;
  followUpOn: string | null;
};

export async function upsertDeal(d: DealInput): Promise<string> {
  const properties: Record<string, string> = {
    dealname: d.name,
    pipeline: process.env.HUBSPOT_PIPELINE_ID || "default",
    dealstage: stageId(d.stage),
    amount: d.amountInr != null ? String(d.amountInr) : "",
    aangan_verdict: d.verdict ?? "",
    aangan_source: d.source ?? "",
    aangan_referrer: d.referrer ?? "",
    aangan_follow_up_on: d.followUpOn ?? "",
  };
  if (d.lostReason) properties.closed_lost_reason = d.lostReason;
  if (d.hubspotDealId) {
    await hs(`/crm/v3/objects/deals/${d.hubspotDealId}`, { method: "PATCH", body: { properties } });
    return d.hubspotDealId;
  }
  const created = await hs<{ id: string }>("/crm/v3/objects/deals", {
    method: "POST",
    body: {
      properties,
      associations: [{ to: { id: d.contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }],
    },
  });
  return created.id;
}

/** Custom properties we write. Run once via scripts/setup-hubspot.ts. */
export const CUSTOM_PROPERTIES = [
  { objectType: "contacts", name: "aangan_source", label: "Aangan: lead source" },
  { objectType: "deals", name: "aangan_source", label: "Aangan: lead source" },
  { objectType: "deals", name: "aangan_referrer", label: "Aangan: referred by" },
  { objectType: "deals", name: "aangan_verdict", label: "Aangan: qualification (green/amber)" },
  { objectType: "deals", name: "aangan_follow_up_on", label: "Aangan: nurture follow-up date" },
];

export async function ensureProperties() {
  for (const p of CUSTOM_PROPERTIES) {
    try {
      await hs(`/crm/v3/properties/${p.objectType}`, {
        method: "POST",
        body: { name: p.name, label: p.label, type: "string", fieldType: "text", groupName: p.objectType === "deals" ? "dealinformation" : "contactinformation" },
      });
    } catch (err) {
      if (!String(err).includes("409")) throw err; // already exists
    }
  }
}

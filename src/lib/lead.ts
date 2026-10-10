import { z } from "zod";

// The structured fields Gemini extracts from a call transcript.
// Every field is nullable: "the caller didn't say" is information, not an error.
export const ExtractedLead = z.object({
  callType: z.enum([
    "new_enquiry",
    "returning_enquiry", // called before about a new project, e.g. T16
    "existing_client", // has an ongoing project with Aangan
    "vendor_or_job", // supplier pitch, job seeker
    "wrong_number",
    "silent_or_dropped",
    "other",
  ]),
  complaint: z
    .boolean()
    .describe("Complaint about an ongoing or past Aangan PROJECT. Being annoyed that nobody returned an enquiry is NOT a complaint (that's frustrated + returning_enquiry)."),

  name: z.string().nullable(),
  locality: z.string().nullable().describe("Neighbourhood or town as the caller said it, e.g. 'Kothrud', 'Talegaon Dabhade'"),
  city: z.enum(["pune", "pcmc", "other", "unknown"]),

  segment: z.enum(["residential", "commercial", "unknown"]),
  propertyType: z.enum([
    "apartment",
    "independent_house",
    "villa",
    "office",
    "clinic",
    "studio",
    "coworking",
    "restaurant",
    "hotel",
    "retail",
    "gym",
    "other",
    "unknown",
  ]),
  bhk: z.number().int().nullable(),
  carpetAreaSqft: z.number().nullable().describe("Area of the whole property"),

  scopeLevel: z.enum([
    "full_home", // full home / full office fitout
    "partial", // 2+ rooms or a floor
    "single_room",
    "advice_only", // ideas, suggestions, consultation-only visit
    "decor_only", // colours, styling, rearranging
    "furniture_only",
    "vastu_only",
    "unknown",
  ]),
  roomsInScope: z.array(z.string()).describe("e.g. ['kitchen', 'living room', 'master bedroom']"),
  wantsExecution: z.enum(["yes", "no", "unclear"]),
  readiness: z
    .enum(["ready", "exploring", "unknown"])
    .describe("'exploring' only if they say they're not planning to go ahead soon / just collecting ideas or brochures. A real property with a real need is 'ready' even if they're checking first."),

  completionNeededBy: z.string().nullable().describe("ISO date the project must be finished; month-only → last day of that month"),
  siteAvailableFrom: z
    .string()
    .nullable()
    .describe("ISO date the site PHYSICALLY becomes workable (possession, tenants/owners moving out). Null if it's available now or not said."),
  preferredStart: z
    .string()
    .nullable()
    .describe("ISO date the caller would LIKE design or execution to start, if they said. A preference, not a constraint."),
  timelineFlexible: z.boolean().nullable().describe("'no rush', 'flexible', 'whenever'"),
  openToLaterStart: z.boolean().nullable().describe("If the timeline is too tight, caller said they could start later"),
  timelineNotes: z.string().nullable(),

  budgetVolunteered: z.boolean(),
  budgetMinLakh: z.number().nullable(),
  budgetMaxLakh: z.number().nullable(),

  decisionMaker: z.enum([
    "self", // owner / founder / co-owner on the call
    "authorised", // calling for someone who has said go ahead
    "represented", // calling for owners who will decide and attend
    "research_only", // "just checking for my in-laws"
    "unknown",
  ]),

  rented: z.boolean().nullable(),
  structuralChangesWanted: z.boolean().nullable(),

  source: z.enum(["referral", "instagram", "google", "linkedin", "builder", "press", "whatsapp_forward", "other", "unknown"]),
  referrerName: z.string().nullable(),
  mentionsFounderConnection: z.boolean().describe("Caller cites a personal connection to Nikhil"),

  consultPreference: z.enum(["site_visit", "studio", "video", "unspecified"]),
  availabilityNotes: z.string().nullable().describe("e.g. 'weekdays after 6pm or weekends'"),
  stylePreferences: z.string().nullable(),
  otherNotes: z.string().nullable().describe("Anything a designer should know: shortlisting other studios, opinionated, urgency"),

  language: z.enum(["english", "hindi", "marathi", "mixed"]),
  frustrated: z.boolean(),
  askedAboutPricing: z.boolean(),
});

export type ExtractedLead = z.infer<typeof ExtractedLead>;

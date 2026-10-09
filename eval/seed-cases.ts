import type { ExtractedLead } from "../src/lib/lead";
import type { Route, Verdict } from "../src/lib/qualify";

// The 40 September 2026 enquiries (Case 03 Seed Data) as labelled test cases.
// `facts` = what a correct extraction of the enquiry contains (ground truth for Gemini evals).
// `expect` = what Nikhil's rubric should decide (ground truth for the rules engine).
// `persona` = brief for the simulated caller when we test the Vaani agent by voice.
// WhatsApp and web-form enquiries are out of build scope but reused here as extra phone scenarios.

export type SeedCase = {
  id: string;
  channel: "phone" | "whatsapp" | "form";
  receivedAt: string;
  persona: string;
  facts: ExtractedLead;
  expect: { verdict: Verdict; route: Route; flags?: string[] };
};

const base: ExtractedLead = {
  callType: "new_enquiry",
  complaint: false,
  name: null,
  locality: null,
  city: "unknown",
  segment: "residential",
  propertyType: "apartment",
  bhk: null,
  carpetAreaSqft: null,
  scopeLevel: "unknown",
  roomsInScope: [],
  wantsExecution: "unclear",
  readiness: "unknown",
  completionNeededBy: null,
  siteAvailableFrom: null,
  timelineFlexible: null,
  openToLaterStart: null,
  timelineNotes: null,
  budgetVolunteered: false,
  budgetMinLakh: null,
  budgetMaxLakh: null,
  decisionMaker: "unknown",
  rented: null,
  structuralChangesWanted: null,
  source: "unknown",
  referrerName: null,
  mentionsFounderConnection: false,
  consultPreference: "unspecified",
  availabilityNotes: null,
  stylePreferences: null,
  otherNotes: null,
  language: "english",
  frustrated: false,
  askedAboutPricing: false,
};
const f = (o: Partial<ExtractedLead>): ExtractedLead => ({ ...base, ...o });
const fullHome = { scopeLevel: "full_home", wantsExecution: "yes", readiness: "ready" } as const;
const partial = { scopeLevel: "partial", wantsExecution: "yes", readiness: "ready" } as const;

export const seedCases: SeedCase[] = [
  // ---------------- Phone ----------------
  {
    id: "T01", channel: "phone", receivedAt: "2026-09-02T10:23:00+05:30",
    persona: "Priya, referred by friend Shruti Joshi. 3BHK, Dahanukar Colony Kothrud, 1,400 sq ft carpet, still a builder flat. Whole home: kitchen, living, both bedrooms. Done by March, no rush. Co-owner with husband, who has agreed.",
    facts: f({ ...fullHome, name: "Priya", locality: "Kothrud", city: "pune", bhk: 3, carpetAreaSqft: 1400, roomsInScope: ["kitchen", "living room", "bedroom", "bedroom"], completionNeededBy: "2027-03-31", timelineFlexible: true, decisionMaker: "authorised", source: "referral", referrerName: "Shruti Joshi" }),
    expect: { verdict: "green", route: "book" },
  },
  {
    id: "T02", channel: "phone", receivedAt: "2026-09-03T14:41:00+05:30",
    persona: "Saw Instagram. 2BHK in Wakad, ~950 sq ft. Full redesign: modular kitchen, wardrobes, living, both bedrooms. Moving in November, design from October. Pushes twice for a price range.",
    facts: f({ ...fullHome, locality: "Wakad", city: "pune", bhk: 2, carpetAreaSqft: 950, roomsInScope: ["kitchen", "wardrobes", "living room", "bedroom", "bedroom"], completionNeededBy: "2026-11-30", source: "instagram", askedAboutPricing: true }),
    // Front desk never asked who decides; November move-in is ~12.7 weeks out
    expect: { verdict: "amber", route: "book_with_note", flags: ["price_sensitive"] },
  },
  {
    id: "T03", channel: "phone", receivedAt: "2026-09-03T16:15:00+05:30",
    persona: "Suresh Patil from Nashik, found you on LinkedIn. Wants home office and study redone. Asks if a smaller project could be an exception.",
    facts: f({ ...partial, name: "Suresh Patil", locality: "Nashik", city: "other", roomsInScope: ["home office", "study"], source: "linkedin", decisionMaker: "self" }),
    expect: { verdict: "red", route: "close" },
  },
  {
    id: "T04", channel: "phone", receivedAt: "2026-09-04T11:07:00+05:30",
    persona: "Wants someone to come and suggest colours and furniture arrangement for the living room. Not doing the full thing. Just exploring.",
    facts: f({ scopeLevel: "advice_only", wantsExecution: "no", readiness: "exploring", roomsInScope: ["living room"] }),
    expect: { verdict: "red", route: "close" },
  },
  {
    id: "T05", channel: "phone", receivedAt: "2026-09-05T10:52:00+05:30",
    persona: "Aarti Mehta; Vikram Agarwal, a close friend of Nikhil's, asked her to call. 4BHK Koregaon Park, 2,400 sq ft carpet. Complete redesign incl. flooring, kitchen, four bedrooms. Already moved out. Back in by February. Wants a site visit.",
    facts: f({ ...fullHome, name: "Aarti Mehta", locality: "Koregaon Park", city: "pune", bhk: 4, carpetAreaSqft: 2400, roomsInScope: ["flooring", "kitchen", "bedroom x4"], completionNeededBy: "2027-02-28", decisionMaker: "self", source: "referral", referrerName: "Vikram Agarwal", mentionsFounderConnection: true, consultPreference: "site_visit" }),
    expect: { verdict: "green", route: "book", flags: ["vip_referral", "site_visit_requested"] },
  },
  {
    id: "T06", channel: "phone", receivedAt: "2026-09-05T15:28:00+05:30",
    persona: "Startup founder. First office in Baner, 800 sq ft bare shell. Workstations for 20, a cabin, meeting room, break area. Operational by December.",
    facts: f({ ...fullHome, segment: "commercial", propertyType: "office", locality: "Baner", city: "pune", carpetAreaSqft: 800, roomsInScope: ["workstations", "cabin", "meeting room", "break area"], completionNeededBy: "2026-12-31", decisionMaker: "self" }),
    expect: { verdict: "green", route: "book" },
  },
  {
    id: "T07", channel: "phone", receivedAt: "2026-09-08T09:44:00+05:30",
    persona: "Wants living room and kitchen redone before Diwali (~3 weeks). Asks if just the living room is possible. Open to starting after Diwali but wants to think.",
    facts: f({ ...partial, roomsInScope: ["living room", "kitchen"], completionNeededBy: "2026-09-29", openToLaterStart: true }),
    expect: { verdict: "red", route: "nurture" },
  },
  {
    id: "T08", channel: "phone", receivedAt: "2026-09-09T22:47:00+05:30",
    persona: "Calls at 10:47pm and hangs up as soon as the agent answers.",
    facts: f({ callType: "silent_or_dropped" }),
    expect: { verdict: "not_a_lead", route: "log" },
  },
  {
    id: "T09", channel: "phone", receivedAt: "2026-09-10T11:32:00+05:30",
    persona: "Sheetal Deshpande, existing client. 2BHK Viman Nagar project running 3 months; designer Aryan hasn't replied in five days. Angry. Wants a callback from Nikhil or someone senior.",
    facts: f({ callType: "existing_client", complaint: true, name: "Sheetal Deshpande", locality: "Viman Nagar", city: "pune", frustrated: true }),
    expect: { verdict: "not_a_lead", route: "escalate" },
  },
  {
    id: "T10", channel: "phone", receivedAt: "2026-09-11T14:04:00+05:30",
    persona: "1BHK in Kharadi, 550 sq ft. Kitchen and one bedroom. Budget 1 to 1.5 lakh maximum for everything.",
    facts: f({ ...partial, locality: "Kharadi", city: "pune", bhk: 1, carpetAreaSqft: 550, roomsInScope: ["kitchen", "bedroom"], budgetVolunteered: true, budgetMinLakh: 1, budgetMaxLakh: 1.5 }),
    expect: { verdict: "red", route: "close" },
  },
  {
    id: "T11", channel: "phone", receivedAt: "2026-09-12T10:18:00+05:30",
    persona: "Tenant on a 3-year lease, 2BHK in Baner. Living room, bedroom, kitchen. No structural changes; landlord is fine with it.",
    facts: f({ ...partial, locality: "Baner", city: "pune", bhk: 2, roomsInScope: ["living room", "bedroom", "kitchen"], decisionMaker: "self", rented: true, structuralChangesWanted: false }),
    expect: { verdict: "amber", route: "book_with_note", flags: ["rented"] },
  },
  {
    id: "T12", channel: "phone", receivedAt: "2026-09-15T10:05:00+05:30",
    persona: "Anand Sharma. New villa in Kalyani Nagar, 5,500 sq ft, ground plus two floors, completely empty. Full end-to-end. Move in March, no rush. Wants principal designer on site this week or next.",
    facts: f({ ...fullHome, name: "Anand Sharma", propertyType: "villa", locality: "Kalyani Nagar", city: "pune", carpetAreaSqft: 5500, completionNeededBy: "2027-03-31", timelineFlexible: true, decisionMaker: "self", consultPreference: "site_visit" }),
    expect: { verdict: "green", route: "book", flags: ["site_visit_requested"] },
  },
  {
    id: "T13", channel: "phone", receivedAt: "2026-09-16T12:19:00+05:30",
    persona: "3BHK in Aundh, 1,100 sq ft. Kitchen, wardrobes in both bedrooms, living room. Keeps asking for a rough cost range.",
    facts: f({ ...partial, locality: "Aundh", city: "pune", bhk: 3, carpetAreaSqft: 1100, roomsInScope: ["kitchen", "wardrobes", "living room"], askedAboutPricing: true }),
    expect: { verdict: "amber", route: "book_with_note", flags: ["price_sensitive"] },
  },
  {
    id: "T14", channel: "phone", receivedAt: "2026-09-17T11:41:00+05:30",
    persona: "Son calling for his parents' new-possession 3BHK in Hadapsar. Parents don't use phones much; they'll decide and attend the consultation.",
    facts: f({ ...fullHome, locality: "Hadapsar", city: "pune", bhk: 3, decisionMaker: "represented" }),
    expect: { verdict: "amber", route: "book_with_note" },
  },
  {
    id: "T15", channel: "phone", receivedAt: "2026-09-18T15:12:00+05:30",
    persona: "Smita. Possession of 2BHK in Undri (875 sq ft) in about six weeks; builder will let you in now. Full home. Husband said go ahead and book.",
    facts: f({ ...fullHome, name: "Smita", locality: "Undri", city: "pune", bhk: 2, carpetAreaSqft: 875, roomsInScope: ["kitchen", "wardrobes", "living room"], siteAvailableFrom: "2026-10-30", decisionMaker: "authorised" }),
    expect: { verdict: "green", route: "book" },
  },
  {
    id: "T16", channel: "phone", receivedAt: "2026-09-19T10:38:00+05:30",
    persona: "Girish Nair, called Monday about his 3BHK in Viman Nagar, was promised a callback, nobody called. Annoyed.",
    facts: f({ ...fullHome, callType: "returning_enquiry", name: "Girish Nair", locality: "Viman Nagar", city: "pune", bhk: 3, frustrated: true }),
    expect: { verdict: "amber", route: "book_with_note", flags: ["frustrated", "repeat_caller"] },
  },
  {
    id: "T17", channel: "phone", receivedAt: "2026-09-22T14:16:00+05:30",
    persona: "Ritu Kapoor from Pimple Saudagar; got cut off a minute ago. 3BHK, 1,050 sq ft, builder furniture. Kitchen, wardrobes, living room. Done by March.",
    facts: f({ ...partial, name: "Ritu Kapoor", locality: "Pimple Saudagar", city: "pcmc", bhk: 3, carpetAreaSqft: 1050, roomsInScope: ["kitchen", "wardrobes", "living room"], completionNeededBy: "2027-03-31", timelineFlexible: true }),
    expect: { verdict: "amber", route: "book_with_note" },
  },
  {
    id: "T18", channel: "phone", receivedAt: "2026-09-23T11:55:00+05:30",
    persona: "Runs a coworking space; wants a 180 sq ft pod done nicely — lighting, desk, storage.",
    facts: f({ ...fullHome, segment: "commercial", propertyType: "coworking", carpetAreaSqft: 180, decisionMaker: "self" }),
    expect: { verdict: "amber", route: "review" },
  },
  {
    id: "T19", channel: "phone", receivedAt: "2026-09-24T16:02:00+05:30",
    persona: "Opening a restaurant in Koregaon Park, loves your work, asks for a referral if you can't.",
    facts: f({ ...fullHome, segment: "commercial", propertyType: "restaurant", locality: "Koregaon Park", city: "pune", decisionMaker: "self" }),
    expect: { verdict: "red", route: "close" },
  },
  {
    id: "T20", channel: "phone", receivedAt: "2026-09-25T09:15:00+05:30",
    persona: "Pooja. 2BHK Magarpatta, ~900 sq ft. Kitchen, both bedrooms, living. Flexible; January execution start ideal. Owner with husband; both will attend.",
    facts: f({ ...fullHome, name: "Pooja", locality: "Magarpatta", city: "pune", bhk: 2, carpetAreaSqft: 900, timelineFlexible: true, timelineNotes: "Execution start January", decisionMaker: "self" }),
    expect: { verdict: "green", route: "book" },
  },

  // ---------------- WhatsApp (replayed as calls) ----------------
  {
    id: "W01", channel: "whatsapp", receivedAt: "2026-09-03T19:14:00+05:30",
    persona: "Kiran Mazumdar, referred by Sonali Patel. 4BHK Viman Nagar, 1,800 sq ft, empty, has possession. Full interiors. Design October, execution November. Only free weekdays after 6pm or weekends. Wants a site visit.",
    facts: f({ ...fullHome, name: "Kiran Mazumdar", locality: "Viman Nagar", city: "pune", bhk: 4, carpetAreaSqft: 1800, siteAvailableFrom: "2026-09-03", decisionMaker: "self", source: "referral", referrerName: "Sonali Patel", consultPreference: "site_visit", availabilityNotes: "Weekdays after 6pm or weekends" }),
    expect: { verdict: "green", route: "book" },
  },
  {
    id: "W02", channel: "whatsapp", receivedAt: "2026-09-08T14:31:00+05:30",
    persona: "Only asks how much you charge per sq ft for a 2BHK. Gives nothing else unless asked.",
    facts: f({ bhk: 2, askedAboutPricing: true }),
    expect: { verdict: "amber", route: "review" },
  },
  {
    id: "W03", channel: "whatsapp", receivedAt: "2026-09-12T10:45:00+05:30",
    persona: "Sunil Yadav, speaks Hindi. Flat in Pimple Nilakh, 3BHK, wants the whole home done. Says 'budget bhi hai' without a number. Any Saturday morning works.",
    facts: f({ ...fullHome, name: "Sunil Yadav", locality: "Pimple Nilakh", city: "pcmc", bhk: 3, decisionMaker: "self", language: "hindi", availabilityNotes: "Saturday mornings" }),
    expect: { verdict: "amber", route: "book_with_note" },
  },
  {
    id: "W04", channel: "whatsapp", receivedAt: "2026-09-15T15:18:00+05:30",
    persona: "Chinmay Kulkarni. 1,200 sq ft bare-shell office in Chinchwad. Workstations for 30, two cabins, a meeting room. Operational by January.",
    facts: f({ ...fullHome, name: "Chinmay Kulkarni", segment: "commercial", propertyType: "office", locality: "Chinchwad", city: "pcmc", carpetAreaSqft: 1200, completionNeededBy: "2027-01-31" }),
    expect: { verdict: "amber", route: "book_with_note" },
  },
  {
    id: "W05", channel: "whatsapp", receivedAt: "2026-09-20T18:44:00+05:30",
    persona: "Meena Joshi. 2BHK in Baner, wants her home designed, asks what the process is. Vague on scope.",
    facts: f({ name: "Meena Joshi", locality: "Baner", city: "pune", bhk: 2 }),
    expect: { verdict: "amber", route: "review" },
  },
  {
    id: "W06", channel: "whatsapp", receivedAt: "2026-09-17T11:22:00+05:30",
    persona: "Tanvi Kulkarni, referred by Ashok Bhosale. Just bought a 3BHK in Koregaon Park, possession 15 October. End-to-end design. Free 21 or 22 October for a site visit.",
    facts: f({ ...fullHome, name: "Tanvi Kulkarni", locality: "Koregaon Park", city: "pune", bhk: 3, siteAvailableFrom: "2026-10-15", decisionMaker: "self", source: "referral", referrerName: "Ashok Bhosale", consultPreference: "site_visit" }),
    expect: { verdict: "green", route: "book" },
  },
  {
    id: "W07", channel: "whatsapp", receivedAt: "2026-09-05T16:52:00+05:30",
    persona: "Rohit Singh opening a 2,500 sq ft gym in Kothrud, wants modern high-energy interiors.",
    facts: f({ ...fullHome, name: "Rohit Singh", segment: "commercial", propertyType: "gym", locality: "Kothrud", city: "pune", carpetAreaSqft: 2500, decisionMaker: "self" }),
    expect: { verdict: "red", route: "close" },
  },
  {
    id: "W08", channel: "whatsapp", receivedAt: "2026-09-10T08:44:00+05:30",
    persona: "Pradeep Garg. Says he messaged 4 days ago, nobody replied. 2BHK in Aundh, 850 sq ft, full interiors. Not sure he wants to work with you now.",
    facts: f({ ...fullHome, callType: "returning_enquiry", name: "Pradeep Garg", locality: "Aundh", city: "pune", bhk: 2, carpetAreaSqft: 850, frustrated: true }),
    expect: { verdict: "amber", route: "book_with_note", flags: ["frustrated", "repeat_caller"] },
  },
  {
    id: "W09", channel: "whatsapp", receivedAt: "2026-09-25T15:18:00+05:30",
    persona: "Neha Deshpande. 3BHK in Aundh (Sunderban area). Living and dining, maybe kitchen. Full execution — design, materials, furniture.",
    facts: f({ ...partial, name: "Neha Deshpande", locality: "Aundh", city: "pune", bhk: 3, roomsInScope: ["living room", "dining", "kitchen"] }),
    expect: { verdict: "amber", route: "book_with_note" },
  },
  {
    id: "W10", channel: "whatsapp", receivedAt: "2026-09-22T18:12:00+05:30",
    persona: "Vivek Rao. 3BHK in Hinjewadi. Wants a brochure. Still early stage, just exploring.",
    facts: f({ name: "Vivek Rao", locality: "Hinjewadi", city: "pcmc", bhk: 3, readiness: "exploring" }),
    // Front desk marked "re-engage in 4–6 weeks"
    expect: { verdict: "amber", route: "nurture" },
  },

  // ---------------- Web form (replayed as calls) ----------------
  {
    id: "F01", channel: "form", receivedAt: "2026-09-01T09:44:00+05:30",
    persona: "Sumit Bhatt. 2BHK Kalyani Nagar, ~920 sq ft, moved in 8 months ago. Modular kitchen, both bedrooms, living, home-office corner. Execution December, done by February. Won't discuss budget. He and wife will attend. Found you on Instagram.",
    facts: f({ ...fullHome, name: "Sumit Bhatt", locality: "Kalyani Nagar", city: "pune", bhk: 2, carpetAreaSqft: 920, completionNeededBy: "2027-02-28", decisionMaker: "self", source: "instagram" }),
    expect: { verdict: "green", route: "book" },
  },
  {
    id: "F02", channel: "form", receivedAt: "2026-09-04T19:12:00+05:30",
    persona: "Laleh Contractor, recommended by Priya Wadia. 3BHK Baner, 1,100 sq ft builder flat. Master bedroom and living room only. No deadline. First time doing interiors.",
    facts: f({ ...partial, name: "Laleh Contractor", locality: "Baner", city: "pune", bhk: 3, carpetAreaSqft: 1100, roomsInScope: ["master bedroom", "living room"], timelineFlexible: true, source: "referral", referrerName: "Priya Wadia" }),
    expect: { verdict: "amber", route: "book_with_note" },
  },
  {
    id: "F03", channel: "form", receivedAt: "2026-09-06T11:18:00+05:30",
    persona: "Nilesh Dhamdhere. 3BHK independent house in Talegaon Dabhade, 1,400 sq ft, just got possession. Everything from scratch, 3–4 months. Budget ₹15–20 lakh. Knows Talegaon is a bit outside Pune.",
    facts: f({ ...fullHome, name: "Nilesh Dhamdhere", propertyType: "independent_house", locality: "Talegaon Dabhade", city: "pune", bhk: 3, carpetAreaSqft: 1400, timelineFlexible: true, budgetVolunteered: true, budgetMinLakh: 15, budgetMaxLakh: 20, decisionMaker: "self", source: "google" }),
    expect: { verdict: "red", route: "close" },
  },
  {
    id: "F04", channel: "form", receivedAt: "2026-09-09T14:37:00+05:30",
    persona: "Rajesh. Wants to know the cost of interior design, 'as soon as possible', budget 'reasonable'. Somewhere in Pune. Vague about everything.",
    facts: f({ name: "Rajesh", city: "pune", askedAboutPricing: true, source: "whatsapp_forward" }),
    expect: { verdict: "amber", route: "review", flags: ["price_sensitive"] },
  },
  {
    id: "F05", channel: "form", receivedAt: "2026-09-11T10:05:00+05:30",
    persona: "Sheena Menon, Operations Head at NovaSpark. 2,200 sq ft shell office, Hinjewadi Phase 1. Operational by 15 January, team of 60. ₹60–80 lakh all-in. CEO worked with you before. Speed matters.",
    facts: f({ ...fullHome, name: "Sheena Menon", segment: "commercial", propertyType: "office", locality: "Hinjewadi Phase 1", city: "pcmc", carpetAreaSqft: 2200, completionNeededBy: "2027-01-15", budgetVolunteered: true, budgetMinLakh: 60, budgetMaxLakh: 80, source: "referral", referrerName: "Amey Joshi" }),
    expect: { verdict: "amber", route: "book_with_note" },
  },
  {
    id: "F06", channel: "form", receivedAt: "2026-09-14T20:52:00+05:30",
    persona: "Preethi Nair. 4BHK ground floor on NIBM Road, ~1,950 sq ft. Kitchen replacement, three bedrooms, living room flooring and design, a new study. Execution from February 2027. ₹35–40 lakh, not flexible upward. Shortlisted 3 studios; loves warm, earthy, minimal.",
    facts: f({ ...partial, name: "Preethi Nair", locality: "NIBM Road", city: "pune", bhk: 4, carpetAreaSqft: 1950, roomsInScope: ["kitchen", "bedroom", "bedroom", "bedroom", "living room", "study"], timelineFlexible: true, budgetVolunteered: true, budgetMinLakh: 35, budgetMaxLakh: 40, decisionMaker: "self", source: "press", stylePreferences: "Warm, earthy, minimal", otherNotes: "Comparing 3 studios" }),
    expect: { verdict: "green", route: "book" },
  },
  {
    id: "F07", channel: "form", receivedAt: "2026-09-16T15:11:00+05:30",
    persona: "Anonymous. Only wants the per-sq-ft rate before deciding whether to enquire. Refuses to share details.",
    facts: f({ city: "pune", askedAboutPricing: true, source: "instagram" }),
    expect: { verdict: "amber", route: "review", flags: ["price_sensitive"] },
  },
  {
    id: "F08", channel: "form", receivedAt: "2026-09-18T18:44:00+05:30",
    persona: "Divya Hegde. 2BHK Wakad, ~875 sq ft. Guests arriving from the US in 3 weeks; wants living room and kitchen presentable before then. ₹4–5 lakh.",
    facts: f({ ...partial, name: "Divya Hegde", locality: "Wakad", city: "pune", bhk: 2, carpetAreaSqft: 875, roomsInScope: ["living room", "kitchen"], completionNeededBy: "2026-10-09", openToLaterStart: false, budgetVolunteered: true, budgetMinLakh: 4, budgetMaxLakh: 5, source: "google" }),
    expect: { verdict: "red", route: "close" },
  },
  {
    id: "F09", channel: "form", receivedAt: "2026-09-20T11:30:00+05:30",
    persona: "Amol Patil, referred by builder Rohan Lifescapes. 3BHK in Kondhwa, 1,150 sq ft, bare builder handover. Move in by March 2027. Ready to book at the earliest.",
    facts: f({ ...fullHome, name: "Amol Patil", locality: "Kondhwa", city: "pune", bhk: 3, carpetAreaSqft: 1150, completionNeededBy: "2027-03-31", source: "builder", referrerName: "Rohan Lifescapes" }),
    expect: { verdict: "amber", route: "book_with_note" },
  },
  {
    id: "F10", channel: "form", receivedAt: "2026-09-26T16:22:00+05:30",
    persona: "Siddharth Gupta. 3BHK Aundh, ~1,300 sq ft. He and wife both WFH — need two workspaces plus full flat design. Start immediately. ₹18–22 lakh. Both product designers, opinionated, want a collaborative process.",
    facts: f({ ...fullHome, name: "Siddharth Gupta", locality: "Aundh", city: "pune", bhk: 3, carpetAreaSqft: 1300, timelineFlexible: true, budgetVolunteered: true, budgetMinLakh: 18, budgetMaxLakh: 22, decisionMaker: "self", source: "linkedin", otherNotes: "Product designers; want a collaborative process" }),
    expect: { verdict: "green", route: "book", flags: ["budget_tight"] },
  },
];

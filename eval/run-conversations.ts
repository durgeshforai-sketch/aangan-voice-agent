// Offline rehearsal of the phone agent: Gemini plays Aanya (with docs/vaani-agent-prompt.md and
// simulated tools) and a simulated caller from each seed persona. The transcript then goes through
// the real extraction + rules, and is checked against what should happen.
//   npm run eval:conversations               (all 40)
//   npm run eval:conversations -- T02 T13 F07 (some)
// Transcripts are saved to eval/out/ for reading.
import { config } from "dotenv";
config({ path: ".env.local" });
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { GoogleGenAI, type Content } from "@google/genai";
import { seedCases, type SeedCase } from "./seed-cases";
import { extractFromTranscript } from "../src/lib/extract";
import { qualify, type Route } from "../src/lib/qualify";
import { withRetry } from "../src/lib/retry";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const AGENT_PROMPT = readFileSync("docs/vaani-agent-prompt.md", "utf8").split(/^---$/m)[1];
const MAX_TURNS = 18;
// The live Vaani flow has no custom tools (Vaani doesn't attach them); booking happens after the call
const USE_TOOLS = process.env.EVAL_TOOLS === "1";

// With an agent that asks the right questions, some historical outcomes legitimately improve
// (e.g. "review" becomes bookable once scope is asked). These are the acceptable routes per label.
const ACCEPT: Record<Route, Route[]> = {
  book: ["book", "book_with_note"],
  book_with_note: ["book", "book_with_note"],
  review: ["review", "book", "book_with_note"],
  nurture: ["nurture", "book", "book_with_note", "review"],
  close: ["close"],
  escalate: ["escalate"],
  log: ["log"],
};

const TOOLS = [
  {
    functionDeclarations: [
      { name: "lookup_caller", description: "Look up the caller's number at call start", parametersJsonSchema: { type: "object", properties: { phone: { type: "string" } } } },
      { name: "check_availability", description: "Find consultation slots", parametersJsonSchema: { type: "object", properties: { mode: { type: "string", enum: ["site_visit", "studio"] }, preference: { type: "string" }, from_date: { type: "string", description: "YYYY-MM-DD, earliest date the caller wants" } } } },
      {
        name: "book_consultation",
        description: "Book a consultation slot",
        parametersJsonSchema: {
          type: "object",
          properties: { start: { type: "string" }, mode: { type: "string" }, name: { type: "string" }, phone: { type: "string" }, address: { type: "string" } },
          required: ["start", "name", "phone"],
        },
      },
      { name: "escalate", description: "Flag an urgent issue for a senior person", parametersJsonSchema: { type: "object", properties: { reason: { type: "string" }, name: { type: "string" }, phone: { type: "string" } } } },
    ],
  },
];

function fakeTool(c: SeedCase, name: string, args: Record<string, unknown>) {
  const day = name === "check_availability" && typeof args.from_date === "string" ? new Date(`${args.from_date}T00:00:00+05:30`) : new Date(c.receivedAt);
  const slot = (d: number, h: number) => new Date(day.getTime() + d * 864e5).toISOString().slice(0, 10) + `T${String(h).padStart(2, "0")}:00:00+05:30`;
  switch (name) {
    case "lookup_caller":
      if (c.id === "T09") return { status: "existing_client", name: "Sheetal Deshpande", project: "2BHK Viman Nagar, designer Aryan" };
      if (c.id === "T16" || c.id === "W08") return { status: "repeat_caller", previous: "Called earlier this week about a flat; no follow-up was made." };
      return { status: "new" };
    case "check_availability":
      return { ok: true, slots: [{ start: slot(2, 11), label: "11am, two days from now" }, { start: slot(3, 18), label: "6pm, three days from now" }, { start: slot(5, 10), label: "10am Saturday" }], say: "Offer two of these." };
    case "book_consultation":
      return { ok: true, bookingId: "sim-123", when: String(args.start), say: "Booked. Read it back." };
    case "escalate":
      return { ok: true, callbackBy: "within 15 minutes", say: "Flagged as urgent. Someone senior will call within 15 minutes." };
  }
  return { ok: false };
}

const callerSystem = (c: SeedCase) => `You are role-playing a person phoning Aangan Studio, an interior design studio in Pune. The call date is ${c.receivedAt.slice(0, 10)}.
Your brief: ${c.persona}
Rules:
- Speak like a real Indian caller on the phone: 1–3 short sentences per turn. Use Hindi if your brief says you speak Hindi.
- Don't volunteer everything at once; answer what you're asked. Bring up the things your brief says you care about (e.g. pushing for a price, wanting a callback).
- If asked something your brief doesn't cover, answer plausibly and consistently with your brief (e.g. you're the owner and there's no rush), but never contradict the brief.
- If your phone number is asked, it's 98220 ${c.id.replace(/\D/g, "").padStart(5, "1")}.
- When the conversation has naturally ended (goodbyes said), reply with exactly: [END]
${c.id === "T08" ? "- You say nothing at all. Reply with exactly: [SILENCE] each time, and after the second time reply [END]." : ""}`;

async function converse(c: SeedCase) {
  const agentHistory: Content[] = [{ role: "user", parts: [{ text: "(Incoming call connected. Caller's number: +91 98220 00000. Greet the caller.)" }] }];
  const callerHistory: Content[] = [];
  const lines: string[] = [];
  let booked = false;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Agent speaks (resolving any tool calls first)
    let agentText = "";
    for (let hop = 0; hop < 4; hop++) {
      const res = await withRetry(() => ai.models.generateContent({ model: MODEL, contents: agentHistory, config: { systemInstruction: AGENT_PROMPT, ...(USE_TOOLS ? { tools: TOOLS } : {}), temperature: 0.4 } }));
      const content = res.candidates?.[0]?.content;
      if (!content) break;
      agentHistory.push(content);
      const calls = res.functionCalls ?? [];
      if (!calls.length) {
        agentText = res.text ?? "";
        break;
      }
      agentHistory.push({
        role: "user",
        parts: calls.map((fc) => {
          if (fc.name === "book_consultation") booked = true;
          lines.push(`[tool] ${fc.name}(${JSON.stringify(fc.args)})`);
          return { functionResponse: { name: fc.name!, response: fakeTool(c, fc.name!, (fc.args ?? {}) as Record<string, unknown>) } };
        }),
      });
    }
    lines.push(`Agent: ${agentText.trim()}`);
    callerHistory.push({ role: "user", parts: [{ text: agentText }] });

    // Caller replies
    const r = await withRetry(() => ai.models.generateContent({ model: MODEL, contents: callerHistory, config: { systemInstruction: callerSystem(c), temperature: 0.7 } }));
    const said = (r.text ?? "").trim();
    if (said.includes("[END]")) break;
    callerHistory.push({ role: "model", parts: [{ text: said }] });
    lines.push(`Caller: ${said}`);
    agentHistory.push({ role: "user", parts: [{ text: said }] });
  }
  return { transcript: lines.filter((l) => !l.startsWith("[tool]")).join("\n"), full: lines.join("\n"), booked };
}

// Agent-side guardrail checks on the transcript
const agentLines = (t: string) => t.split("\n").filter((l) => l.startsWith("Agent:")).join("\n");
const PROMISE = /(i('| wi)ll|we('| wi)ll|let me) (send|share|whatsapp|email|forward)/i;
const PRICE = /(₹|rs\.?\s?\d|rupees|\d[\d,.]*\s*(lakh|lac|lakhs|k\b|thousand|crore)|per\s*(sq|square)\s*(ft|feet|foot))/i;
const ASKED_TIMELINE = /(when would you|need it (complete|done|finished)|timeline|by when|kab tak)/i;
const ASKED_TIMES = /(days?|times?|when).{0,40}(suit|work|convenient|prefer)|which days|what time/i;
const CLAIMED_BOOKED = /(is|are|you're|you are|has been|have been) (now )?(booked|confirmed) for|booked you (in )?for|confirmed for (mon|tue|wed|thu|fri|sat|sun|\d)/i;
const ASKED_DECIDER = /(anyone else|who else|involved in (the )?decid|decision|decide)/i;

const only = process.argv.slice(2);
const cases = seedCases.filter((c) => !only.length || only.includes(c.id));
mkdirSync("eval/out", { recursive: true });
let fails = 0;

async function runCase(c: SeedCase): Promise<string[]> {
  const out: string[] = [];
  try {
    const conv = await converse(c);
    writeFileSync(`eval/out/${c.id}.txt`, conv.full + "\n");
    const { extraction } = await extractFromTranscript(conv.transcript, new Date(c.receivedAt));
    const q = qualify(extraction.lead, new Date(c.receivedAt));
    const agent = agentLines(conv.transcript);
    const priceHit = agent.match(PRICE)?.[0];
    const problems: string[] = [];
    const ok = [...ACCEPT[c.expect.route], ...(c.expect.alsoOk ?? [])];
    if (!ok.includes(q.route)) problems.push(`route ${q.route}, want ${ok.join("|")}`);
    if (extraction.agentQuotedPrice) problems.push("extraction says agent QUOTED A PRICE");
    if (priceHit && c.expect.route !== "close") problems.push(`agent said "${priceHit}" — check for a price`);
    const promise = agent.match(PROMISE)?.[0];
    if (promise) problems.push(`agent promised "${promise}…" — nothing sends that`);
    const isLead = !["escalate", "log"].includes(c.expect.route);
    const bookableNow = q.route === "book" || q.route === "book_with_note";
    if (isLead && c.expect.route !== "close" && !ASKED_TIMELINE.test(agent) && !extraction.lead.completionNeededBy && !extraction.lead.timelineFlexible && !extraction.lead.siteAvailableFrom && !extraction.lead.preferredStart && extraction.lead.scopeLevel !== "unknown") problems.push("never asked about timeline");
    if (isLead && bookableNow && !ASKED_DECIDER.test(agent) && extraction.lead.decisionMaker === "unknown") problems.push("never asked who decides");
    if (USE_TOOLS) {
      if (bookableNow && !conv.booked) problems.push("qualified but not booked on the call");
      if (c.expect.route === "close" && conv.booked) problems.push("booked a lead that should be declined");
    } else {
      if (bookableNow && !ASKED_TIMES.test(agent) && !extraction.lead.availabilityNotes) problems.push("qualified but never asked for preferred days/times");
      if (CLAIMED_BOOKED.test(agent)) problems.push("claimed a slot is booked (it isn't until after the call)");
    }
    const turns = conv.transcript.split("\n").length;
    out.push(`${problems.length ? "✗" : "✓"} ${c.id.padEnd(4)} ${q.verdict}/${q.route}${conv.booked ? " · booked" : ""} · ${turns} lines`);
    for (const p of problems) out.push(`      · ${p}`);
    if (problems.length) fails++;
  } catch (err) {
    fails++;
    out.push(`✗ ${c.id} ERROR ${String(err).slice(0, 160)}`);
  }
  return out;
}

const queue = [...cases];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) console.log((await runCase(c)).join("\n"));
  }),
);
console.log(`\n${cases.length - fails}/${cases.length} conversations passed. Transcripts in eval/out/.`);
process.exit(fails ? 1 : 0);

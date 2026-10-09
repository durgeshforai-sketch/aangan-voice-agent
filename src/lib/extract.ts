import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { ExtractedLead } from "./lead";

// Gemini Flash reads the transcript and returns facts. It does NOT decide — qualify.ts does.

export const Extraction = z.object({
  lead: ExtractedLead,
  summary: z
    .string()
    .describe("2–3 sentences for the designer: who, what, where, and anything sensitive. No prices."),
  callerPhoneSpoken: z
    .string()
    .nullable()
    .describe("Phone number the caller confirmed on the call, E.164 if possible (+91…)"),
  agentBooked: z.boolean().describe("The agent confirmed a consultation booking on this call"),
  agentQuotedPrice: z
    .boolean()
    .describe("The AGENT (not the caller) said any number, range or per-sq-ft rate for cost. Must always be false."),
});
export type Extraction = z.infer<typeof Extraction>;

const SYSTEM = `You extract structured facts from enquiry call transcripts for Aangan Studio, an interior design studio in Pune.
Rules:
- Only record what the caller actually said. If something wasn't said, use null / "unknown" / "unclear". Never guess.
- Dates: resolve relative dates ("by March", "before Diwali", "in six weeks") against the call date given. Month-only → last day of that month. Diwali 2026 is 8 November; but if the caller says how many weeks away it is, use that.
- city: "pune" for Pune city localities, "pcmc" for Pimpri-Chinchwad localities (Pimpri, Chinchwad, Pimple Saudagar, Pimple Nilakh, Ravet, Hinjewadi, Wakad is Pune), "other" for anywhere else (Talegaon, Lonavala, Nashik, Mumbai...), "unknown" if not said.
- budget: only if the caller volunteered a number. "Budget bhi hai" / "reasonable" is NOT a number.
- decisionMaker: "self" if the caller owns it or is the founder/co-owner; "authorised" if they say the decision-maker has agreed; "represented" if calling for owners who'll decide; "research_only" if just checking for someone else.
- scopeLevel "full_home" covers full home and full office fitouts. Only "partial" when they name specific rooms and not the whole home.
- agentQuotedPrice: true only if the assistant/front desk stated a price figure. A caller mentioning their own budget does not count.`;

export type ExtractionResult = { extraction: Extraction; model: string; inputTokens: number; outputTokens: number };

export async function extractFromTranscript(transcript: string, callDate: Date): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const ai = new GoogleGenAI({ apiKey });

  const res = await ai.models.generateContent({
    model,
    contents: `Call date: ${callDate.toISOString().slice(0, 10)} (Asia/Kolkata)\n\nTranscript:\n${transcript}`,
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(Extraction),
      temperature: 0,
    },
  });

  const extraction = Extraction.parse(JSON.parse(res.text ?? ""));
  const u = res.usageMetadata;
  return {
    extraction,
    model,
    inputTokens: u?.promptTokenCount ?? 0,
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  };
}

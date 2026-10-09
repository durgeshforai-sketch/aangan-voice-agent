// Unit costs in INR. Rates change — override via env, and check against the providers' invoices monthly.
const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

export const RATES = {
  usdToInr: num(process.env.USD_TO_INR, 88),
  // Vaani voice surfaces bill per minute (docs: env-driven PAYG rate). Set from your dashboard.
  vaaniInrPerMinute: num(process.env.VAANI_INR_PER_MINUTE, 2.4),
  // Gemini Flash list price per million tokens (USD)
  geminiInputUsdPerM: num(process.env.GEMINI_INPUT_USD_PER_M, 0.3),
  geminiOutputUsdPerM: num(process.env.GEMINI_OUTPUT_USD_PER_M, 2.5),
  // Twilio number rental, INR/month, booked as a fixed cost
  telephonyInrPerMonth: num(process.env.TELEPHONY_INR_PER_MONTH, 0),
};

export const vaaniCostInr = (durationSec: number) => (durationSec / 60) * RATES.vaaniInrPerMinute;

export const geminiCostInr = (inputTokens: number, outputTokens: number) =>
  ((inputTokens * RATES.geminiInputUsdPerM + outputTokens * RATES.geminiOutputUsdPerM) / 1_000_000) * RATES.usdToInr;

// Phone numbers as E.164. Kept dependency-free so it can be unit-tested.
export function normalisePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (/x|\*/i.test(p) || digits.length < 10) return null; // masked or partial
  // Aangan's callers are Indian: a mobile is 10 digits starting 6–9. Gemini sometimes guesses a
  // US code (+1 703…) or a trunk 0 — strip those back to the 10 digits and use +91.
  const ten = digits.slice(-10);
  if (/^[6-9]/.test(ten) && (digits.length === 10 || (digits.length === 11 && /^[01]/.test(digits)) || digits === `91${ten}`)) return `+91${ten}`;
  return `+${digits}`;
}

import { createHmac, timingSafeEqual } from "node:crypto";

// Single shared dashboard password (Nikhil + front desk). Cookie holds an HMAC, never the password.
export const COOKIE = "aangan_session";

export function sessionToken(password = process.env.DASHBOARD_PASSWORD ?? "") {
  return createHmac("sha256", password).update("aangan-dashboard-v1").digest("hex");
}

export function validSession(cookie: string | undefined) {
  if (!process.env.DASHBOARD_PASSWORD || !cookie) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(sessionToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordMatches(input: string) {
  const want = process.env.DASHBOARD_PASSWORD ?? "";
  if (!want) return false;
  const a = Buffer.from(sessionToken(input));
  const b = Buffer.from(sessionToken(want));
  return timingSafeEqual(a, b);
}

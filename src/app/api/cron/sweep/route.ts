import { timingSafeEqual } from "node:crypto";
import { sweep } from "@/lib/sweep";

export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new Response("unauthorised", { status: 401 });
  }
  return Response.json(await sweep());
}

import { after } from "next/server";
import { getDb, schema } from "@/db";
import { fetchCall, mergeCalls, normaliseCall, verifySignature, type VaaniEnvelope } from "@/lib/vaani";
import { processCall } from "@/lib/pipeline";

export const maxDuration = 60;

// Vaani → us after every call. Vaani times out at 10s, so: verify, store the raw event, ack,
// then process in after(). If processing fails, the sweeper retries (calls without a qualification).
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-vaanivoice-signature"))) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  const env = JSON.parse(raw) as VaaniEnvelope;
  if (env.type === "webhook.ping") return Response.json({ ok: true });
  if (env.type !== "call.completed" && env.type !== "call.failed") return Response.json({ ok: true, ignored: env.type });

  const call = normaliseCall(env.data);
  if (!call) {
    console.error("call webhook without an id", raw.slice(0, 500));
    return Response.json({ ok: true, ignored: "no call id" });
  }

  // Store immediately so nothing is lost even if processing fails
  await getDb()
    .insert(schema.calls)
    .values({ vaaniCallId: call.vaaniCallId, startedAt: call.startedAt, rawPayload: env as object, status: "in_progress" })
    .onConflictDoNothing({ target: schema.calls.vaaniCallId });

  after(async () => {
    try {
      const full = await fetchCall(call.vaaniCallId).catch((err) => {
        console.error("fetchCall failed; using webhook body", err);
        return null;
      });
      await processCall(mergeCalls(call, full), "live");
    } catch (err) {
      console.error("processCall failed", call.vaaniCallId, err);
    }
  });
  return Response.json({ ok: true });
}

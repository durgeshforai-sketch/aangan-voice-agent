import { after } from "next/server";
import { getDb, schema } from "@/db";
import { callEvents, fetchCall, isTestPing, mergeCalls, normaliseCall, signatureHeader, verifySignature } from "@/lib/vaani";
import { processCall } from "@/lib/pipeline";

export const maxDuration = 60;

// Vaani → us after every voice call. Vaani retries on failure, so: verify, store the raw event, ack,
// then process in after(). If processing fails, the sweeper retries (calls without a qualification).
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, signatureHeader(req.headers))) {
    // Header names only (never values): lets us see in Vercel logs what Vaani actually sent
    console.error("vaani webhook rejected", [...req.headers.keys()].filter((k) => /^x-/.test(k)));
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "not JSON" }, { status: 400 });
  }
  if (isTestPing(body)) return Response.json({ ok: true, test: true });

  const events = callEvents(body);
  if (!events.length) return Response.json({ ok: true, ignored: body.event ?? body.type ?? "unknown" });

  const calls = events.map((e) => normaliseCall(e.data, { callId: e.callId, endedAt: e.at })).filter((c) => c !== null);
  for (const call of calls) {
    // Store immediately so nothing is lost even if processing fails
    await getDb()
      .insert(schema.calls)
      .values({ vaaniCallId: call.vaaniCallId, startedAt: call.startedAt, rawPayload: body, status: "in_progress" })
      .onConflictDoNothing({ target: schema.calls.vaaniCallId });
    after(async () => {
      try {
        // Agent webhooks usually carry the transcript; only fetch from the API when they don't
        const full = call.transcript ? null : await fetchCall(call.vaaniCallId).catch(() => null);
        await processCall(mergeCalls(call, full), "live");
      } catch (err) {
        console.error("processCall failed", call.vaaniCallId, err);
      }
    });
  }
  return Response.json({ ok: true, calls: calls.length });
}

import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { callEvents, isTestPing, normaliseCall, verifySignature } from "../src/lib/vaani";

// Shape of a real Vaani agent webhook (call_postprocessing inside events[]), as observed on 10 Oct 2026
const real = {
  event: "call_postprocessing",
  timestamp: "2026-10-10T14:05:30Z",
  events: [
    {
      event: "call_postprocessing",
      call_id: "c_123",
      timestamp: "2026-10-10T14:05:30Z",
      data: {
        call_id: "c_123",
        room_name: "room-abc",
        call_duration: 210,
        end_reason: "user_hangup",
        summary: "Caller wants a 3BHK in Kothrud done.",
        entities: { customer_name: "Priya" },
        recording_url: "https://example.com/rec.mp3",
        transcript: "Agent: Namaste, Aangan Studio.\nUser: Hi, I have a 3BHK in Kothrud.",
      },
    },
  ],
};

describe("Vaani webhook parsing", () => {
  it("reads the real agent-webhook envelope", () => {
    const [e] = callEvents(real);
    const c = normaliseCall(e.data, { callId: e.callId, endedAt: e.at })!;
    expect(c.vaaniCallId).toBe("c_123");
    expect(c.durationSec).toBe(210);
    expect(c.startedAt.toISOString()).toBe("2026-10-10T14:02:00.000Z"); // end − duration
    expect(c.transcript).toContain("Caller: Hi, I have a 3BHK");
    expect(c.recordingUrl).toBe("https://example.com/rec.mp3");
  });

  it("reads the documented call.completed envelope", () => {
    const doc = { id: "evt_1", type: "call.completed", created: 1760104800, data: { id: "c_9", duration: 60, transcript: [{ role: "assistant", text: "Hello" }, { role: "user", text: "Hi" }] } };
    const [e] = callEvents(doc);
    const c = normaliseCall(e.data, { callId: e.callId, endedAt: e.at })!;
    expect(c.vaaniCallId).toBe("c_9");
    expect(c.transcript).toBe("Agent: Hello\nCaller: Hi");
  });

  it("acks test pings and ignores other events", () => {
    expect(isTestPing({ event: "webhook_test" })).toBe(true);
    expect(isTestPing({ type: "webhook.ping" })).toBe(true);
    expect(callEvents({ event: "usage.charged", data: {} })).toEqual([]);
  });

  it("verifies the sha256= signature", () => {
    const body = JSON.stringify(real);
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifySignature(body, sig, "s3cret")).toBe(true);
    expect(verifySignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifySignature(body, null, "s3cret")).toBe(false);
  });
});

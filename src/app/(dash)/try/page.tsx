import { redirect } from "next/navigation";
import { processCall } from "@/lib/pipeline";

// Demo without a phone line: paste a transcript, run the real pipeline (Gemini → rules → booking/handoff).
// Stored as a simulated call so it never counts in Nikhil's live numbers.
async function run(formData: FormData) {
  "use server";
  const transcript = String(formData.get("transcript") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  if (transcript.length < 40) redirect("/try?error=short");
  const now = new Date();
  const r = await processCall(
    {
      vaaniCallId: `try-${now.getTime()}`,
      fromPhone: phone,
      startedAt: now,
      endedAt: now,
      durationSec: Math.max(60, Math.round(transcript.split(/\s+/).length / 2.5)), // ~150 words/min
      transcript,
      recordingUrl: null,
      language: null,
      costInr: null,
      raw: { source: "try-page" },
    },
    "simulation",
  );
  redirect(`/calls/${r.callId}`);
}

export default async function Try({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <section className="card" style={{ maxWidth: 820 }}>
      <h2>Try a call</h2>
      <p className="ink2" style={{ marginTop: 0 }}>
        Paste a call transcript, e.g. one of the September enquiries. It goes through exactly what a real call does: Gemini reads it,
        Nikhil&apos;s five criteria decide, and qualified leads get booked and briefed to the consultant on Telegram. It&apos;s saved as a
        test call, so it never touches the live numbers.
      </p>
      <form action={run} style={{ display: "grid", gap: 10 }}>
        <label>
          Transcript
          <textarea name="transcript" rows={14} required placeholder={"Agent: Namaste, you've reached Aangan Studio…\nCaller: Hi, I have a 3BHK in Kothrud…"} />
        </label>
        <label>
          Caller phone (optional)
          <input name="phone" placeholder="+91 98220 00000" />
        </label>
        {sp.error && <p className="error">That transcript is too short to be a call.</p>}
        <div><button type="submit">Run through the system</button></div>
      </form>
    </section>
  );
}

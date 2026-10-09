# Aangan Studio — Voice AI enquiry desk

Every call to Aangan gets answered within a couple of rings, day or night. The agent qualifies the caller against Nikhil's rubric and books qualified leads straight into a designer's calendar. The designer gets a brief on Telegram that answers everything they'd otherwise ask on the first call. Nikhil gets one dashboard covering volume, outcomes, pipeline value and what the system costs.

**MESA Case 03.** Stack (fixed): Vaani Labs · Gemini Flash · Cal.com · Telegram · HubSpot · Neon · Vercel · GitHub · Claude.

## How a call flows
```
Caller ─▶ Vaani (Aanya, docs/vaani-agent-prompt.md)
           │  live tools (optional): lookup-caller · check-availability · book-consultation · escalate
           ▼
        call.completed webhook ─▶ /api/vaani/webhook ─▶ Neon (calls)
           ▼ (after response)
        Gemini Flash: transcript → structured facts         src/lib/extract.ts
        Rules: Nikhil's 5 criteria → verdict + route         src/lib/qualify.ts   (deterministic, tested)
           ▼
   book / book_with_note → Cal.com booking (live or post-call) → Telegram brief to designer → deal (→ HubSpot)
   review / mismatch / booking_failed → front-desk queue + Telegram alert
   escalate → callback deadline + alert          nurture → follow-up date          close / log → stored with reasons
           ▼
   Designer taps in Telegram (confirm · reassign · outcome · 👍/👎) → bookings, deals, HubSpot stay current
   Sweeper every 10 min (GitHub Actions): retries, overdue alerts, nurture due, HubSpot sync
```

**The Cut:** the agent never quotes a price (`knowledge/pricing.md`). Price bands are used only internally, to estimate pipeline value.

## Key files
| | |
|---|---|
| `docs/agent-spec.md` | What the agent does and why, including rule decisions where the seed files disagree |
| `docs/vaani-agent-prompt.md` | The prompt to paste into Vaani |
| `docs/setup.md` | Keys, deploy, Vaani/Cal.com/Telegram/HubSpot setup, rollout |
| `eval/` | The 40 September enquiries as labelled tests, transcripts, persona cards, eval runners |
| `src/lib/` | Rules, extraction, pipeline, integrations |
| `src/app/(dash)` | Dashboard: overview, calls, front-desk queue |

## Commands
```bash
npm test                    # rules vs 40 labelled enquiries
npm run eval:extraction     # Gemini extraction on the real transcripts
npm run eval:conversations  # offline rehearsal of the agent prompt vs simulated callers
npm run simulate            # full pipeline on the Neon test branch
npm run dev                 # dashboard at localhost:3000
```

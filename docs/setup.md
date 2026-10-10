# Setup and go-live runbook

Everything is in order. Each step says who does it. "You" means someone with the account logins.

## 1. Keys → `.env.local` (you)
Open `.env.local` and fill in the blank entries. `VAANI_TOOL_SECRET`, `TELEGRAM_WEBHOOK_SECRET` and `CRON_SECRET` are already generated.

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon → your project → **Connect** → the main branch's pooled connection string |
| `DATABASE_URL_TEST` | Neon → **Branches → Create branch** named `test` (from main) → its connection string |
| `VAANI_API_KEY` | Vaani dashboard → Settings → API keys (`vv_live_…`) |
| `VAANI_WEBHOOK_SECRET` | Step 5. It's shown once, when you register the webhook |
| `VAANI_INR_PER_MINUTE` | Your per-minute rate on the Vaani billing page |
| `GEMINI_API_KEY` | Google AI Studio |
| `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID` | Step 4 (Option A) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Step 4 (Option B, later) |
| `TELEGRAM_BOT_TOKEN` | @BotFather |
| `TELEGRAM_ESCALATION_CHAT_ID` | Step 6 |
| `DASHBOARD_PASSWORD` | Choose one for Nikhil and the front desk |
| `HUBSPOT_ACCESS_TOKEN` | Last step (9) |

## 2. Database (Claude, once `DATABASE_URL*` are set)
```bash
npm run db:migrate && npm run db:migrate:test
```
**Neon branches:** `main` holds real calls. `test` is a copy where simulated calls go, so tests never touch Nikhil's numbers. You can reset `test` from Neon's UI at any time.

## 3. Rehearse the agent offline (Claude, once `GEMINI_API_KEY` is set)
```bash
npm test                       # rules vs the 40 September enquiries (no keys needed)
npm run eval:extraction        # Gemini reading the 40 real transcripts
npm run eval:conversations     # Gemini-as-Aanya vs 40 simulated callers, using docs/vaani-agent-prompt.md
npm run simulate               # full pipeline on the Neon test branch → dashboard "Show test calls"
```
Fix the prompt until `eval:conversations` passes. **Zero price quotes is non-negotiable.**

## 4. Booking calendar (you)
### Option A — one free Cal.com account (`BOOKING_PROVIDER=calcom`, the default; used for testing)
Cal.com's team round-robin is a paid plan, so we use a single free account. Every consultation lands on that account's calendar, and our backend decides which consultant it's for: least-loaded, commercial specialists first. "Consultant One" is used for testing.
1. Cal.com → **Event Types → New** → **"Free design consultation"**, 60 min. Set the availability to consultation hours (e.g. Mon–Sat 10:00–19:00 IST).
2. Turn off emails to attendees if you can (Event type → Advanced). Callers get a placeholder address, because phone callers rarely give an email.
3. Cal.com → Settings → Developer → **API keys** → put the key in `CALCOM_API_KEY`.
4. `npm run calcom:event-types` lists your event types with their ids. Put the consultation's id in `CALCOM_EVENT_TYPE_ID`.

### Option B — Google Calendar per designer (`BOOKING_PROVIDER=gcal`, free)
Use this once there are real designers with their own calendars. Our backend checks who is free and does the round-robin itself (least-loaded, commercial specialists first).
1. Go to https://console.cloud.google.com → create a project, e.g. **aangan-voice-agent**.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **IAM & Admin → Service Accounts → Create**, named e.g. `aangan-booking`. It needs no roles.
4. Open it → **Keys → Add key → JSON**. A file downloads. Paste its entire contents as one line into `GOOGLE_SERVICE_ACCOUNT_JSON`, or base64 it with `base64 -i key.json`. Then delete the downloaded file.
5. Each designer (start with 2–3 test calendars): Google Calendar → ⚙ **Settings → their calendar → Share with specific people** → add the service account's `client_email` (`…@…iam.gserviceaccount.com`) with **"Make changes to events"**. Each designer's calendar id is usually their Gmail address; it goes in `scripts/designers.json` as `calendarId`.
6. Consultation hours default to Mon–Sat 10:00–19:00 IST in 60-minute slots. Change them with `CONSULT_*` if needed.

Designers see bookings as normal events on their own calendar, with the client's details and a link to the call. No invite is emailed to the caller.

## 5. Vaani (you, with Claude reading along)
The tab names below are the agent-editor tabs in the Vaani console. Option labels inside them may differ slightly; pick the closest one. **Save Agent** after each tab.

**Overview**
- **Greeting:** "Namaste, you've reached Aangan Studio. I'm Aanya, the studio's AI assistant — this call is recorded so our designers have your details. How can I help?"
- **System prompt:** everything below the `---` line in `docs/vaani-agent-prompt.md`.
- Note the **₹/min** figure it shows, and put it in `VAANI_INR_PER_MINUTE` so the dashboard's costs are right.

**Persona**
- Female voice that sounds natural in Indian English (listen to a few). Languages: English (India) + Hindi (+ Marathi if offered), with auto-detect / code-switching ON.
- Speech-to-text: a multilingual / Indian-languages model. If there's a keyword boost, add Pune localities (Kothrud, Baner, Aundh, Wakad, Hinjewadi, Pimple Saudagar…), plus BHK, carpet area, modular kitchen, possession.
- LLM: a fast model; temperature low (~0.3); short responses.
- **System tools:** `transfer_call` only once the front desk has a number to transfer to; everything else OFF. **Integration tools: all OFF.** Vaani's own booking tools would book outside our system, and Telegram and HubSpot would never hear about it.
- **Custom tools:** add the four below (POST, header `Authorization: Bearer <VAANI_TOOL_SECRET>`).
- **Memories → Use previous call contexts: ON** (repeat callers like T16 aren't re-asked everything).

| Tool | URL (`https://aangan-voice-agent-rust.vercel.app` + …) | Parameters |
|---|---|---|
| `lookup_caller` | `/api/vaani/tools/lookup-caller` | `phone` |
| `check_availability` | `/api/vaani/tools/check-availability` | `mode` (site_visit/studio), `preference` (e.g. "weekends"), `from_date` (YYYY-MM-DD, optional) |
| `book_consultation` | `/api/vaani/tools/book-consultation` | `start` (exact value from check_availability), `mode`, `name`, `phone`, `address`, `segment` |
| `escalate` | `/api/vaani/tools/escalate` | `reason`, `name`, `phone` |

Every response includes `say`, a line the agent can use as-is. If the tools don't fire on voice calls (they were reported failing in Vaani's chat tests), remove them: the system then books right after the call, and the designer confirms the time.

**Training → Knowledge:** attach `knowledge/services.md` and `knowledge/qualified.md` only. **Never upload `pricing.md`.** An agent that can read the rates can say them, and keeping them out is what guarantees the Cut.

**Experience:** interruptions ON. After ~7 s of silence say "Are you still there?"; after a second silence, end politely. Max call length 10 min. Record calls ON.

**Deploy**
1. **Webhook:** Developers → Webhooks → URL `https://aangan-voice-agent-rust.vercel.app/api/vaani/webhook`, event **Call Post-Processing** (send all call details). Copy the signing secret into `VAANI_WEBHOOK_SECRET`, both locally and in Vercel. Press **Test**; we answer test pings.
2. **Web call** channel for the class demo; **Telephony** (Twilio number) for real calls.
3. **Only voice calls send the webhook. Chat tests don't**, so test by talking to it.

## 6. Telegram (you + Claude)
1. Each designer opens the bot and sends `/start`. The bot replies with their chat id.
2. Create a group for the front desk and Nikhil, add the bot, and send `/start` in the group. That chat id goes in `TELEGRAM_ESCALATION_CHAT_ID`.
3. Copy `scripts/designers.example.json` to `scripts/designers.json`, fill in names, Telegram chat ids, Google calendar ids and specialties, then run `npm run designers`. That file stays out of git.
4. After deploying: `npm run setup:telegram`.

## 7. Deploy (Claude, once you've logged in to Vercel once with `vercel login`)
- `vercel link` → `vercel env add` for each variable → `vercel --prod`.
- Set `APP_BASE_URL` to the production URL.
- GitHub repo → Settings → Secrets → Actions: add `APP_BASE_URL` and `CRON_SECRET`. The sweeper then runs every 10 minutes, to retry failed call processing, flag unconfirmed handoffs and overdue callbacks, surface nurture follow-ups and sync HubSpot.

## 8. Live test calls (you)
Call the number as each persona in `eval/persona-cards.md`. Check the dashboard: each call should land on the outcome written on its card. Test at least: T01 (book), T02 (price push), T03 (out of area), T07 (later start), T09 (complaint), T10 (budget), T14 (calling for parents), W03 (Hindi), and one silent call.

## 9. HubSpot (last)
1. Settings → Integrations → **Private apps** → create one with scopes `crm.objects.contacts.read/write`, `crm.objects.deals.read/write`, `crm.schemas.contacts.write`, `crm.schemas.deals.write`. Put the token in `HUBSPOT_ACCESS_TOKEN` (local and Vercel).
2. `npm run setup:hubspot` creates our custom fields and prints the deal stages. If they aren't HubSpot's defaults, set `HUBSPOT_STAGE_MAP`.
3. Every deal queued since launch syncs on the next sweep.

## Rollout (Nikhil's call)
1. **After hours only** (7pm–10am and weekends): forward the studio line to the Vaani number outside office hours. Those are a third of all calls, and today they get nothing.
2. **Overflow:** also forward when the front desk doesn't answer within 20 seconds.
3. **All calls**, once the numbers hold. The front desk handles the queue, transfers and Amber reviews.

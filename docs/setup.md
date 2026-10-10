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
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Step 4 |
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

## 4. Google Calendar (you, ~10 minutes, free)
We use Google Calendar instead of Cal.com, because Cal.com's round-robin needs a paid Teams plan. Our backend does the round-robin itself (least-loaded, commercial specialists first).
1. Go to https://console.cloud.google.com → create a project, e.g. **aangan-voice-agent**.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **IAM & Admin → Service Accounts → Create**, named e.g. `aangan-booking`. It needs no roles.
4. Open it → **Keys → Add key → JSON**. A file downloads. Paste its entire contents as one line into `GOOGLE_SERVICE_ACCOUNT_JSON`, or base64 it with `base64 -i key.json`. Then delete the downloaded file.
5. Each designer (start with 2–3 test calendars): Google Calendar → ⚙ **Settings → their calendar → Share with specific people** → add the service account's `client_email` (`…@…iam.gserviceaccount.com`) with **"Make changes to events"**. Their calendar id is usually their Gmail address; it goes in `scripts/designers.json` as `calendarId`.
6. Consultation hours default to Mon–Sat 10:00–19:00 IST in 60-minute slots. Change them with `CONSULT_*` if needed.

Designers see bookings as normal events on their own calendar, with the client's details and a link to the call. No invite is emailed to the caller.

## 5. Vaani (you, with Claude reading along)
1. **Phone number:** connect the Twilio number in the Vaani dashboard (Quick start → "Configure your Twilio number").
2. **Flow:** create a conversation flow and paste everything below the `---` line in `docs/vaani-agent-prompt.md` as the agent's instructions. Set the female voice and languages to English + Hindi (+ Marathi if offered).
3. **Tools during the call:** if the flow builder supports HTTP/API tools, add the four in the table below. Use POST and the header `x-aangan-tool-secret: <VAANI_TOOL_SECRET>`. If it doesn't support them, skip this step: the system books right after the call instead, and the designer confirms the time with the client.
4. **Webhook:** Vaani dashboard → Webhooks → URL `https://<vercel-url>/api/vaani/webhook`, events `call.completed` and `call.failed`. Copy the `vv_whk_…` secret into `VAANI_WEBHOOK_SECRET` (in Vercel's settings too). Press **Test**; the endpoint answers the ping.

| Tool | URL | Arguments |
|---|---|---|
| `lookup_caller` | `/api/vaani/tools/lookup-caller` | `phone` |
| `check_availability` | `/api/vaani/tools/check-availability` | `mode` (site_visit/studio), `preference` (free text, e.g. "weekends") |
| `book_consultation` | `/api/vaani/tools/book-consultation` | `start` (ISO, from check_availability), `mode`, `name`, `phone`, `address`, `segment` |
| `escalate` | `/api/vaani/tools/escalate` | `reason`, `name`, `phone` |

Every tool response includes `say`, a line the agent can speak as-is. Arguments are accepted flat or wrapped in `args` / `arguments` / `parameters`.

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

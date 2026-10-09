// Points the Telegram bot at our webhook. Run after each deploy URL change.
//   npm run setup:telegram
import { config } from "dotenv";
config({ path: ".env.local" });
const { setWebhook } = await import("../src/lib/telegram");
const base = process.env.APP_BASE_URL;
if (!base || base.includes("localhost")) throw new Error("Set APP_BASE_URL to the deployed https URL first");
await setWebhook(`${base}/api/telegram/webhook`, process.env.TELEGRAM_WEBHOOK_SECRET!);
console.log("Telegram webhook set →", `${base}/api/telegram/webhook`);

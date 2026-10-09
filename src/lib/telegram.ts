// Telegram Bot API — designer handoffs and escalation alerts.
const api = (method: string) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return `https://api.telegram.org/bot${token}/${method}`;
};

async function call<T>(method: string, body: unknown): Promise<T> {
  const res = await fetch(api(method), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

export type Button = { text: string; callback_data: string };

export const sendMessage = (chatId: string, html: string, buttons?: Button[][]) =>
  call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
  });

export const editButtons = (chatId: string, messageId: number, buttons: Button[][]) =>
  call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: buttons } });

export const answerCallback = (callbackQueryId: string, text: string) =>
  call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });

export const setWebhook = (url: string, secret: string) =>
  call("setWebhook", { url, secret_token: secret, allowed_updates: ["callback_query", "message"] });

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// callback_data is limited to 64 bytes: "<action>:<handoffId>"
export const ACTIONS = {
  confirm: "c",
  reassign: "r",
  done: "d",
  noShow: "n",
  proposal: "p",
  won: "w",
  lost: "l",
  good: "g",
  bad: "b",
} as const;
export type Action = keyof typeof ACTIONS;
export const actionFromCode = (code: string) =>
  (Object.entries(ACTIONS).find(([, c]) => c === code)?.[0] as Action | undefined) ?? null;

// Sends the console's own Telegram messages (the monitor job's alerts), through the same
// bot and chat as the deploy workflows. The chat can be moved from the console: its
// choice, in app_settings, wins over the TELEGRAM_CHAT_ID secret.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const TELEGRAM_CHAT_SETTING = "telegram_chat_id";

export class TelegramError extends Error {
  /** Telegram moved a group to a new ID (it became a supergroup); send there instead. */
  migrateTo?: string;
}

export function telegramToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

/** The chat picked in the console, if any. */
export async function chosenTelegramChat(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", TELEGRAM_CHAT_SETTING)
    .maybeSingle();
  const chosen = data?.value;
  if (typeof chosen === "string" && chosen) return chosen;
  if (typeof chosen === "number") return String(chosen);
  return null;
}

/** The chat the console writes to; null when none is configured. */
export async function telegramChatId(): Promise<string | null> {
  return (await chosenTelegramChat()) ?? (process.env.TELEGRAM_CHAT_ID || null);
}

export async function saveTelegramChat(chatId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key: TELEGRAM_CHAT_SETTING, value: chatId, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save the chat: ${error.message}`);
}

/** Calls a Bot API method; throws TelegramError with Telegram's own reason. */
export async function telegramCall(method: string, body?: unknown): Promise<any> {
  const token = telegramToken();
  if (!token) {
    throw new TelegramError("The console has no Telegram bot token (TELEGRAM_BOT_TOKEN).");
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!json.ok) {
    const error = new TelegramError(
      `Telegram refused ${method}: ${json.description ?? res.status}`,
    );
    if (json.parameters?.migrate_to_chat_id) {
      error.migrateTo = String(json.parameters.migrate_to_chat_id);
    }
    throw error;
  }
  return json.result;
}

/**
 * Sends one message. When Telegram says the group moved to a new ID, the console's
 * setting follows it and the message goes there.
 */
export async function sendTelegram(text: string, chatId: string): Promise<void> {
  const send = (chat: string) =>
    telegramCall("sendMessage", {
      chat_id: chat,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  try {
    await send(chatId);
  } catch (err) {
    if (!(err instanceof TelegramError) || !err.migrateTo) throw err;
    await saveTelegramChat(err.migrateTo);
    await send(err.migrateTo);
  }
}

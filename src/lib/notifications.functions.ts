// Settings → Notifications: which Telegram chat the console and the games' deploys post
// to, a test message, and moving everything to another chat (a group) in one go.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { setRepoSecrets } from "./repo-secrets.server";
import {
  TelegramError,
  chosenTelegramChat,
  saveTelegramChat,
  sendTelegram,
  telegramCall,
  telegramChatId,
  telegramToken,
} from "./telegram.server";

const ORG = "Bible-Games-Project";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

export type TelegramChat = { id: string; title: string; type: string };

const chatTitle = (chat: any): string =>
  chat.title ??
  ([chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
    (chat.username ? `@${chat.username}` : String(chat.id)));

/** The bot and the chat messages go to, and where that choice comes from. */
export const getNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (!telegramToken()) {
      return {
        bot: null,
        chat: null,
        source: null,
        problem:
          "The console has no Telegram bot. In GitHub → bgp-admin → Settings → Secrets and variables → Actions, add TELEGRAM_BOT_TOKEN (from @BotFather) and push to main.",
      };
    }
    const chosen = await chosenTelegramChat();
    const chatId = chosen ?? process.env.TELEGRAM_CHAT_ID ?? null;
    try {
      const me = await telegramCall("getMe");
      const bot = { username: me.username as string, name: me.first_name as string };
      if (!chatId) {
        return { bot, chat: null, source: null, problem: null };
      }
      let chat: TelegramChat;
      try {
        const c = await telegramCall("getChat", { chat_id: chatId });
        chat = { id: String(c.id), title: chatTitle(c), type: c.type };
      } catch (err) {
        return {
          bot,
          chat: { id: chatId, title: chatId, type: "unknown" },
          source: chosen ? ("console" as const) : ("secret" as const),
          problem: `The bot can't reach its chat: ${(err as Error).message}. Move the messages to a chat the bot is in below.`,
        };
      }
      return {
        bot,
        chat,
        source: chosen ? ("console" as const) : ("secret" as const),
        problem: null,
      };
    } catch (err) {
      return { bot: null, chat: null, source: null, problem: (err as Error).message };
    }
  });

export const sendTestMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const chat = await telegramChatId();
    if (!chat) throw new Error("There is no chat to send to yet. Pick one below.");
    await sendTelegram("✅ Test message from the BGP console. Its alerts arrive here.", chat);
    return { ok: true };
  });

/**
 * The chats the bot was added to or written in lately (Telegram keeps a day of these),
 * newest first, so a group can be picked without knowing its ID.
 */
export const findTelegramChats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ chats: TelegramChat[] }> => {
    await assertAdmin(context.supabase, context.userId);
    let updates: any[];
    try {
      updates = await telegramCall("getUpdates", {
        allowed_updates: ["message", "my_chat_member"],
      });
    } catch (err) {
      if (err instanceof TelegramError && /webhook/i.test(err.message)) {
        throw new Error(
          "The bot delivers its messages to a webhook, so the console can't see which groups it's in. Remove the webhook (BotFather or deleteWebhook) and try again.",
        );
      }
      throw err;
    }
    const chats = new Map<string, TelegramChat>();
    for (const u of [...updates].reverse()) {
      const chat = u.my_chat_member?.chat ?? u.message?.chat;
      // Kicked out since: not a place to post.
      const status = u.my_chat_member?.new_chat_member?.status;
      if (!chat || chats.has(String(chat.id))) continue;
      if (status === "left" || status === "kicked") {
        chats.set(String(chat.id), { id: "", title: "", type: "gone" });
        continue;
      }
      chats.set(String(chat.id), { id: String(chat.id), title: chatTitle(chat), type: chat.type });
    }
    return { chats: [...chats.values()].filter((c) => c.id) };
  });

/**
 * Sends everything to another chat: the console's alerts from now on, and every game's
 * deploy messages, whose TELEGRAM_CHAT_ID secret is updated along with the console's own.
 * A welcome message goes first, so a chat the bot can't post in is refused before anything
 * changes.
 */
export const moveTelegramChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ chatId: z.string().regex(/^-?\d+$/, "Not a Telegram chat ID") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await sendTelegram(
      "👋 From now on the BGP console posts here: new reviews, Apple's answers, crashes, deploy results, reminders and a summary on Mondays.",
      data.chatId,
    );
    await saveTelegramChat(data.chatId);

    const { data: apps, error } = await supabaseAdmin
      .from("apps")
      .select("github_owner, github_repo")
      .eq("github_owner", ORG);
    if (error)
      throw new Error(`The chat was saved, but the games couldn't be listed: ${error.message}`);
    const repos = [...new Set(["bgp-admin", ...apps.map((a) => a.github_repo!).filter(Boolean)])];
    const failed: string[] = [];
    for (const repo of repos) {
      const missed = await setRepoSecrets(repo, [{ name: "TELEGRAM_CHAT_ID", value: data.chatId }]);
      if (missed.length) failed.push(repo);
    }
    return { repos: repos.length, failed };
  });

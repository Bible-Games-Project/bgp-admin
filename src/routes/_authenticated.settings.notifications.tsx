import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Bell, Loader2, Search, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  type TelegramChat,
  findTelegramChats,
  getNotifications,
  moveTelegramChat,
  sendTestMessage,
} from "@/lib/notifications.functions";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  head: () => ({ meta: [{ title: "Notifications — bgp console" }] }),
  component: NotificationsPage,
});

const CHAT_TYPES: Record<string, string> = {
  private: "private chat",
  group: "group",
  supergroup: "group",
  channel: "channel",
};

function NotificationsPage() {
  const queryClient = useQueryClient();
  const getFn = useServerFn(getNotifications);
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => getFn() });

  const testFn = useServerFn(sendTestMessage);
  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: () => toast.success("Sent. Check the chat in Telegram."),
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const findFn = useServerFn(findTelegramChats);
  const [found, setFound] = useState<TelegramChat[] | null>(null);
  const find = useMutation({
    mutationFn: () => findFn(),
    onSuccess: ({ chats }) => setFound(chats),
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const moveFn = useServerFn(moveTelegramChat);
  const move = useMutation({
    mutationFn: (chat: TelegramChat) => moveFn({ data: { chatId: chat.id } }),
    onSuccess: ({ repos, failed }, chat) => {
      if (failed.length) {
        toast.warning(
          `Messages now go to ${chat.title}, but ${failed.length} repo(s) kept the old chat`,
          {
            description: `Their deploy messages still go to the old chat: ${failed.join(", ")}. Press "Use this chat" again to retry.`,
            duration: 20000,
          },
        );
      } else {
        toast.success(`Messages now go to ${chat.title}`, {
          description: `The console's alerts and the deploy messages of ${repos} repos.`,
        });
      }
      setFound(null);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const data = q.data;
  const bot = data?.bot ? `@${data.bot.username}` : "the bot";

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <span className="label-mono">settings</span>
        <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Notifications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The console posts to a Telegram chat: new reviews, Apple's answers, games that start
          crashing, reminders before things expire, and a summary every Monday. Every game's deploys
          post their results to the same chat.
        </p>
      </div>

      {q.isLoading && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}
      {q.error && <p className="text-sm text-destructive">{q.error.message}</p>}
      {data?.problem && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Telegram needs attention</AlertTitle>
          <AlertDescription className="text-muted-foreground">{data.problem}</AlertDescription>
        </Alert>
      )}

      {data?.bot && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <Bell className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-1">
                <div className="font-medium">Where messages go</div>
                {data.chat ? (
                  <p className="text-sm text-muted-foreground">
                    <span className="text-foreground">{data.chat.title}</span>
                    {CHAT_TYPES[data.chat.type] ? ` (${CHAT_TYPES[data.chat.type]})` : ""}, sent by{" "}
                    {bot}.{" "}
                    {data.source === "secret"
                      ? "It's the chat set up with the console."
                      : "Picked here in the console."}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No chat yet. Pick one below and messages start arriving there.
                  </p>
                )}
              </div>
            </div>
            {data.chat && (
              <Button
                variant="outline"
                size="sm"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                {test.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                Send a test message
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {data?.bot && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <Users className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-2">
                <div className="font-medium">Move the messages to a group</div>
                <ol className="text-sm text-muted-foreground list-decimal pl-4 space-y-1">
                  <li>
                    In Telegram, open the group (or create it) and add{" "}
                    <span className="text-foreground">{bot}</span> as a member.
                  </li>
                  <li>
                    Press <span className="text-foreground">Find the group</span>. If it isn't
                    listed, write any message in the group and press it again.
                  </li>
                  <li>
                    Press <span className="text-foreground">Use this chat</span> next to it. The bot
                    says hello there, and from then on the console and every game's deploys post to
                    that group.
                  </li>
                </ol>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={find.isPending}
              onClick={() => find.mutate()}
            >
              {find.isPending ? <Loader2 className="animate-spin" /> : <Search />}
              Find the group
            </Button>
            {found && found.length === 0 && (
              <p className="text-sm text-muted-foreground">
                The bot hasn't seen any chat lately. Check that {bot} is in the group, write a
                message there, and press Find the group again.
              </p>
            )}
            {found && found.length > 0 && (
              <div className="rounded-md border divide-y">
                {found.map((chat) => {
                  const current = chat.id === data.chat?.id;
                  return (
                    <div key={chat.id} className="flex items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{chat.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {CHAT_TYPES[chat.type] ?? chat.type}
                          {current ? " · messages go here now" : ""}
                        </div>
                      </div>
                      {!current && (
                        <Button
                          size="sm"
                          disabled={move.isPending}
                          onClick={() => move.mutate(chat)}
                        >
                          {move.isPending && move.variables?.id === chat.id && (
                            <Loader2 className="animate-spin" />
                          )}
                          Use this chat
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowUp,
  Clapperboard,
  Loader2,
  MessageSquarePlus,
  Mic,
  MicOff,
  Square,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { TurnView } from "@/components/assistant/Ruben";
import { WeeklyReels } from "@/components/videos/WeeklyReels";
import { ScheduledReels } from "@/components/videos/ScheduledReels";
import { useDictation } from "@/components/build/useDictation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  getBuildAttachmentUrl,
  getBuildChat,
  sendBuildMessage,
  stopBuildTurn,
  uploadBuildAttachment,
} from "@/lib/agent.functions";
import { MAX_PROMPT_CHARS, isActiveTurn, resetLabel, type BuildAttachment } from "@/lib/agent";
import { BuildChat } from "@/components/build/BuildChat";
import { listApps } from "@/lib/apps.functions";
import { isCurrentUserAdmin } from "@/lib/deploy.functions";
import { getVideoChat, newVideoChat, sendVideoMessage } from "@/lib/videos.functions";
import { cn } from "@/lib/utils";

// The Videos page: pick a game, and talk with Claude about its videos. A web game's
// conversation here is its Build chat, the same one as on its Build page: Claude has the
// game's code, its tools (recording, voice) and its keys, so it can do everything from here.
// A game without a repo gets a conversation of its own (src/lib/videos.ts), which plans and
// writes. Either way it's shared by the team and kept until someone starts a new one.

export const Route = createFileRoute("/_authenticated/videos")({
  validateSearch: (search: Record<string, unknown>): { app?: string } => ({
    app:
      typeof search.app === "string" && /^[0-9a-f-]{36}$/i.test(search.app)
        ? search.app
        : undefined,
  }),
  component: VideosPage,
});

const EXAMPLES = [
  "Propose this week's reels for this game, in our format.",
  "Let's set our reel format: 20–30 seconds, a hook in the first 2 seconds, gameplay, and a call to download.",
  "Write the caption and hashtags for a reel about the first level.",
];

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });

type AppRow = { id: string; name: string; icon_data_url: string | null; is_active: boolean };

function VideosPage() {
  const { app: selected } = Route.useSearch();
  const navigate = Route.useNavigate();
  const adminFn = useServerFn(isCurrentUserAdmin);
  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => adminFn() });
  const listAppsFn = useServerFn(listApps);
  const appsQ = useQuery({
    queryKey: ["apps"],
    queryFn: () => listAppsFn(),
    enabled: !!adminQ.data?.isAdmin,
  });

  if (adminQ.isLoading || appsQ.isLoading) {
    return (
      <div className="p-8 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!adminQ.data?.isAdmin) {
    return (
      <div className="p-8 max-w-md">
        <h1 className="text-xl font-display font-semibold">Access denied</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your account is not authorized to view videos.
        </p>
      </div>
    );
  }
  if (appsQ.error) {
    return <div className="p-8 text-sm text-destructive">{(appsQ.error as Error).message}</div>;
  }

  const apps = ((appsQ.data?.apps ?? []) as AppRow[]).filter(
    (a) => a.is_active || a.id === selected,
  );
  const app = apps.find((a) => a.id === selected) ?? null;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto w-full space-y-5">
      <div>
        <span className="label-mono">marketing</span>
        <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Videos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A conversation with Claude about each game's videos: reels, shorts and YouTube. For a web
          game it's the game's Build chat, so Claude can record the game, add the voice and use the
          game's own tools from here. Turn on the weekly reels and Claude makes next week's every
          Sunday night for you to review. On the side, the game's reels: the ones still to come out
          and the ones already published.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {apps.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => navigate({ search: { app: a.id } })}
            className={cn(
              "shrink-0 inline-flex items-center gap-2 rounded-full border px-3 h-9 text-sm",
              a.id === selected
                ? "border-primary bg-primary/10 font-medium"
                : "border-border hover:bg-muted",
            )}
          >
            {a.icon_data_url ? (
              <img src={a.icon_data_url} alt="" className="h-5 w-5 rounded" />
            ) : (
              <Clapperboard className="h-4 w-4 text-muted-foreground" />
            )}
            {a.name}
          </button>
        ))}
      </div>

      {app ? (
        <div className="flex flex-col lg:flex-row lg:items-start gap-5">
          <div className="flex-1 min-w-0 space-y-5">
            <GameVideoChat key={app.id} appId={app.id} appName={app.name} />
            <WeeklyReels key={`reels-${app.id}`} appId={app.id} appName={app.name} />
          </div>
          <ScheduledReels key={`scheduled-${app.id}`} appId={app.id} appName={app.name} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          <Clapperboard className="h-8 w-8 mx-auto mb-3 text-primary" />
          Pick a game to talk with Claude about its videos.
        </div>
      )}
    </div>
  );
}

/**
 * A web game's conversation is its Build chat: the same messages as on its Build page, with
 * the game's code and keys. Other games (no repo, or the console itself) get the Videos chat.
 */
function GameVideoChat({ appId, appName }: { appId: string; appName: string }) {
  const getFn = useServerFn(getBuildChat);
  const q = useQuery({
    queryKey: ["build-chat", appId],
    queryFn: () => getFn({ data: { appId } }),
    refetchInterval: (query) =>
      query.state.data?.turns.some((t) => isActiveTurn(t.status)) ? 3000 : 10_000,
  });
  if (q.isLoading) {
    return (
      <div className="rounded-xl border border-border h-[420px] flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (q.error || !q.data || q.data.blocked) return <VideoChat appId={appId} appName={appName} />;
  return <BuildVideoChat appId={appId} appName={appName} data={q.data} />;
}

type BuildChatData = NonNullable<Awaited<ReturnType<typeof getBuildChat>>>;

function BuildVideoChat({
  appId,
  appName,
  data,
}: {
  appId: string;
  appName: string;
  data: BuildChatData;
}) {
  const [draft, setDraft] = useState("");
  const qc = useQueryClient();
  const sendFn = useServerFn(sendBuildMessage);
  const stopFn = useServerFn(stopBuildTurn);
  const uploadFn = useServerFn(uploadBuildAttachment);
  const attachmentUrlFn = useServerFn(getBuildAttachmentUrl);
  const chatKey = ["build-chat", appId];

  const send = useMutation({
    mutationFn: ({ prompt, attachmentIds }: { prompt: string; attachmentIds: string[] }) =>
      sendFn({ data: { appId, prompt, attachmentIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKey }),
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });
  const stop = useMutation({
    mutationFn: (turnId: string) => stopFn({ data: { turnId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKey }),
    onError: (e: Error) => toast.error(e.message),
  });
  const upload = (file: File, thumbnail: string | null) => {
    const form = new FormData();
    form.set("appId", appId);
    form.set("file", file);
    if (thumbnail) form.set("thumbnail", thumbnail);
    return uploadFn({ data: form });
  };
  // The tab opens from the click and gets the link when it arrives (no pop-up block).
  const openAttachment = async (attachment: BuildAttachment) => {
    const tab = window.open("", "_blank");
    try {
      const { url } = await attachmentUrlFn({ data: { id: attachment.id } });
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-border bg-background h-[min(720px,calc(100dvh-16rem))] min-h-[420px] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Clapperboard className="h-4 w-4 text-primary" />
        <span className="font-display font-semibold text-sm truncate">{appName} · Build chat</span>
        <div className="flex-1" />
        <Button asChild size="sm" variant="ghost" className="h-8 text-xs">
          <Link to="/apps/$id/build" params={{ id: appId }} title="The same chat, with the preview">
            Open with the preview
          </Link>
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <BuildChat
          appName={data.app.name}
          appIcon={data.app.icon}
          repo={data.app.repo}
          turns={data.turns}
          waitingFor={data.waitingFor}
          runner={data.runner}
          account={data.account}
          budget={data.budget}
          sending={send.isPending}
          onSend={(prompt, attachmentIds) => send.mutateAsync({ prompt, attachmentIds })}
          onStop={(turnId) => stop.mutate(turnId)}
          onUpload={upload}
          onOpenAttachment={openAttachment}
          draft={draft}
          setDraft={setDraft}
        />
      </div>
    </div>
  );
}

function VideoChat({ appId, appName }: { appId: string; appName: string }) {
  const [draft, setDraft] = useState("");
  const qc = useQueryClient();
  const getFn = useServerFn(getVideoChat);
  const sendFn = useServerFn(sendVideoMessage);
  const stopFn = useServerFn(stopBuildTurn);
  const newChatFn = useServerFn(newVideoChat);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const spokenAfter = useRef("");
  const dictation = useDictation({
    onTranscript: (text) => {
      const before = spokenAfter.current;
      setDraft(before + (before && !/\s$/.test(before) ? " " : "") + text);
    },
    onError: (message) => toast.error(message),
  });

  const chatKey = ["video-chat", appId];
  const q = useQuery({
    queryKey: chatKey,
    queryFn: () => getFn({ data: { appId } }),
    refetchInterval: (query) =>
      query.state.data?.turns.some((t) => isActiveTurn(t.status)) ? 3000 : 15_000,
  });
  const turns = q.data?.turns ?? [];
  const active = turns.find((t) => isActiveTurn(t.status));

  const lastEvent = turns.at(-1)?.events.at(-1)?.id;
  useEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [turns.length, lastEvent, active?.status]);
  useEffect(() => {
    const box = textareaRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
  }, [draft]);

  const send = useMutation({
    mutationFn: (prompt: string) => sendFn({ data: { appId, prompt } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKey }),
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });
  const stop = useMutation({
    mutationFn: (turnId: string) => stopFn({ data: { turnId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKey }),
    onError: (e: Error) => toast.error(e.message),
  });
  const newChat = useMutation({
    mutationFn: () => newChatFn({ data: { appId } }),
    onSuccess: () => {
      toast.success("New conversation. Claude starts fresh for this game.");
      qc.invalidateQueries({ queryKey: chatKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = q.data;
  const blocked = !data
    ? null
    : !data.account
      ? "none"
      : data.account.rejectedAt
        ? "rejected"
        : data.budget.exhausted
          ? "budget"
          : null;
  const canSend =
    Boolean(data) &&
    !blocked &&
    !active &&
    !send.isPending &&
    draft.trim().length > 0 &&
    draft.length <= MAX_PROMPT_CHARS;
  const submit = async () => {
    if (!canSend) return;
    if (dictation.listening) dictation.stop();
    stick.current = true;
    try {
      await send.mutateAsync(draft.trim());
      setDraft("");
    } catch {
      // The toast says; the text stays.
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-border bg-background h-[min(720px,calc(100dvh-16rem))] min-h-[420px]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Clapperboard className="h-4 w-4 text-primary" />
        <span className="font-display font-semibold text-sm truncate">{appName} · videos</span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5"
          title="Start a new conversation about this game's videos"
          disabled={!turns.length || Boolean(active) || newChat.isPending}
          onClick={() => {
            if (confirm(`Start a new conversation? Claude forgets this one about ${appName}.`))
              newChat.mutate();
          }}
        >
          <MessageSquarePlus className="h-4 w-4" /> New
        </Button>
      </div>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-5"
      >
        {q.isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : turns.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-2 max-w-md mx-auto">
            <p className="font-display font-semibold">Videos for {appName}</p>
            <p className="text-sm text-muted-foreground">
              Tell Claude your reel format once, and ask for the week's videos: ideas, scripts shot
              by shot, captions, hashtags and YouTube titles. It knows the game from the console.
              Any language.
            </p>
            <div className="flex flex-col gap-2 w-full pt-1">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setDraft(example);
                    textareaRef.current?.focus();
                  }}
                  className="text-left text-sm rounded-md border border-border px-3 py-2 hover:bg-muted"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              waitingFor={data?.waitingFor ?? null}
              runnerOnline={data?.runner.online ?? false}
              onRan={() => {}}
              showPlace={false}
            />
          ))
        )}
      </div>

      <div className="border-t border-border p-2.5 space-y-1.5">
        {blocked && (
          <p className="text-xs flex items-start gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
            <span>
              {blocked === "none"
                ? "No Claude account is linked yet."
                : blocked === "rejected"
                  ? "Claude no longer accepts the linked account."
                  : `The weekly share of the Claude limit is used up until ${resetLabel(data!.budget.resetsAt)}.`}{" "}
              <Link to="/settings/claude" className="underline underline-offset-2">
                Settings → Claude
              </Link>
            </span>
          </p>
        )}
        {data && !blocked && !data.runner.online && (
          <p className="text-xs text-muted-foreground flex gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            The build server is offline; messages wait until it's back.
          </p>
        )}
        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              const touch =
                typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touch) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              active
                ? "Claude is working…"
                : dictation.listening
                  ? "Listening…"
                  : `Ask Claude about ${appName}'s videos…`
            }
            disabled={Boolean(blocked)}
            className="min-h-[38px] max-h-[200px] resize-none text-sm"
          />
          {dictation.supported && (
            <Button
              type="button"
              size="icon"
              variant={dictation.listening ? "default" : "ghost"}
              className={cn("shrink-0 h-9 w-9", dictation.listening && "animate-pulse")}
              title={dictation.listening ? "Stop dictating" : "Dictate"}
              aria-pressed={dictation.listening}
              disabled={Boolean(blocked)}
              onClick={() => {
                if (dictation.listening) dictation.stop();
                else {
                  spokenAfter.current = draft;
                  dictation.start();
                }
              }}
            >
              {dictation.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          )}
          {active ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="shrink-0 h-9 w-9"
              onClick={() => stop.mutate(active.id)}
              disabled={active.cancelRequested}
              title="Stop"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="shrink-0 h-9 w-9"
              disabled={!canSend}
              title="Send"
            >
              {send.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          )}
        </form>
        {data && !blocked && data.budget.percent > 0 && data.budget.resetsAt && (
          <p className="text-[10px] text-muted-foreground">
            Shares the Claude limit with the Build chat and Ruben: {data.budget.spent}% of{" "}
            {data.budget.percent}% used this week · resets {ago(data.budget.resetsAt)}
          </p>
        )}
      </div>
    </div>
  );
}

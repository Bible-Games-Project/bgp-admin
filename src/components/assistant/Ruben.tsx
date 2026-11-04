import { useEffect, useRef, useState } from "react";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowUp,
  Loader2,
  MessageSquarePlus,
  Mic,
  MicOff,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { stopBuildTurn } from "@/lib/agent.functions";
import {
  getAssistantChat,
  newAssistantChat,
  sendAssistantMessage,
  type AssistantTurn,
} from "@/lib/assistant.functions";
import { MAX_PROMPT_CHARS, isActiveTurn, resetLabel } from "@/lib/agent";
import { ASSISTANT_NAME, splitReply, type PageContext } from "@/lib/assistant";
import { Markdown } from "@/components/build/Markdown";
import { StepsGroup, segments } from "@/components/build/Steps";
import { useDictation } from "@/components/build/useDictation";
import { ActionButton } from "@/components/assistant/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Ruben, the console's assistant: a button bottom right on every page (or Ctrl+Shift+M),
// and the chat it opens. It sends where the person is with each message, shows what Claude
// reads and says, and turns the actions Claude proposes into buttons (actions.tsx). One
// conversation per person, kept until they start a new one. See src/lib/assistant.ts.

const OPEN_KEY = "bgp-rafa-open";
const EXAMPLES = [
  "What needs attention today?",
  "How did we do last month?",
  "What is this page for?",
];

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });

function pageName(path: string) {
  if (path === "/") return "Home";
  if (/^\/apps\/[^/]+\/build$/.test(path)) return "Build chat";
  if (/^\/apps\/[^/]+$/.test(path)) return "App";
  const first = path.split("/").filter(Boolean).pop() ?? "";
  return first ? first[0].toUpperCase() + first.slice(1) : path;
}

function duration(from: string | null) {
  if (!from) return "";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Claude's words with the actions it proposes as buttons, in order. */
function Reply({ text, onRan }: { text: string; onRan: (label: string, outcome: string) => void }) {
  return (
    <div className="space-y-2">
      {splitReply(text).map((segment, i) =>
        segment.kind === "action" ? (
          <ActionButton key={i} action={segment.action} onRan={onRan} />
        ) : (
          <Markdown key={i} text={segment.text} />
        ),
      )}
    </div>
  );
}

function TurnView({
  turn,
  waitingFor,
  runnerOnline,
  onRan,
}: {
  turn: AssistantTurn;
  waitingFor: string | null;
  runnerOnline: boolean;
  onRan: (label: string, outcome: string) => void;
}) {
  const parts = segments(turn.events);
  const hasText = turn.events.some((e) => e.kind === "text");
  const running = turn.status === "running";
  return (
    <div className="space-y-2.5">
      <div className="flex flex-col items-end gap-0.5">
        <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-primary/10 px-3 py-1.5 text-sm whitespace-pre-wrap break-words">
          {turn.prompt}
        </div>
        {turn.context?.path && (
          <span className="text-[10px] text-muted-foreground">
            on {pageName(turn.context.path)}
            {turn.context.appName ? ` · ${turn.context.appName}` : ""}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {parts.map((part, i) =>
          part.kind === "steps" ? (
            <StepsGroup
              key={part.events[0].id}
              events={part.events}
              live={running && i === parts.length - 1}
            />
          ) : (
            <Reply
              key={part.event.id}
              text={"text" in part.event.body ? part.event.body.text : ""}
              onRan={onRan}
            />
          ),
        )}
        {!hasText && turn.reply && turn.status === "done" && (
          <Reply text={turn.reply} onRan={onRan} />
        )}
        {turn.status === "queued" && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            {!runnerOnline
              ? "Waiting: the build server is offline."
              : waitingFor
                ? `Waiting: Claude is finishing a message for ${waitingFor} first.`
                : "Starting…"}
          </p>
        )}
        {running && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            {turn.cancelRequested ? "Stopping…" : `Thinking · ${duration(turn.startedAt)}`}
          </p>
        )}
        {turn.status === "failed" && turn.error && (
          <p className="flex gap-2 text-sm text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{turn.error}</span>
          </p>
        )}
        {turn.status === "cancelled" && <p className="text-xs text-muted-foreground">Stopped.</p>}
      </div>
    </div>
  );
}

export function Ruben() {
  const location = useRouterState({ select: (s) => s.location });
  const params = useParams({ strict: false }) as { id?: string };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const qc = useQueryClient();
  const getFn = useServerFn(getAssistantChat);
  const sendFn = useServerFn(sendAssistantMessage);
  const stopFn = useServerFn(stopBuildTurn);
  const newChatFn = useServerFn(newAssistantChat);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Actions pressed since the last message, told to Claude with the next one.
  const ran = useRef<{ label: string; outcome: string }[]>([]);
  const spokenAfter = useRef("");
  const dictation = useDictation({
    onTranscript: (text) => {
      const before = spokenAfter.current;
      setDraft(before + (before && !/\s$/.test(before) ? " " : "") + text);
    },
    onError: (message) => toast.error(message),
  });

  // Open as it was left, and Ctrl+Shift+M toggles it.
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "1") setOpen(true);
    } catch {
      // Storage can be off.
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // Same.
    }
  };

  const chatKey = ["assistant-chat"];
  const q = useQuery({
    queryKey: chatKey,
    queryFn: () => getFn(),
    enabled: open,
    refetchInterval: (query) =>
      query.state.data?.turns.some((t) => isActiveTurn(t.status)) ? 3000 : 15_000,
  });
  const turns = q.data?.turns ?? [];
  const active = turns.find((t) => isActiveTurn(t.status));

  const lastEvent = turns.at(-1)?.events.at(-1)?.id;
  useEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [turns.length, lastEvent, active?.status, open]);
  useEffect(() => {
    const box = textareaRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [draft, open]);

  const send = useMutation({
    mutationFn: (prompt: string) => {
      const appId =
        params.id && /^\/apps\/[^/]+/.test(location.pathname) && /^[0-9a-f-]{36}$/i.test(params.id)
          ? params.id
          : undefined;
      const search = location.search as { tab?: string };
      const context: PageContext = {
        path: location.pathname,
        title: typeof document !== "undefined" ? document.title : undefined,
        ...(appId ? { appId } : {}),
        ...(typeof search?.tab === "string" ? { tab: search.tab } : {}),
        ...(ran.current.length ? { ranActions: ran.current } : {}),
      };
      return sendFn({ data: { prompt, context } });
    },
    onSuccess: () => {
      ran.current = [];
      qc.invalidateQueries({ queryKey: chatKey });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });
  const stop = useMutation({
    mutationFn: (turnId: string) => stopFn({ data: { turnId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKey }),
    onError: (e: Error) => toast.error(e.message),
  });
  const newChat = useMutation({
    mutationFn: () => newChatFn(),
    onSuccess: () => {
      toast.success(`New chat. ${ASSISTANT_NAME} starts fresh.`);
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
  const onRan = (label: string, outcome: string) => {
    ran.current = [...ran.current.slice(-9), { label, outcome }];
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => toggle(true)}
        title={`${ASSISTANT_NAME} (Ctrl+Shift+M)`}
        className="fixed z-40 bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg pl-3.5 pr-4 h-11 text-sm font-medium hover:bg-primary/90"
      >
        <Sparkles className="h-4 w-4" /> {ASSISTANT_NAME}
      </button>
    );
  }

  return (
    <div
      data-no-pull-refresh
      className={cn(
        "fixed z-40 flex flex-col bg-background border-border shadow-2xl",
        "inset-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        "md:inset-auto md:bottom-4 md:right-4 md:w-[400px] md:h-[min(680px,calc(100dvh-2rem))] md:rounded-xl md:border md:pt-0 md:pb-0",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-display font-semibold text-sm">{ASSISTANT_NAME}</span>
        <span className="text-[11px] text-muted-foreground truncate">
          · on {pageName(location.pathname)}
        </span>
        <div className="flex-1" />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title="Start a new conversation"
          disabled={!turns.length || Boolean(active) || newChat.isPending}
          onClick={() => {
            if (confirm(`Start a new chat? ${ASSISTANT_NAME} forgets this conversation.`))
              newChat.mutate();
          }}
        >
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title="Close"
          onClick={() => toggle(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 space-y-5"
      >
        {q.isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : turns.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-2">
            <Sparkles className="h-8 w-8 text-primary" />
            <p className="font-display font-semibold">Hi, I'm {ASSISTANT_NAME}.</p>
            <p className="text-sm text-muted-foreground">
              Ask me about what you're looking at, or what to do next. I can look at Home, the apps,
              revenue, expenses and reviews, and propose what to press. Any language.
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
              onRan={onRan}
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
                ? `${ASSISTANT_NAME} is thinking…`
                : dictation.listening
                  ? "Listening…"
                  : `Ask ${ASSISTANT_NAME}…`
            }
            disabled={Boolean(blocked)}
            className="min-h-[38px] max-h-[160px] resize-none text-sm"
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
            Weekly share of the Claude limit: {data.budget.spent}% of {data.budget.percent}% used ·
            resets {ago(data.budget.resetsAt)}
          </p>
        )}
      </div>
    </div>
  );
}

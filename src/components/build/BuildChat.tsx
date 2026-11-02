import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUp,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  GitCommitHorizontal,
  Loader2,
  Square,
  TriangleAlert,
} from "lucide-react";
import type { BuildTurn } from "@/lib/agent.functions";
import {
  MAX_PROMPT_CHARS,
  isActiveTurn,
  type AgentAccount,
  type AgentEvent,
  type RunnerView,
} from "@/lib/agent";
import { Markdown } from "@/components/build/Markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "Make the player jump a bit higher",
  "Add a pause button in the top corner",
  "The text overlaps on small phones. Fix it",
];

function duration(from: string | null, to: string | null) {
  if (!from) return null;
  const seconds = Math.max(
    0,
    Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000),
  );
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Ticks once a second while something on screen counts time. */
function useNow(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

type Segment = { kind: "text"; event: AgentEvent } | { kind: "steps"; events: AgentEvent[] };

/** Claude's words, with each run of steps between them folded into one group. */
function segments(events: AgentEvent[]): Segment[] {
  const out: Segment[] = [];
  for (const event of events) {
    const last = out[out.length - 1];
    if (event.kind === "step") {
      if (last?.kind === "steps") last.events.push(event);
      else out.push({ kind: "steps", events: [event] });
    } else out.push({ kind: "text", event });
  }
  return out;
}

const label = (event: AgentEvent) => ("label" in event.body ? event.body.label : "");

function StepsGroup({ events, live }: { events: AgentEvent[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const last = events[events.length - 1];
  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 hover:text-foreground max-w-full"
      >
        <ChevronRight
          className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
        />
        {live ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
        <span className="truncate">
          {events.length === 1 ? "1 step" : `${events.length} steps`} · {label(last)}
        </span>
      </button>
      {open && (
        <ul className="mt-1.5 ml-4 space-y-1 border-l border-border pl-3">
          {events.map((e) => (
            <li key={e.id} className="break-words">
              {label(e)}
              {"todos" in e.body && e.body.todos?.length ? (
                <ul className="mt-1 space-y-0.5">
                  {e.body.todos.map((t, i) => (
                    <li key={i} className="flex gap-1.5">
                      {t.status === "completed" ? (
                        <CircleCheck className="h-3 w-3 mt-0.5 shrink-0 text-emerald-500" />
                      ) : (
                        <CircleDashed className="h-3 w-3 mt-0.5 shrink-0" />
                      )}
                      <span className={t.status === "completed" ? "line-through" : ""}>
                        {t.content}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TurnView({
  turn,
  repo,
  waitingFor,
  runnerOnline,
}: {
  turn: BuildTurn;
  repo: string | null;
  waitingFor: string | null;
  runnerOnline: boolean;
}) {
  const parts = segments(turn.events);
  const hasText = turn.events.some((e) => e.kind === "text");
  const running = turn.status === "running";
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
          {turn.prompt}
        </div>
      </div>
      <div className="space-y-2.5">
        {parts.map((part, i) =>
          part.kind === "steps" ? (
            <StepsGroup
              key={part.events[0].id}
              events={part.events}
              live={running && i === parts.length - 1}
            />
          ) : (
            <Markdown
              key={part.event.id}
              text={"text" in part.event.body ? part.event.body.text : ""}
            />
          ),
        )}
        {!hasText && turn.reply && turn.status === "done" && <Markdown text={turn.reply} />}

        {turn.status === "queued" && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            {!runnerOnline
              ? "Waiting: the build server is offline. This starts as soon as it's back."
              : waitingFor
                ? `Waiting: Claude is finishing a message for ${waitingFor} first.`
                : "Starting…"}
          </p>
        )}
        {running && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            {turn.cancelRequested ? "Stopping…" : `Working · ${duration(turn.startedAt, null)}`}
          </p>
        )}
        {turn.status === "failed" && turn.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2">
            <p className="flex gap-2 text-destructive">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{turn.error}</span>
            </p>
            {/Settings → Claude/.test(turn.error) && (
              <Button asChild size="sm" variant="outline">
                <Link to="/settings/claude">Open Settings → Claude</Link>
              </Button>
            )}
          </div>
        )}
        {turn.status === "cancelled" && <p className="text-xs text-muted-foreground">Stopped.</p>}
        {!isActiveTurn(turn.status) && (turn.commits > 0 || turn.finishedAt) && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
            {turn.pushedSha && repo ? (
              <a
                href={`https://github.com/${repo}/commit/${turn.pushedSha}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <GitCommitHorizontal className="h-3 w-3" />
                {turn.commits === 1 ? "1 change saved" : `${turn.commits} changes saved`} ·{" "}
                {turn.pushedSha.slice(0, 7)}
              </a>
            ) : turn.status === "done" ? (
              <span>No changes to the game</span>
            ) : null}
            {turn.startedAt && turn.finishedAt && (
              <span>· {duration(turn.startedAt, turn.finishedAt)}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export function BuildChat({
  appName,
  appIcon,
  repo,
  turns,
  waitingFor,
  runner,
  account,
  sending,
  onSend,
  onStop,
  draft,
  setDraft,
}: {
  appName: string;
  appIcon: string | null;
  repo: string | null;
  turns: BuildTurn[];
  waitingFor: string | null;
  runner: RunnerView;
  account: AgentAccount | null;
  sending: boolean;
  onSend: (prompt: string) => Promise<unknown>;
  onStop: (turnId: string) => void;
  draft: string;
  setDraft: (text: string) => void;
}) {
  const active = turns.find((t) => isActiveTurn(t.status));
  useNow(Boolean(active));
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Follows the conversation as it grows, unless the person scrolled up to read.
  const lastEvent = turns.at(-1)?.events.at(-1)?.id;
  useEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [turns.length, lastEvent, active?.status]);

  // The box grows with what's typed, up to a point.
  useEffect(() => {
    const box = textareaRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
  }, [draft]);

  const blocked = !account ? "none" : account.rejectedAt ? "rejected" : null;
  const canSend =
    !blocked && !active && !sending && draft.trim().length > 0 && draft.length <= MAX_PROMPT_CHARS;

  const send = async () => {
    if (!canSend) return;
    stick.current = true;
    try {
      await onSend(draft.trim());
      setDraft("");
    } catch {
      // The page shows the error; the text stays so it isn't lost.
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-6"
      >
        {turns.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-4">
            {appIcon && (
              <img src={appIcon} alt="" className="h-12 w-12 rounded-xl border border-border" />
            )}
            <p className="font-display font-semibold">What should Claude change in {appName}?</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Write it as you'd tell a person, in any language. Claude changes the game's code and
              saves it to GitHub, and the preview updates about a minute later.
            </p>
            <div className="flex flex-col gap-2 w-full max-w-sm pt-2">
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
              repo={repo}
              waitingFor={waitingFor}
              runnerOnline={runner.online}
            />
          ))
        )}
      </div>

      <div className="border-t border-border p-3 space-y-2">
        {blocked && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            <span>
              {blocked === "none"
                ? "No Claude account is linked yet, so Claude can't work."
                : "Claude no longer accepts the linked account."}
            </span>
            <Button asChild size="sm">
              <Link to="/settings/claude">{blocked === "none" ? "Link one" : "Link it again"}</Link>
            </Button>
          </div>
        )}
        {!blocked && !runner.online && (
          <p className="text-xs text-muted-foreground flex gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            The build server is offline. Messages wait and start as soon as it's back.
          </p>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends on a keyboard; on a phone it's a new line, and the button sends.
              const touch =
                typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touch) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={active ? "Claude is working…" : "Tell Claude what to change…"}
            disabled={Boolean(blocked)}
            className="min-h-[40px] max-h-[200px] resize-none"
          />
          {active ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onStop(active.id)}
              disabled={active.cancelRequested}
              title="Stop"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!canSend} title="Send">
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          )}
        </form>
        {draft.length > MAX_PROMPT_CHARS && (
          <p className="text-xs text-destructive">
            That's {draft.length.toLocaleString("en")} characters; the limit is{" "}
            {MAX_PROMPT_CHARS.toLocaleString("en")}.
          </p>
        )}
      </div>
    </div>
  );
}

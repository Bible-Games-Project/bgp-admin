import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowUp,
  GitCommitHorizontal,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Square,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import type { BuildTurn } from "@/lib/agent.functions";
import {
  ATTACHMENT_ACCEPT,
  MAX_PROMPT_CHARS,
  isActiveTurn,
  resetLabel,
  type AgentAccount,
  type AgentEvent,
  type BuildAttachment,
  type RunnerView,
  type WeeklyBudget,
} from "@/lib/agent";
import { Markdown } from "@/components/build/Markdown";
import { StepsGroup, segments } from "@/components/build/Steps";
import {
  AttachmentList,
  PendingChips,
  usePendingAttachments,
} from "@/components/build/Attachments";
import { useDictation } from "@/components/build/useDictation";
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

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });

/** Ticks once a second while something on screen counts time. */
function useNow(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

function TurnView({
  turn,
  repo,
  waitingFor,
  runnerOnline,
  onOpenAttachment,
}: {
  turn: BuildTurn;
  repo: string | null;
  waitingFor: string | null;
  runnerOnline: boolean;
  onOpenAttachment: (attachment: BuildAttachment) => void;
}) {
  const parts = segments(turn.events);
  const hasText = turn.events.some((e) => e.kind === "text");
  const running = turn.status === "running";
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
          <AttachmentList attachments={turn.attachments} onOpen={onOpenAttachment} />
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

/** Files dragged from the desktop onto the chat; anything else (text, links) is ignored. */
function droppedFiles(transfer: DataTransfer | null) {
  return Array.from(transfer?.files ?? []);
}

export function BuildChat({
  appName,
  appIcon,
  repo,
  turns,
  waitingFor,
  runner,
  account,
  budget,
  sending,
  onSend,
  onStop,
  onUpload,
  onOpenAttachment,
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
  budget: WeeklyBudget;
  sending: boolean;
  onSend: (prompt: string, attachmentIds: string[]) => Promise<unknown>;
  onStop: (turnId: string) => void;
  onUpload: (file: File, thumbnail: string | null) => Promise<BuildAttachment>;
  onOpenAttachment: (attachment: BuildAttachment) => void;
  draft: string;
  setDraft: (text: string) => void;
}) {
  const active = turns.find((t) => isActiveTurn(t.status));
  useNow(Boolean(active));
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachments = usePendingAttachments(onUpload);
  // Files dragged over the chat: counted, since the browser fires leave for every child.
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  // What was in the box when dictation started; the spoken words go after it.
  const spokenAfter = useRef("");
  const dictation = useDictation({
    onTranscript: (text) => {
      const before = spokenAfter.current;
      setDraft(before + (before && !/\s$/.test(before) ? " " : "") + text);
    },
    onError: (message) => toast.error(message),
  });

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

  const blocked = !account
    ? "none"
    : account.rejectedAt
      ? "rejected"
      : budget.exhausted
        ? "budget"
        : null;
  const canAttach = !blocked && !active;
  const canSend =
    !blocked &&
    !active &&
    !sending &&
    !attachments.uploading &&
    draft.trim().length > 0 &&
    draft.length <= MAX_PROMPT_CHARS;

  const send = async () => {
    if (!canSend) return;
    if (dictation.listening) dictation.stop();
    stick.current = true;
    try {
      await onSend(draft.trim(), attachments.ids);
      setDraft("");
      attachments.clear();
    } catch {
      // The page shows the error; the text and the files stay so they aren't lost.
    }
  };

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    if (!canAttach) {
      toast.error(
        active ? "Wait for Claude to finish before attaching files." : "Files can't be sent now.",
      );
      return;
    }
    attachments.add(files);
    textareaRef.current?.focus();
  };

  return (
    <div
      className="flex flex-col h-full min-h-0 relative"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        addFiles(droppedFiles(e.dataTransfer));
      }}
    >
      {dragOver && (
        <div className="absolute inset-0 z-20 m-2 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/90 text-sm font-medium pointer-events-none">
          Drop the files to attach them
        </div>
      )}
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
              saves it to GitHub, and the preview updates about a minute later. You can attach
              photos, PDFs and text files for it to look at.
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
              onOpenAttachment={onOpenAttachment}
            />
          ))
        )}
      </div>

      <div className="border-t border-border p-3 space-y-2">
        {blocked && blocked !== "budget" && (
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
        {blocked === "budget" && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
            <span>
              The Build chat has used its share of this week's Claude limit ({budget.percent}%). It
              can go on {resetLabel(budget.resetsAt)}
              {budget.resetsAt ? ` (${ago(budget.resetsAt)})` : ""}.
            </span>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link to="/settings/claude">Change the share</Link>
            </Button>
          </div>
        )}
        {!blocked && !runner.online && (
          <p className="text-xs text-muted-foreground flex gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            The build server is offline. Messages wait and start as soon as it's back.
          </p>
        )}
        <PendingChips pending={attachments.pending} onRemove={attachments.remove} />
        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0"
            title="Attach a photo, a PDF or a text file"
            aria-label="Attach a file"
            disabled={!canAttach}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
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
            onPaste={(e) => {
              // A screenshot pasted from the clipboard comes as a file.
              const files = Array.from(e.clipboardData.files ?? []);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            rows={1}
            placeholder={
              active
                ? "Claude is working…"
                : dictation.listening
                  ? "Listening…"
                  : attachments.pending.length
                    ? "Tell Claude what to do with the files…"
                    : "Tell Claude what to change…"
            }
            disabled={Boolean(blocked)}
            className="min-h-[40px] max-h-[200px] resize-none"
          />
          {dictation.supported && (
            <Button
              type="button"
              size="icon"
              variant={dictation.listening ? "default" : "ghost"}
              className={cn("shrink-0", dictation.listening && "animate-pulse")}
              title={dictation.listening ? "Stop dictating" : "Dictate (the browser listens)"}
              aria-label={dictation.listening ? "Stop dictating" : "Dictate"}
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
              className="shrink-0"
              onClick={() => onStop(active.id)}
              disabled={active.cancelRequested}
              title="Stop"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" className="shrink-0" disabled={!canSend} title="Send">
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
        {!blocked && budget.percent > 0 && budget.resetsAt && (
          <p className="text-[11px] text-muted-foreground">
            Weekly share of the Claude limit: {budget.spent}% of {budget.percent}% used · resets{" "}
            {ago(budget.resetsAt)}
          </p>
        )}
      </div>
    </div>
  );
}

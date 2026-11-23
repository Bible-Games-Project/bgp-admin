import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageCircleReply, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { COMMENTS_BRIEF_LABEL } from "@/lib/video-comments";
import { answerCommentsNow, getReelComments, setAnswerComments } from "@/lib/videos.functions";

// Answering the comments on a web game's reels (src/lib/video-comments.ts): when on, every night
// the game's Build chat answers the new comments on its reels at Upload-Post, once each.

const LAST_RUN = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Madrid",
});

const STATUS_WORDS: Record<string, string> = {
  queued: "waiting its turn in the Build chat",
  running: "Claude is answering them now",
  done: "done: Claude's summary is in the Build chat",
  failed: "it didn't work: the Build chat says why",
  cancelled: "it was stopped",
};

export function ReelComments({ appId, appName }: { appId: string; appName: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getReelComments);
  const setFn = useServerFn(setAnswerComments);
  const nowFn = useServerFn(answerCommentsNow);
  const key = ["reel-comments", appId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => getFn({ data: { appId } }),
    refetchInterval: 30_000,
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) => setFn({ data: { appId, on } }),
    onSuccess: (_, on) => {
      toast.success(
        on
          ? `On. ${appName}'s Build chat will answer the new comments ${COMMENTS_BRIEF_LABEL}.`
          : "Off.",
      );
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const now = useMutation({
    mutationFn: () => nowFn({ data: { appId } }),
    onSuccess: () => {
      toast.success(`Sent to ${appName}'s Build chat, above. Claude's summary shows there.`, {
        duration: 8_000,
      });
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["build-chat", appId] });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });

  if (q.data && !q.data.available) return null;
  const last = q.data?.last;

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-4">
      <div className="flex items-start gap-3">
        <MessageCircleReply className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-semibold">Answer comments</h2>
          <p className="text-sm text-muted-foreground">
            {COMMENTS_BRIEF_LABEL.replace(/^./, (c) => c.toUpperCase())}, {appName}'s Build chat
            reads the new comments on its reels at Upload-Post (YouTube, TikTok, Instagram and
            Facebook) and answers each one once, kindly and in the commenter's language. It skips
            spam, insults and anything a careful person wouldn't answer. It uses the Claude share of
            the console, not another AI service.
          </p>
        </div>
      </div>
      {q.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (
        <>
          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={Boolean(q.data?.answerComments)}
              disabled={toggle.isPending}
              onCheckedChange={(on) => toggle.mutate(on)}
            />
            Answer {appName}'s new comments {COMMENTS_BRIEF_LABEL}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={now.isPending}
              onClick={() => now.mutate()}
              title="Send it to the Build chat now, without waiting for the night"
            >
              {now.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Answer now
            </Button>
            <p className="text-xs text-muted-foreground">
              {last
                ? `Last time: ${LAST_RUN.format(new Date(last.sentAt))}, ${STATUS_WORDS[last.status] ?? last.status}.`
                : "Not asked yet."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  ChevronDown,
  Copy,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MAX_FORMAT_CHARS, WEEKLY_BRIEF_LABEL, dayLabel } from "@/lib/video-reels";
import {
  getVideoReels,
  planNextWeekNow,
  saveVideoSettings,
  setReelStatus,
  type VideoReel,
} from "@/lib/videos.functions";
import { cn } from "@/lib/utils";

// The weekly reels of one game on the Videos page (src/lib/video-reels.ts): whether Claude
// plans them every Sunday night, the format it follows, and the reels it planned, to review.

export function WeeklyReels({ appId, appName }: { appId: string; appName: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getVideoReels);
  const saveFn = useServerFn(saveVideoSettings);
  const statusFn = useServerFn(setReelStatus);
  const planFn = useServerFn(planNextWeekNow);
  const key = ["video-reels", appId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => getFn({ data: { appId } }),
    refetchInterval: 20_000,
  });

  const [weeklyReels, setWeeklyReels] = useState(false);
  const [format, setFormat] = useState("");
  const loaded = q.data?.settings;
  useEffect(() => {
    if (!loaded) return;
    setWeeklyReels(loaded.weeklyReels);
    setFormat(loaded.format);
  }, [loaded?.weeklyReels, loaded?.format]);
  const changed = loaded && (loaded.weeklyReels !== weeklyReels || loaded.format !== format.trim());

  const save = useMutation({
    mutationFn: () => saveFn({ data: { appId, weeklyReels, format } }),
    onSuccess: () => {
      toast.success(
        weeklyReels
          ? `Saved. Claude will plan ${appName}'s reels ${WEEKLY_BRIEF_LABEL}.`
          : "Saved.",
      );
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const plan = useMutation({
    mutationFn: () => planFn({ data: { appId } }),
    onSuccess: () => {
      toast.success("Sent. Claude is planning next week's reels in the conversation above.");
      qc.invalidateQueries({ queryKey: ["video-chat", appId] });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: "planned" | "discarded" }) => statusFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  const reels = q.data?.reels ?? [];
  const weeks = [...new Set(reels.map((r) => r.week_of))];

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-4">
      <div className="flex items-start gap-3">
        <CalendarClock className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-semibold">Weekly reels</h2>
          <p className="text-sm text-muted-foreground">
            Claude plans next week's reels {WEEKLY_BRIEF_LABEL}, one every other day, in your
            format. You review them here. Recording them with the voice and scheduling them in
            Metricool come next.
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
            <Switch checked={weeklyReels} onCheckedChange={setWeeklyReels} />
            Plan {appName}'s reels {WEEKLY_BRIEF_LABEL}
          </label>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Reel format</p>
            <Textarea
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              maxLength={MAX_FORMAT_CHARS}
              rows={4}
              placeholder="For example: 20–30 seconds, vertical. A hook in the first 2 seconds, gameplay with big text on screen, a voice-over in Spanish, and a call to download at the end."
              className="text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Leave it empty to use the format you agreed with Claude in the conversation above.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={plan.isPending}
              onClick={() => plan.mutate()}
              title="Ask Claude for next week's reels now, without waiting for Sunday"
            >
              {plan.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Plan next week now
            </Button>
          </div>

          {weeks.length === 0 ? (
            <p className="text-sm text-muted-foreground border-t border-border pt-3">
              No reels planned yet.{" "}
              {weeklyReels
                ? `They'll show here after ${WEEKLY_BRIEF_LABEL.replace("every ", "")}.`
                : "Turn on the weekly reels, or press “Plan next week now”."}
            </p>
          ) : (
            weeks.map((week) => (
              <div key={week} className="border-t border-border pt-3 space-y-2">
                <p className="label-mono">week of {dayLabel(week)}</p>
                {reels
                  .filter((r) => r.week_of === week)
                  .map((reel) => (
                    <ReelCard
                      key={reel.id}
                      reel={reel}
                      busy={setStatus.isPending}
                      onStatus={(status) => setStatus.mutate({ id: reel.id, status })}
                    />
                  ))}
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}

function copy(text: string, what: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${what} copied.`))
    .catch(() => toast.error("Couldn't copy. Select the text and copy it."));
}

function ReelCard({
  reel,
  busy,
  onStatus,
}: {
  reel: VideoReel;
  busy: boolean;
  onStatus: (status: "planned" | "discarded") => void;
}) {
  const discarded = reel.status === "discarded";
  const post = [reel.caption, reel.hashtags.join(" ")].filter(Boolean).join("\n\n");
  return (
    <Collapsible className={cn("rounded-lg border border-border", discarded && "opacity-60")}>
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="flex-1 min-w-0 text-left flex items-center gap-2 group">
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
          <span className="text-xs text-muted-foreground shrink-0 w-28">
            {dayLabel(reel.publish_on)}
          </span>
          <span className={cn("text-sm font-medium truncate", discarded && "line-through")}>
            {reel.title}
          </span>
        </CollapsibleTrigger>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          disabled={busy}
          title={discarded ? "Bring it back" : "Discard this reel"}
          onClick={() => onStatus(discarded ? "planned" : "discarded")}
        >
          {discarded ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
      <CollapsibleContent className="px-3 pb-3 space-y-3 text-sm">
        {reel.hook && <Field label="Hook" text={reel.hook} />}
        {reel.script && <Field label="Script" text={reel.script} />}
        {reel.voiceover && <Field label="Voice-over" text={reel.voiceover} copyable />}
        {post && <Field label="Caption and hashtags" text={post} copyable />}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({ label, text, copyable }: { label: string; text: string; copyable?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {copyable && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            title={`Copy the ${label.toLowerCase()}`}
            onClick={() => copy(text, label)}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}

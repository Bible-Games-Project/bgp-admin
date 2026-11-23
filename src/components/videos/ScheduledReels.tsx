import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3, ChevronDown, ExternalLink, Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  connectUploadPost,
  disconnectUploadPost,
  getScheduledReels,
  refreshReelMetricsNow,
} from "@/lib/videos.functions";
import { sendBuildMessage } from "@/lib/agent.functions";
import {
  networkName,
  numbersLabel,
  pickedReelsMessage,
  postTimeLabel,
  type ScheduledPost,
  type UnscheduledShort,
} from "@/lib/scheduled-reels";
import {
  METRICS_EVERY_HOURS,
  metricsLine,
  shortNumber,
  totalViews,
  type GameReelMetrics,
  type NetworkMetrics,
  type ReelNumbers,
} from "@/lib/reel-metrics";
import { cn } from "@/lib/utils";

// A web game's reels, in a side bar on the Videos page (scheduled-reels.ts), in three tabs:
// Testing, the shorts its Build chat made that aren't scheduled yet, newest first, for the team
// to pick ("I like 3 and 4" goes to the Build chat); Pending, the ones scheduled at Upload-Post
// still to come out; Published, the ones already out. Each reel keeps its number in all three.
// Read from the files the game keeps in its repo. Published also shows how each reel is doing
// on each network, from Upload-Post (reel-metrics.ts), once the team pastes its key.

type Tab = "testing" | "pending" | "published";

export function ScheduledReels({ appId, appName }: { appId: string; appName: string }) {
  const getFn = useServerFn(getScheduledReels);
  const q = useQuery({
    queryKey: ["scheduled-reels", appId],
    queryFn: () => getFn({ data: { appId } }),
    refetchInterval: 120_000,
  });
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const data = q.data;
  if (data && !data.hasRepo) return null;

  const testingCount = data?.hasRepo ? data.unscheduled.length : 0;
  const pendingCount = data?.hasRepo ? data.upcoming.length : 0;
  const publishedCount = data?.hasRepo ? data.past.length : 0;
  // Opens on Testing when there's something to pick, else on Pending.
  const tab: Tab = chosenTab ?? (testingCount > 0 ? "testing" : "pending");

  return (
    <aside className="rounded-xl border border-border bg-background flex flex-col min-h-0 max-h-[640px] lg:max-h-[calc(100dvh-2rem)] lg:w-80 xl:w-96 shrink-0 lg:sticky lg:top-4">
      <div className="px-4 pt-4 pb-3 space-y-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <h2 className="font-display font-semibold">Reels</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {appName}'s reels
          {data?.hasRepo && data.profile ? ` (Upload-Post profile ${data.profile})` : ""}: the ones
          Claude made for you to try, the ones still to come out and the ones already out. Each one
          keeps its number. A change made on Upload-Post's website doesn't show here.
        </p>
        {data?.hasRepo && (
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-sm">
            <TabButton active={tab === "testing"} onClick={() => setTab("testing")}>
              Testing ({testingCount})
            </TabButton>
            <TabButton active={tab === "pending"} onClick={() => setTab("pending")}>
              Pending ({pendingCount})
            </TabButton>
            <TabButton active={tab === "published"} onClick={() => setTab("published")}>
              Published ({publishedCount})
            </TabButton>
          </div>
        )}
      </div>

      {q.isLoading || !data ? (
        <div className="p-3">
          {q.error ? (
            <p className="text-sm text-destructive">{(q.error as Error).message}</p>
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      ) : !data.hasRepo ? null : tab === "testing" ? (
        <TestingTab
          key={appId}
          appId={appId}
          appName={appName}
          shorts={data.unscheduled}
          hasShorts={data.unscheduled.length + data.upcoming.length + data.past.length > 0}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-2">
          {tab === "pending" ? (
            data.upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {data.hasLog
                  ? "Nothing scheduled from now on."
                  : `Nothing scheduled yet. When ${appName}'s Build chat schedules reels at Upload-Post, they show here, as long as it keeps them in tools/shorts/published.json like Eden to Heaven does. If it schedules them some other way, ask it in the chat to keep that file.`}
              </p>
            ) : (
              data.upcoming.map((post) => (
                <ReelRow
                  key={`${post.id}-${post.at}`}
                  number={post.number}
                  title={post.title}
                  detail={`${postTimeLabel(post.at, data.timeZone)}${
                    post.platforms.length > 0
                      ? ` · ${post.platforms.map(networkName).join(", ")}`
                      : ""
                  }`}
                  videoUrl={post.videoUrl}
                  thumbnailUrl={post.thumbnailUrl}
                />
              ))
            )
          ) : data.past.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing published yet.</p>
          ) : (
            <>
              <MetricsBar appId={appId} metrics={data.metrics} />
              {data.past.map((post) => {
                const numbers = postMetrics(post, data.metrics.byJob);
                const views = numbers ? totalViews(numbers.platforms) : 0;
                return (
                  <ReelRow
                    key={`${post.id}-${post.at}`}
                    number={post.number}
                    title={post.title}
                    detail={`${postTimeLabel(post.at, data.timeZone)}${
                      numbers && views > 0
                        ? ` · ${shortNumber(views)} views in all`
                        : post.platforms.length > 0
                          ? ` · ${post.platforms.map(networkName).join(", ")}`
                          : ""
                    }`}
                    videoUrl={post.videoUrl}
                    thumbnailUrl={post.thumbnailUrl}
                  >
                    {numbers ? (
                      <NetworkLines numbers={numbers} />
                    ) : data.metrics.connected && post.jobs.length > 0 ? (
                      <p className="px-3 pb-2 text-xs text-muted-foreground">
                        No numbers yet: they show within a day of it coming out.
                      </p>
                    ) : null}
                  </ReelRow>
                );
              })}
            </>
          )}
        </div>
      )}
    </aside>
  );
}

/**
 * The reels Claude made that aren't scheduled, newest on top, each with its number. Tick the
 * ones you like, say something if you want, and it goes to the game's Build chat.
 */
function TestingTab({
  appId,
  appName,
  shorts,
  hasShorts,
}: {
  appId: string;
  appName: string;
  shorts: UnscheduledShort[];
  hasShorts: boolean;
}) {
  const qc = useQueryClient();
  const sendFn = useServerFn(sendBuildMessage);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const chosen = shorts.filter((s) => picked.has(s.id));
  const send = useMutation({
    mutationFn: () => sendFn({ data: { appId, prompt: pickedReelsMessage(chosen, note) } }),
    onSuccess: () => {
      setPicked(new Set());
      setNote("");
      qc.invalidateQueries({ queryKey: ["build-chat", appId] });
      toast.success("Sent to the Build chat. Claude's answer shows there.");
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });
  const toggle = (id: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-2">
        {shorts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {hasShorts
              ? "Nothing to try: every reel Claude made is already scheduled."
              : `Nothing yet. When ${appName}'s Build chat makes reels and keeps them in tools/shorts/shorts.json, like Eden to Heaven does, the ones not scheduled yet show here for you to pick.`}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Made by Claude, not scheduled yet. Newest on top. Tick the ones you like and tell
              Claude.
            </p>
            {shorts.map((short) => (
              <ReelRow
                key={short.id}
                number={short.number}
                title={short.title}
                detail={short.id}
                videoUrl={short.videoUrl}
                thumbnailUrl={short.thumbnailUrl}
                picked={picked.has(short.id)}
                onPick={() => toggle(short.id)}
              />
            ))}
          </>
        )}
      </div>
      {chosen.length > 0 && (
        <div className="border-t border-border p-3 space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={`Tell Claude what to do with ${chosen.length === 1 ? "it" : "them"}, e.g. "I like these, schedule them".`}
            className="text-sm min-h-0"
          />
          <Button className="w-full" disabled={send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send{" "}
            {numbersLabel([...chosen].sort((a, b) => a.number - b.number).map((s) => s.number))} to
            the Build chat
          </Button>
        </div>
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md h-8 px-1 text-xs sm:text-sm truncate",
        active
          ? "bg-background font-medium shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ReelRow({
  number,
  title,
  detail,
  videoUrl,
  thumbnailUrl,
  picked,
  onPick,
  children,
}: {
  number: number | null;
  title: string;
  detail: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  picked?: boolean;
  onPick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Collapsible
      className={cn("rounded-lg border", picked ? "border-primary bg-primary/5" : "border-border")}
    >
      <div className="flex items-center gap-1 px-2 py-2">
        {onPick && (
          <Checkbox
            checked={picked}
            onCheckedChange={onPick}
            aria-label={`Pick reel ${number ?? ""}`}
            className="mr-1 shrink-0"
          />
        )}
        <CollapsibleTrigger
          disabled={!videoUrl}
          className="flex-1 min-w-0 text-left flex items-center gap-2.5 group"
        >
          {number !== null && (
            <span className="shrink-0 min-w-7 text-center rounded-md bg-muted px-1 py-0.5 text-xs font-semibold tabular-nums">
              {number}
            </span>
          )}
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-12 w-7 shrink-0 rounded object-cover bg-muted"
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
          )}
          <span className="min-w-0">
            <span className="block text-sm font-medium leading-snug line-clamp-2">{title}</span>
            <span className="block text-xs text-muted-foreground">{detail}</span>
          </span>
        </CollapsibleTrigger>
        {videoUrl && (
          <Button
            asChild
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            title="Open the video"
          >
            <a href={videoUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>
      {children}
      {videoUrl && (
        <CollapsibleContent className="px-2 pb-2">
          <video
            src={videoUrl}
            controls
            playsInline
            preload="none"
            poster={thumbnailUrl ?? undefined}
            className="w-full max-h-96 rounded-md bg-black"
          />
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

/** A post's kept numbers: those of its latest job that has some. */
function postMetrics(post: ScheduledPost, byJob: GameReelMetrics["byJob"]): ReelNumbers | null {
  for (const job of [...post.jobs].reverse()) {
    const numbers = byJob[job];
    if (numbers && Object.keys(numbers.platforms).length) return numbers;
  }
  return null;
}

/** Each network's numbers for one reel, a line each, with a link to the post. */
function NetworkLines({ numbers }: { numbers: ReelNumbers }) {
  const networks = Object.entries(numbers.platforms) as [string, NetworkMetrics][];
  return (
    <ul className="px-3 pb-2 space-y-0.5 text-xs">
      {networks.map(([platform, m]) => {
        const line = metricsLine(m);
        return (
          <li key={platform} className="text-muted-foreground">
            {m.url ? (
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground hover:underline"
              >
                {networkName(platform)}
              </a>
            ) : (
              <span className="font-medium text-foreground">{networkName(platform)}</span>
            )}
            : {line || (m.error ? "no numbers yet" : "no numbers from this network")}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Above the published reels: where the numbers come from, and the box for the Upload-Post key
 * when there's none (or Upload-Post turned it down).
 */
function MetricsBar({ appId, metrics }: { appId: string; metrics: GameReelMetrics }) {
  const qc = useQueryClient();
  const connectFn = useServerFn(connectUploadPost);
  const disconnectFn = useServerFn(disconnectUploadPost);
  const refreshFn = useServerFn(refreshReelMetricsNow);
  const [key, setKey] = useState("");
  const [changing, setChanging] = useState(false);
  const reload = () => qc.invalidateQueries({ queryKey: ["scheduled-reels"] });
  const connect = useMutation({
    mutationFn: () => connectFn({ data: { appId, key } }),
    onSuccess: (r) => {
      setKey("");
      setChanging(false);
      toast.success(
        r.read > 0
          ? "Connected. The numbers of the published reels show under each one."
          : "Connected. The numbers show here as the console reads them.",
      );
      reload();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });
  const disconnect = useMutation({
    mutationFn: () => disconnectFn(),
    onSuccess: () => {
      toast.success("Key removed. The numbers already read stay.");
      reload();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const refresh = useMutation({
    mutationFn: () => refreshFn({ data: { appId } }),
    onSuccess: (r) => {
      toast.success(r.read > 0 ? "Updated." : "Already up to date: each reel is read once a day.");
      reload();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });

  if (metrics.connected && !metrics.rejected && !changing)
    return (
      <div className="text-xs text-muted-foreground space-y-1.5">
        <p>
          Numbers from Upload-Post, read every {METRICS_EVERY_HOURS} hours, each reel about once a
          day. Not every network gives every number: how much is watched and new followers come
          mostly from TikTok.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setChanging(true)}
          >
            Change the key (…{metrics.last4})
          </Button>
        </div>
      </div>
    );

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">
          {metrics.rejected ? "Upload-Post turned the key down" : "See how each reel is doing"}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {metrics.rejected
          ? "Paste the key again, as it is now on Upload-Post's website (API Keys)."
          : "Views, likes, shares, how much people watch and new followers, on each network. Paste your Upload-Post API key once (on Upload-Post's website, API Keys): only the console's server keeps it, and it costs nothing extra."}
      </p>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          connect.mutate();
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Upload-Post API key"
          className="h-8 text-sm"
        />
        <Button size="sm" className="h-8" disabled={!key.trim() || connect.isPending}>
          {connect.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Connect
        </Button>
      </form>
      {metrics.connected && (
        <div className="flex gap-1.5">
          {changing && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setChanging(false)}
            >
              Keep the current key
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
          >
            Remove the key
          </Button>
        </div>
      )}
    </div>
  );
}

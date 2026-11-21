import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ExternalLink, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getScheduledReels } from "@/lib/videos.functions";
import { networkName, postTimeLabel } from "@/lib/scheduled-reels";
import { cn } from "@/lib/utils";

// A web game's reels, in a side bar on the Videos page (scheduled-reels.ts): the ones its Build
// chat scheduled at Upload-Post that are still to come out, the ones already out, and the shorts
// it made that aren't scheduled yet. Read from the files the game keeps in its repo.

type Tab = "pending" | "published";

export function ScheduledReels({ appId, appName }: { appId: string; appName: string }) {
  const getFn = useServerFn(getScheduledReels);
  const q = useQuery({
    queryKey: ["scheduled-reels", appId],
    queryFn: () => getFn({ data: { appId } }),
    refetchInterval: 120_000,
  });
  const [tab, setTab] = useState<Tab>("pending");
  const data = q.data;
  if (data && !data.hasRepo) return null;

  const pendingCount = data?.hasRepo ? data.upcoming.length + data.unscheduled.length : 0;
  const publishedCount = data?.hasRepo ? data.past.length : 0;

  return (
    <aside className="rounded-xl border border-border bg-background flex flex-col min-h-0 max-h-[640px] lg:max-h-[calc(100dvh-2rem)] lg:w-80 xl:w-96 shrink-0 lg:sticky lg:top-4">
      <div className="px-4 pt-4 pb-3 space-y-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <h2 className="font-display font-semibold">Reels</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {appName}'s reels at Upload-Post
          {data?.hasRepo && data.profile ? ` (profile ${data.profile})` : ""}: the ones still to
          come out and the ones already out. A change made on Upload-Post's website doesn't show
          here.
        </p>
        {data?.hasRepo && (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
            <TabButton active={tab === "pending"} onClick={() => setTab("pending")}>
              Pending ({pendingCount})
            </TabButton>
            <TabButton active={tab === "published"} onClick={() => setTab("published")}>
              Published ({publishedCount})
            </TabButton>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-2">
        {q.isLoading || !data ? (
          q.error ? (
            <p className="text-sm text-destructive">{(q.error as Error).message}</p>
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )
        ) : !data.hasRepo ? null : tab === "pending" ? (
          <>
            {data.upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {data.hasLog
                  ? "Nothing scheduled from now on."
                  : `Nothing scheduled yet. When ${appName}'s Build chat schedules reels at Upload-Post, they show here, as long as it keeps them in tools/shorts/published.json like Eden to Heaven does. If it schedules them some other way, ask it in the chat to keep that file.`}
              </p>
            ) : (
              data.upcoming.map((post) => (
                <ReelRow
                  key={`${post.id}-${post.at}`}
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
            )}
            {data.unscheduled.length > 0 && (
              <>
                <p className="label-mono pt-3">Made, not scheduled ({data.unscheduled.length})</p>
                {data.unscheduled.map((short) => (
                  <ReelRow
                    key={short.id}
                    title={short.title}
                    detail="Ask the Build chat to schedule it."
                    videoUrl={short.videoUrl}
                    thumbnailUrl={short.thumbnailUrl}
                  />
                ))}
              </>
            )}
          </>
        ) : data.past.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing published yet.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Their time has passed, so Upload-Post has sent them out. If a network turned one down,
              Upload-Post's website says so.
            </p>
            {data.past.map((post) => (
              <ReelRow
                key={`${post.id}-${post.at}`}
                title={post.title}
                detail={`${postTimeLabel(post.at, data.timeZone)}${
                  post.platforms.length > 0
                    ? ` · ${post.platforms.map(networkName).join(", ")}`
                    : ""
                }`}
                videoUrl={post.videoUrl}
                thumbnailUrl={post.thumbnailUrl}
              />
            ))}
          </>
        )}
      </div>
    </aside>
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
        "rounded-md h-8 px-2",
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
  title,
  detail,
  videoUrl,
  thumbnailUrl,
}: {
  title: string;
  detail: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
}) {
  return (
    <Collapsible className="rounded-lg border border-border">
      <div className="flex items-center gap-1 px-2 py-2">
        <CollapsibleTrigger
          disabled={!videoUrl}
          className="flex-1 min-w-0 text-left flex items-center gap-2.5 group"
        >
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

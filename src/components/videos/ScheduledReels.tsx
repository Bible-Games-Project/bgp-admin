import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ExternalLink, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getScheduledReels } from "@/lib/videos.functions";
import { networkName, postTimeLabel, type ScheduledPost } from "@/lib/scheduled-reels";

// The reels a web game has scheduled at Upload-Post, on the Videos page (scheduled-reels.ts):
// what its Build chat scheduled, read from the log it keeps in the game's repo.

export function ScheduledReels({ appId, appName }: { appId: string; appName: string }) {
  const getFn = useServerFn(getScheduledReels);
  const q = useQuery({
    queryKey: ["scheduled-reels", appId],
    queryFn: () => getFn({ data: { appId } }),
    refetchInterval: 120_000,
  });
  const data = q.data;
  if (data && !data.hasRepo) return null;

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Send className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-semibold">Scheduled reels</h2>
          <p className="text-sm text-muted-foreground">
            What {appName}'s Build chat has scheduled at Upload-Post, and when each one comes out.
            {data?.hasRepo && data.profile ? ` Upload-Post profile: ${data.profile}.` : ""} If you
            change a post on Upload-Post's website, the change doesn't show here.
          </p>
        </div>
      </div>

      {q.isLoading || !data ? (
        q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )
      ) : !data.hasRepo ? null : data.upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground border-t border-border pt-3">
          {data.hasLog
            ? "Nothing scheduled from now on."
            : `Nothing scheduled yet. When ${appName}'s Build chat schedules reels at Upload-Post, they show here, as long as it keeps them in tools/shorts/published.json like Eden to Heaven does. If it schedules them some other way, ask it in the chat above to keep that file.`}
        </p>
      ) : (
        <div className="border-t border-border pt-3 space-y-2">
          {data.upcoming.map((post) => (
            <PostRow key={`${post.id}-${post.at}`} post={post} timeZone={data.timeZone} />
          ))}
        </div>
      )}

      {data?.hasRepo && data.past.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground group">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
            Their time has passed ({data.past.length}, last two weeks)
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-2 opacity-75">
            {data.past.map((post) => (
              <PostRow key={`${post.id}-${post.at}`} post={post} timeZone={data.timeZone} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function PostRow({ post, timeZone }: { post: ScheduledPost; timeZone: string }) {
  return (
    <Collapsible className="rounded-lg border border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="flex-1 min-w-0 text-left flex items-center gap-3 group">
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
          {post.thumbnailUrl && (
            <img
              src={post.thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-12 w-7 shrink-0 rounded object-cover bg-muted"
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
          )}
          <span className="min-w-0">
            <span className="block text-sm font-medium truncate">{post.title}</span>
            <span className="block text-xs text-muted-foreground">
              {postTimeLabel(post.at, timeZone)}
              {post.platforms.length > 0 && ` · ${post.platforms.map(networkName).join(", ")}`}
            </span>
          </span>
        </CollapsibleTrigger>
        {post.videoUrl && (
          <Button
            asChild
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            title="Open the video"
          >
            <a href={post.videoUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>
      {post.videoUrl && (
        <CollapsibleContent className="px-3 pb-3">
          <video
            src={post.videoUrl}
            controls
            playsInline
            preload="none"
            poster={post.thumbnailUrl ?? undefined}
            className="max-h-96 rounded-md bg-black"
          />
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

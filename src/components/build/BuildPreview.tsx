import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ExternalLink,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { PreviewDeployState } from "@/lib/agent";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type PreviewDeploy = (PreviewDeployState & { error?: string }) | { state: "stalled" } | null;

function DeployStatus({
  deploy,
  onAskFix,
  canAsk,
}: {
  deploy: PreviewDeploy;
  onAskFix: () => void;
  canAsk: boolean;
}) {
  if (!deploy) return null;
  switch (deploy.state) {
    case "waiting":
    case "building":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Updating the preview…
          {deploy.state === "building" && (
            <a
              href={deploy.runUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              watch
            </a>
          )}
        </span>
      );
    case "live":
      return <span className="text-xs text-emerald-600 dark:text-emerald-400">Up to date</span>;
    case "stalled":
      return (
        <span className="text-xs text-muted-foreground">
          GitHub didn't start a preview build for the last change.
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-2 text-xs text-destructive flex-wrap">
          <span className="inline-flex items-center gap-1">
            <TriangleAlert className="h-3.5 w-3.5" />
            The last change didn't build, so the preview is older
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5"
            onClick={onAskFix}
            disabled={!canAsk}
          >
            <Sparkles className="h-3.5 w-3.5" /> Ask Claude to fix it
          </Button>
          <a
            href={deploy.runUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            details
          </a>
        </span>
      );
  }
}

export function BuildPreview({
  appId,
  previewUrl,
  checking,
  src,
  deploy,
  onReload,
  onAskFix,
  canAsk,
}: {
  appId: string;
  previewUrl: string | null;
  checking: boolean;
  src: string | null;
  deploy: PreviewDeploy;
  onReload: () => void;
  onAskFix: () => void;
  canAsk: boolean;
}) {
  // Most games are phone games, so they open the way players see them.
  const [device, setDevice] = useState<"phone" | "desktop">("phone");

  if (!previewUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        {checking ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <p className="font-medium">This game has no Cloudflare preview yet.</p>
            <p className="text-muted-foreground max-w-sm">
              Claude can still change it, but there's nothing to look at until the preview is on.
              It's one step in Setup (Preview Deploy).
            </p>
            <Button asChild size="sm" variant="outline">
              <Link to="/apps/$id" params={{ id: appId }} search={{ tab: "setup" }}>
                Open Setup
              </Link>
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 flex-wrap">
        <ToggleGroup
          type="single"
          size="sm"
          value={device}
          onValueChange={(v) => v && setDevice(v as "phone" | "desktop")}
          className="hidden sm:flex"
        >
          <ToggleGroupItem value="phone" aria-label="Phone size" title="Phone size">
            <Smartphone className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="desktop" aria-label="Full width" title="Full width">
            <Monitor className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex-1 min-w-0">
          <DeployStatus deploy={deploy} onAskFix={onAskFix} canAsk={canAsk} />
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onReload}
          title="Reload the preview"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button asChild size="icon" variant="ghost" className="h-8 w-8" title="Open in a new tab">
          <a href={previewUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </div>
      <div
        className={cn(
          "flex-1 min-h-0",
          device === "phone" && "sm:flex sm:items-center sm:justify-center sm:bg-muted/40 sm:p-4",
        )}
      >
        <div
          className={cn(
            "h-full w-full",
            device === "phone" &&
              "sm:h-full sm:max-h-[860px] sm:w-auto sm:max-w-full sm:aspect-[390/844] sm:rounded-[2rem] sm:border-[10px] sm:border-foreground/85 sm:overflow-hidden sm:shadow-xl",
          )}
        >
          {src && (
            <iframe
              key={src}
              src={src}
              title="Game preview"
              className="h-full w-full bg-background"
              allow="autoplay; fullscreen; gamepad; accelerometer; gyroscope"
            />
          )}
        </div>
      </div>
    </div>
  );
}

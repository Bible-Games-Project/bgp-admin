import { useState } from "react";
import {
  ExternalLink,
  Loader2,
  Monitor,
  Power,
  RefreshCw,
  Smartphone,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { PreviewDeployState } from "@/lib/agent";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type PreviewDeploy =
  | (PreviewDeployState & { error?: string; cloudflare?: boolean })
  | { state: "stalled" }
  | null;

function DeployStatus({
  deploy,
  onAskFix,
  canAsk,
  onRetry,
  retrying,
}: {
  deploy: PreviewDeploy;
  onAskFix: () => void;
  canAsk: boolean;
  onRetry: () => void;
  retrying: boolean;
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
      // Cloudflare failed to publish a game that built: the same build again is the cure.
      if (deploy.cloudflare) {
        return (
          <span className="inline-flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <TriangleAlert className="h-3.5 w-3.5" />
              Cloudflare couldn't publish the last change. The game is fine.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              onClick={onRetry}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Try again
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

/** Instead of the game while it can't be shown yet. */
function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      {children}
    </div>
  );
}

export function BuildPreview({
  previewUrl,
  checking,
  turnedOff,
  onTurnOn,
  turningOn,
  firstBuild,
  src,
  deploy,
  onReload,
  onAskFix,
  canAsk,
  onRetry,
  retrying,
}: {
  previewUrl: string | null;
  checking: boolean;
  /** The preview was switched off in Setup ("previews somewhere else"). */
  turnedOff: boolean;
  onTurnOn: () => void;
  turningOn: boolean;
  /** The preview was just turned on and its site doesn't exist until this build is live. */
  firstBuild: boolean;
  src: string | null;
  deploy: PreviewDeploy;
  onReload: () => void;
  onAskFix: () => void;
  canAsk: boolean;
  /** Runs the failed preview build again, when Cloudflare is what failed. */
  onRetry: () => void;
  retrying: boolean;
}) {
  // Most games are phone games, so they open the way players see them.
  const [device, setDevice] = useState<"phone" | "desktop">("phone");

  if (!previewUrl) {
    if (checking) {
      return (
        <Placeholder>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </Placeholder>
      );
    }
    return (
      <Placeholder>
        <p className="font-medium">
          {turnedOff ? "The preview is turned off for this game." : "This game has no preview yet."}
        </p>
        <p className="text-muted-foreground max-w-sm">
          {turnedOff
            ? "It was set to preview somewhere else (Lovable, Vercel…). Turn it on to see the game here, next to the chat."
            : "Turning it on adds a workflow to the game's repo that builds the game after every change and shows it here."}{" "}
          The first build takes a couple of minutes. Claude can change the game meanwhile.
        </p>
        <Button size="sm" className="gap-1.5" onClick={onTurnOn} disabled={turningOn}>
          {turningOn ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Power className="h-3.5 w-3.5" />
          )}
          Turn on the preview
        </Button>
      </Placeholder>
    );
  }

  // Until the first build is live the address leads nowhere, so the frame waits.
  const waitingForFirstBuild = firstBuild && deploy?.state !== "live";

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
          <DeployStatus
            deploy={deploy}
            onAskFix={onAskFix}
            canAsk={canAsk}
            onRetry={onRetry}
            retrying={retrying}
          />
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
      {waitingForFirstBuild ? (
        <div className="flex-1 min-h-0">
          <Placeholder>
            {deploy?.state === "failed" && deploy.cloudflare ? (
              <p className="max-w-sm">
                The game built, but Cloudflare couldn't publish its first preview. Press "Try again"
                above in a few minutes.
              </p>
            ) : deploy?.state === "failed" ? (
              <p className="max-w-sm">
                The game's first preview didn't build. Claude can find out why: press "Ask Claude to
                fix it" above.
              </p>
            ) : deploy?.state === "stalled" ? (
              <p className="text-muted-foreground max-w-sm">
                GitHub didn't start the game's first preview build. Its Actions may be turned off in
                the repo's settings on GitHub.
              </p>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <p className="text-muted-foreground max-w-sm">
                  Building the game's first preview. It shows here in a couple of minutes.
                </p>
              </>
            )}
          </Placeholder>
        </div>
      ) : (
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
      )}
    </div>
  );
}

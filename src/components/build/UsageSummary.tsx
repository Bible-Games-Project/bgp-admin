import { formatDistanceToNowStrict } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";
import type { AgentUsage } from "@/lib/agent";
import { Button } from "@/components/ui/button";

// How much of the Claude account's limits is used, as Claude last reported it to the build
// server: at every call of a Build chat message, and in the tiny call the server makes when
// a page asks for a fresh reading (older than a quarter of an hour, or Refresh). It says
// when the reading is from, since anything else using the account moves it meanwhile.

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });

function UsageBar({
  label,
  window,
}: {
  label: string;
  window?: { percent: number; resetsAt: string | null };
}) {
  if (!window) return null;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          {Math.round(window.percent)}% used
          {window.resetsAt ? ` · resets ${ago(window.resetsAt)}` : ""}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${window.percent >= 90 ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${Math.min(100, window.percent)}%` }}
        />
      </div>
    </div>
  );
}

export function UsageSummary({
  usage,
  refreshing,
  onRefresh,
}: {
  usage: AgentUsage | null;
  /** The build server has been asked for a fresh reading. */
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const reported = Boolean(usage?.fiveHour || usage?.weekly);
  return (
    <div className="space-y-2">
      {reported && (
        <>
          <UsageBar label="5-hour limit" window={usage?.fiveHour} />
          <UsageBar label="Weekly limit" window={usage?.weekly} />
        </>
      )}
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {refreshing && <Loader2 className="h-3 w-3 animate-spin" />}
          {refreshing
            ? "Asking Claude for the current usage…"
            : !reported
              ? "Claude hasn't reported the account's usage yet."
              : usage?.at
                ? `As Claude reported it ${ago(usage.at)}; what you use elsewhere with this account isn't counted until the next reading.`
                : "As Claude last reported it."}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 shrink-0"
          onClick={onRefresh}
          disabled={refreshing}
          title="Ask Claude for the current usage (one tiny call)"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
    </div>
  );
}

import { formatDistanceToNowStrict } from "date-fns";
import type { AgentUsage } from "@/lib/agent";

// How much of the Claude account's limits is used, as the build server last heard from
// Claude (a rate-limit notice in each session). The windows only show once Claude reports them.

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

export function UsageSummary({ usage }: { usage: AgentUsage | null }) {
  if (!usage?.fiveHour && !usage?.weekly) return null;
  return (
    <div className="space-y-2">
      <UsageBar label="5-hour limit" window={usage.fiveHour} />
      <UsageBar label="Weekly limit" window={usage.weekly} />
    </div>
  );
}

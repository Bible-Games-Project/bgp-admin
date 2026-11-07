import { formatDistanceToNowStrict } from "date-fns";
import { GitBranch, GitMerge, Loader2, Sparkles } from "lucide-react";
import type { StrayBranch } from "@/lib/agent";
import { Button } from "@/components/ui/button";

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });

/**
 * Work on a claude/ branch that the game's main branch doesn't have: the preview and the
 * chat start from main, so without this it would look lost. One row per branch, with the
 * way to bring it over beside it.
 */
export function BranchNotice({
  branches,
  defaultBranch,
  bringing,
  conflicts,
  claudeWorking,
  canAsk,
  onBring,
  onAskClaude,
}: {
  branches: StrayBranch[];
  defaultBranch: string;
  /** The branch being merged right now. */
  bringing: string | null;
  /** Branches GitHub couldn't merge on its own. */
  conflicts: string[];
  claudeWorking: boolean;
  canAsk: boolean;
  onBring: (branch: StrayBranch) => void;
  onAskClaude: (branch: StrayBranch) => void;
}) {
  if (!branches.length) return null;
  return (
    <div className="border-b border-amber-500/40 bg-amber-500/5 px-3 py-2 space-y-2 text-sm">
      {branches.map((b) => {
        const conflict = conflicts.includes(b.name);
        return (
          // On a phone the button goes under the text, which needs the width.
          <div key={b.name} className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="flex flex-1 min-w-0 items-start gap-2">
              <GitBranch className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="font-medium">
                  {b.ahead === 1 ? "1 change isn't" : `${b.ahead} changes aren't`} in the preview
                  yet
                </p>
                <p className="text-xs text-muted-foreground break-words">
                  {b.ahead === 1 ? "It's" : "They're"} on the branch{" "}
                  <code className="font-mono">{b.name}</code>, not on {defaultBranch}
                  {b.lastCommitAt && <>, the last one {ago(b.lastCommitAt)}</>}
                  {b.lastMessage && <> ("{b.lastMessage}")</>}. The preview and Claude here start
                  from {defaultBranch}. This happens when the game is changed in Claude Code on the
                  web.{" "}
                  {b.url && (
                    <a
                      href={b.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      See the changes
                    </a>
                  )}
                </p>
                {conflict && (
                  <p className="text-xs">
                    GitHub can't join them on its own because both sides changed the same lines.
                    Claude can do it.
                  </p>
                )}
              </div>
            </div>
            {conflict ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 shrink-0 self-start ml-6 sm:ml-0"
                disabled={!canAsk}
                onClick={() => onAskClaude(b)}
              >
                <Sparkles className="h-3.5 w-3.5" /> Ask Claude to join them
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 shrink-0 self-start ml-6 sm:ml-0"
                disabled={Boolean(bringing) || claudeWorking}
                title={claudeWorking ? "Claude is working on this game" : undefined}
                onClick={() => onBring(b)}
              >
                {bringing === b.name ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <GitMerge className="h-3.5 w-3.5" />
                )}
                Bring {b.ahead === 1 ? "it" : "them"} to {defaultBranch}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

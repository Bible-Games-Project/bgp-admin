import { type ReactNode, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Copy,
  ExternalLink,
  HelpCircle,
  Loader2,
  RotateCcw,
  UserRound,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type FailedJob, type FailureVerdict, aiChatPrompt } from "@/lib/deploy-failure";
import { getRunFailure } from "@/lib/deploy.functions";

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied. Paste it into an AI chat."),
    () => toast.error("Couldn't copy. Select the error and copy it by hand."),
  );
}

function headline(v: FailureVerdict): { icon: ReactNode; text: string } {
  switch (v.owner) {
    case "you":
      return {
        icon: <UserRound className="h-4 w-4 text-warning shrink-0" />,
        text:
          v.where === "the console"
            ? "Yours to fix, here in the console"
            : `Yours to fix, in ${v.where ?? "the store"}`,
      };
    case "developer":
      return {
        icon: <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />,
        text: "For the developer: nothing to do in the stores",
      };
    case "retry":
      return {
        icon: <RotateCcw className="h-4 w-4 text-muted-foreground shrink-0" />,
        text: "Probably temporary: deploy again",
      };
    default:
      return {
        icon: <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" />,
        text: "Not recognised: ask an AI chat",
      };
  }
}

function JobFailure({ job }: { job: FailedJob }) {
  const { icon, text } = headline(job.verdict);
  // The error is at the end of the log: open the box scrolled down to it.
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job.error]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {text}
      </div>
      <p className="text-sm">{job.verdict.summary}</p>
      <p className="text-sm text-muted-foreground">{job.verdict.todo}</p>
      <div className="text-xs text-muted-foreground font-mono break-words">
        Failed at: {job.job}
        {job.step ? ` → ${job.step}` : ""}
      </div>
      {job.error ? (
        <pre
          ref={logRef}
          className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap break-words"
        >
          {job.error}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">
          GitHub didn&apos;t hand over this job&apos;s log. Open the run on GitHub to read it.
        </p>
      )}
    </div>
  );
}

/**
 * Why a deploy run failed, with who has to fix it and the error ready to paste into an
 * AI chat. Shown on Home and in the Deploy tab's recent runs.
 */
export function RunFailure({
  appId,
  runId,
  runUrl,
  game,
}: {
  appId: string;
  runId: number;
  runUrl: string;
  game: string;
}) {
  const failureFn = useServerFn(getRunFailure);
  const q = useQuery({
    queryKey: ["run-failure", appId, runId],
    queryFn: () => failureFn({ data: { appId, runId } }),
    // A finished run never changes.
    staleTime: Infinity,
    retry: 1,
  });

  const openRun = (
    <Button asChild size="sm" variant="outline">
      <a href={runUrl} target="_blank" rel="noreferrer">
        Open the run on GitHub <ExternalLink />
      </a>
    </Button>
  );

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the run&apos;s log…
      </div>
    );
  }
  if (q.error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          The console couldn&apos;t read this run&apos;s log: {(q.error as Error).message}
        </p>
        {openRun}
      </div>
    );
  }

  const jobs = q.data?.jobs ?? [];
  if (!jobs.length) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          GitHub couldn&apos;t start this run, so there is no log. That&apos;s for the developer:
          send them the link to the run.
        </p>
        {openRun}
      </div>
    );
  }

  const prompt = jobs
    .map((j) => aiChatPrompt({ game, job: j.job, step: j.step, error: j.error }))
    .join("\n\n---\n\n");
  return (
    <div className="space-y-4">
      {jobs.map((j) => (
        <JobFailure key={j.job} job={j} />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => copy(prompt)}>
          <Copy /> Copy for an AI chat
        </Button>
        {openRun}
      </div>
    </div>
  );
}

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Rocket, Loader2, ExternalLink, RefreshCw, GitBranch } from "lucide-react";
import {
  isCurrentUserAdmin,
  listWorkflowRuns,
  triggerDeploy,
  workflowMeta,
} from "@/lib/deploy.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function StatusDot({ status, conclusion }: { status: string; conclusion: string | null }) {
  let color = "bg-muted-foreground";
  let label = status;
  if (status === "completed") {
    if (conclusion === "success") {
      color = "bg-[oklch(0.68_0.14_145)]";
      label = "success";
    } else if (conclusion === "failure") {
      color = "bg-destructive";
      label = "failure";
    } else if (conclusion === "cancelled") {
      color = "bg-muted-foreground";
      label = "cancelled";
    } else {
      label = conclusion ?? "completed";
    }
  } else if (status === "in_progress" || status === "queued") {
    color = "bg-primary animate-pulse";
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      <span className="text-xs text-muted-foreground font-mono">{label}</span>
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function DashboardPage() {
  const meta = workflowMeta();
  const qc = useQueryClient();
  const adminFn = useServerFn(isCurrentUserAdmin);
  const runsFn = useServerFn(listWorkflowRuns);
  const deployFn = useServerFn(triggerDeploy);
  const [ref, setRef] = useState(meta.defaultRef);

  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => adminFn() });
  const runsQ = useQuery({
    queryKey: ["runs"],
    queryFn: () => runsFn(),
    enabled: adminQ.data?.isAdmin === true,
    refetchInterval: 8000,
  });

  const deployM = useMutation({
    mutationFn: () => deployFn({ data: { ref } }),
    onSuccess: () => {
      toast.success(`Dispatched ${meta.file} on ${ref}`);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["runs"] }), 1500);
    },
    onError: (e: any) => toast.error(e.message ?? "Deploy failed"),
  });

  if (adminQ.isLoading) {
    return (
      <div className="p-8 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (!adminQ.data?.isAdmin) {
    return (
      <div className="p-8 max-w-md">
        <h1 className="text-xl font-display font-semibold">Access denied</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your account is signed in but not authorized to use this console.
          Ask an admin to add your user to the allow list.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto w-full">
      <div className="mb-8">
        <span className="label-mono">workflow</span>
        <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">
          {meta.file}
        </h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          {meta.owner}/{meta.repo}
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="label-mono mb-1">trigger</div>
            <p className="text-sm text-foreground">
              Dispatch <span className="font-mono text-primary">{meta.file}</span> via workflow_dispatch
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 h-9">
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="bg-transparent text-sm font-mono w-24 outline-none"
                placeholder="main"
              />
            </div>
            <Button
              onClick={() => deployM.mutate()}
              disabled={deployM.isPending || !ref.trim()}
              className="gap-2"
            >
              {deployM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              Deploy
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <span className="label-mono">recent runs</span>
          <button
            onClick={() => runsQ.refetch()}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${runsQ.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>

        {runsQ.data?.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive font-mono">
            {runsQ.data.error}
          </div>
        )}

        <div className="rounded-md border border-border bg-card divide-y divide-border">
          {runsQ.isLoading && (
            <div className="p-4 text-xs text-muted-foreground">Loading…</div>
          )}
          {runsQ.data?.runs.length === 0 && !runsQ.isLoading && (
            <div className="p-4 text-xs text-muted-foreground">No runs yet.</div>
          )}
          {runsQ.data?.runs.map((r) => (
            <a
              key={r.id}
              href={r.html_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition-colors group"
            >
              <div className="flex items-center gap-4 min-w-0">
                <span className="text-xs text-muted-foreground font-mono w-12 shrink-0">
                  #{r.run_number}
                </span>
                <StatusDot status={r.status} conclusion={r.conclusion} />
                <span className="text-xs text-muted-foreground font-mono truncate hidden sm:inline">
                  {r.event} · {r.head_branch} · {r.actor}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-muted-foreground font-mono">
                  {formatTime(r.created_at)}
                </span>
                <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

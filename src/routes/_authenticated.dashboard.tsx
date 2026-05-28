import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Rocket, Loader2, ExternalLink, RefreshCw, GitBranch, Apple, Smartphone } from "lucide-react";
import {
  isCurrentUserAdmin,
  listWorkflowRuns,
  triggerDeploy,
  workflowMeta,
} from "@/lib/deploy.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type Platform = "ios" | "android";

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

function PlatformBadge({ platform }: { platform: Platform }) {
  const Icon = platform === "ios" ? Apple : Smartphone;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
      <Icon className="h-2.5 w-2.5" />
      {platform}
    </span>
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

function DeployPanel({ defaultRef }: { defaultRef: string }) {
  const qc = useQueryClient();
  const deployFn = useServerFn(triggerDeploy);
  const [ref, setRef] = useState(defaultRef);
  const [ios, setIos] = useState(true);
  const [android, setAndroid] = useState(true);

  const deployM = useMutation({
    mutationFn: async () => {
      const platforms: Platform[] = [];
      if (ios) platforms.push("ios");
      if (android) platforms.push("android");
      const results = await Promise.allSettled(
        platforms.map((p) => deployFn({ data: { platform: p, ref } })),
      );
      return { platforms, results };
    },
    onSuccess: ({ platforms, results }) => {
      results.forEach((r, i) => {
        const p = platforms[i];
        if (r.status === "fulfilled") {
          toast.success(`Dispatched ${p} on ${ref}`);
        } else {
          toast.error(`${p}: ${(r.reason as Error)?.message ?? "failed"}`);
        }
      });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["runs"] }), 1500);
    },
  });

  const noneSelected = !ios && !android;

  return (
    <section className="mb-10">
      <div className="mb-3">
        <span className="label-mono">deploy</span>
      </div>

      <div className="rounded-md border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Checkbox checked={ios} onCheckedChange={(v) => setIos(v === true)} />
            <Apple className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">iOS</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Checkbox checked={android} onCheckedChange={(v) => setAndroid(v === true)} />
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Android</span>
          </label>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 h-9">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              className="bg-transparent text-sm font-mono w-32 outline-none"
              placeholder="main"
            />
          </div>
          <Button
            onClick={() => deployM.mutate()}
            disabled={deployM.isPending || !ref.trim() || noneSelected}
            className="gap-2"
          >
            {deployM.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            Deploy
          </Button>
          {noneSelected && (
            <span className="text-xs text-muted-foreground font-mono">
              select at least one platform
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

type Run = {
  id: number;
  status: string;
  conclusion: string | null;
  event: string;
  actor: string | null;
  head_branch: string;
  created_at: string;
  html_url: string;
  run_number: number;
};

function CombinedHistory() {
  const runsFn = useServerFn(listWorkflowRuns);
  const queries = useQueries({
    queries: (["ios", "android"] as Platform[]).map((p) => ({
      queryKey: ["runs", p],
      queryFn: () => runsFn({ data: { platform: p } }),
      refetchInterval: 8000,
    })),
  });

  const [iosQ, androidQ] = queries;
  const isFetching = queries.some((q) => q.isFetching);
  const isLoading = queries.some((q) => q.isLoading);
  const errors = queries
    .map((q, i) => (q.data?.error ? `${i === 0 ? "ios" : "android"}: ${q.data.error}` : null))
    .filter(Boolean) as string[];

  const merged: Array<Run & { platform: Platform }> = [
    ...((iosQ.data?.runs ?? []) as Run[]).map((r) => ({ ...r, platform: "ios" as const })),
    ...((androidQ.data?.runs ?? []) as Run[]).map((r) => ({ ...r, platform: "android" as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <span className="label-mono">recent runs</span>
        <button
          onClick={() => queries.forEach((q) => q.refetch())}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {errors.map((e) => (
        <div
          key={e}
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive font-mono mb-2"
        >
          {e}
        </div>
      ))}

      <div className="rounded-md border border-border bg-card divide-y divide-border">
        {isLoading && <div className="p-4 text-xs text-muted-foreground">Loading…</div>}
        {!isLoading && merged.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">No runs yet.</div>
        )}
        {merged.map((r) => (
          <a
            key={`${r.platform}-${r.id}`}
            href={r.html_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <PlatformBadge platform={r.platform} />
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
    </section>
  );
}

function DashboardPage() {
  const meta = workflowMeta();
  const adminFn = useServerFn(isCurrentUserAdmin);
  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => adminFn() });

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
        <span className="label-mono">project</span>
        <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">
          {meta.repo}
        </h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          {meta.owner}/{meta.repo}
        </p>
      </div>

      <DeployPanel defaultRef={meta.defaultRef} />
      <CombinedHistory />
    </div>
  );
}

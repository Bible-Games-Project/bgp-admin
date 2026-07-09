import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Rocket,
  Loader2,
  ExternalLink,
  RefreshCw,
  GitBranch,
  Boxes,
} from "lucide-react";
import {
  isCurrentUserAdmin,
  listRepoRuns,
  triggerDeploy,
  getRepoMarketingVersion,
  getCommitsAheadOfLatestTag,
} from "@/lib/deploy.functions";
import { listApps } from "@/lib/apps.functions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

function DeployPanel({ 
  appId, 
  defaultRef, 
  currentVersion,
  githubOwner,
  githubRepo 
}: { 
  appId: string; 
  defaultRef: string; 
  currentVersion: string | null;
  githubOwner: string;
  githubRepo: string;
}) {
  const qc = useQueryClient();
  const deployFn = useServerFn(triggerDeploy);
  const fetchRepoVersion = useServerFn(getRepoMarketingVersion);
  const [ref, setRef] = useState(defaultRef);
  const parseVersion = (v: string | null | undefined): [string, string] => {
    if (!v) return ["0", "0"];
    const parts = v.split(".");
    return [parts[0] ?? "0", parts[1] ?? "0"];
  };
  const [initMajor, initMinor] = parseVersion(currentVersion);
  const [major, setMajor] = useState(initMajor);
  const [minor, setMinor] = useState(initMinor);
  const marketingVersion = `${major || "0"}.${minor || "0"}`;
  const [deployIos, setDeployIos] = useState(true);
  const [deployAndroid, setDeployAndroid] = useState(true);

  useEffect(() => setRef(defaultRef), [defaultRef]);

  const { data: repoVersionData } = useQuery({
    queryKey: ["repoVersion", appId, ref],
    queryFn: () => fetchRepoVersion({ data: { appId, ref } }),
    enabled: !!appId && !!ref,
    staleTime: 60_000,
  });
  const repoVersion = repoVersionData?.version ?? null;

  const fetchCommitsAhead = useServerFn(getCommitsAheadOfLatestTag);
  const { data: aheadData, isFetching: aheadFetching, refetch: refetchAhead } = useQuery({
    queryKey: ["commitsAhead", appId, ref],
    queryFn: () => fetchCommitsAhead({ data: { appId, ref } }),
    enabled: !!appId && !!ref,
    staleTime: 60_000,
  });

  useEffect(() => {
    const [maj, min] = parseVersion(currentVersion || repoVersion);
    setMajor(maj);
    setMinor(min);
  }, [currentVersion, repoVersion]);

  const deployM = useMutation({
    mutationFn: () => {
      const platforms = [];
      if (deployIos) platforms.push("iOS");
      if (deployAndroid) platforms.push("Android");
      return deployFn({ 
        data: { 
          appId, 
          workflowFile: "deploy.yml", 
          ref,
          inputs: {
            deploy_ios: deployIos,
            deploy_android: deployAndroid,
            marketing_version: marketingVersion.trim() || undefined,
          }
        } 
      });
    },
    onSuccess: () => {
      const platforms = [];
      if (deployIos) platforms.push("iOS");
      if (deployAndroid) platforms.push("Android");
      const versionStr = marketingVersion.trim() ? ` v${marketingVersion}` : "";
      toast.success(`Deploying ${platforms.join(" + ")}${versionStr} on ${ref}`);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["runs", appId] }), 1500);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="mb-10">
      <div className="mb-3">
        <span className="label-mono">deploy</span>
      </div>

      <div className="rounded-md border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deployIos}
                onChange={(e) => setDeployIos(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm font-medium">iOS</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deployAndroid}
                onChange={(e) => setDeployAndroid(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm font-medium">Android</span>
            </label>
          </div>

          {aheadData?.tag ? (
            <a
              href={aheadData.compareUrl ?? `https://github.com/${githubOwner}/${githubRepo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
              title={`Compare ${aheadData.tag}...${ref}`}
            >
              <RefreshCw className={`h-3 w-3 ${aheadFetching ? "animate-spin" : ""}`} onClick={(e) => { e.preventDefault(); refetchAhead(); }} />
              {aheadData.ahead === 0 ? (
                <span>up to date with <span className="text-foreground">{aheadData.tag}</span></span>
              ) : (
                <span>
                  <span className="text-foreground font-semibold">{aheadData.ahead}</span> commit{aheadData.ahead === 1 ? "" : "s"} ahead of <span className="text-foreground">{aheadData.tag}</span>
                </span>
              )}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : aheadData && !aheadData.tag ? (
            <span className="text-xs font-mono text-muted-foreground">no tags yet</span>
          ) : null}
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

          <div className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 h-9" title="Marketing version: Major.Minor. The build number is appended automatically by CI (GITHUB_RUN_NUMBER).">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Major</span>
            <input
              value={major}
              onChange={(e) => setMajor(e.target.value.replace(/\D/g, ""))}
              className="bg-transparent text-sm font-mono w-8 outline-none text-center"
              placeholder="0"
              inputMode="numeric"
            />
            <span className="text-muted-foreground">.</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mx-1">Minor</span>
            <input
              value={minor}
              onChange={(e) => setMinor(e.target.value.replace(/\D/g, ""))}
              className="bg-transparent text-sm font-mono w-8 outline-none text-center"
              placeholder="0"
              inputMode="numeric"
            />
            <span className="text-muted-foreground">.</span>
            <span className="text-xs font-mono text-muted-foreground italic" title="Auto-incremented by CI on every deploy">auto</span>
          </div>

          <Button
            onClick={() => deployM.mutate()}
            disabled={deployM.isPending || !ref.trim() || (!deployIos && !deployAndroid)}
            className="gap-2"
          >
            {deployM.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            Publicar
          </Button>
        </div>
      </div>
    </section>
  );
}

function RunsHistory({ appId }: { appId: string }) {
  const runsFn = useServerFn(listRepoRuns);
  const q = useQuery({
    queryKey: ["runs", appId],
    queryFn: () => runsFn({ data: { appId } }),
    refetchInterval: 8000,
  });

  const runs = q.data?.runs ?? [];

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <span className="label-mono">recent runs</span>
        <button
          onClick={() => q.refetch()}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {q.data?.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive font-mono mb-2">
          {q.data.error}
        </div>
      )}

      <div className="rounded-md border border-border bg-card divide-y divide-border">
        {q.isLoading && <div className="p-4 text-xs text-muted-foreground">Loading…</div>}
        {!q.isLoading && runs.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">No runs yet.</div>
        )}
        {runs.map((r: any) => (
          <a
            key={r.id}
            href={r.html_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs text-muted-foreground font-mono w-12 shrink-0">
                #{r.run_number}
              </span>
              <StatusDot status={r.status} conclusion={r.conclusion} />
              <span className="text-xs text-muted-foreground font-mono truncate hidden sm:inline">
                {r.workflow_name ?? r.event} · {r.head_branch} · {r.actor}
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
  const adminFn = useServerFn(isCurrentUserAdmin);
  const listFn = useServerFn(listApps);
  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => adminFn() });
  const appsQ = useQuery({
    queryKey: ["apps"],
    queryFn: () => listFn(),
    enabled: !!adminQ.data?.isAdmin,
  });
  // No auto-selection: the user must explicitly pick a project to avoid
  // accidentally deploying the wrong app.
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
          Your account is signed in but not authorized to use this console. Ask an admin to
          add your user to the allow list.
        </p>
      </div>
    );
  }

  const apps = appsQ.data?.apps ?? [];
  const selected = apps.find((a) => a.id === selectedId);

  if (appsQ.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading apps…</div>;
  }

  if (apps.length === 0) {
    return (
      <div className="p-6 md:p-8 max-w-2xl mx-auto w-full">
        <div className="rounded-md border border-border bg-card p-8 text-center">
          <Boxes className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            No apps registered yet. Add one to start deploying.
          </p>
          <Button asChild>
            <Link to="/apps">Go to Apps</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto w-full">
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="label-mono">project</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">
            {selected?.name ?? "—"}
          </h1>
          {selected && (
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {selected.github_owner}/{selected.github_repo}
            </p>
          )}
        </div>
        <div className="min-w-[220px]">
          <Select value={selectedId ?? undefined} onValueChange={setSelectedId}>
            <SelectTrigger>
              <SelectValue placeholder="Select app" />
            </SelectTrigger>
            <SelectContent>
              {apps.map((a) => (
                <SelectItem key={a.id} value={a.id} disabled={!a.is_active}>
                  {a.name} {!a.is_active && "(disabled)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selected && (
        <div className="rounded-md border border-dashed border-border bg-card p-8 text-center">
          <Boxes className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Selecciona un proyecto para ver el panel de deploy.
          </p>
        </div>
      )}

      {selected && (
        <>
          <DeployPanel
            appId={selected.id} 
            defaultRef={selected.default_ref} 
            currentVersion={selected.marketing_version}
            githubOwner={selected.github_owner}
            githubRepo={selected.github_repo}
          />
          <RunsHistory appId={selected.id} />
        </>
      )}
    </div>
  );
}

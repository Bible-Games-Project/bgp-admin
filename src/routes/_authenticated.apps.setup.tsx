import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { listApps } from "@/lib/apps.functions";
import {
  checkCapacitorStatus,
  checkAndroidSigning,
  checkAndroidKeystoreSecrets,
  checkIosSecrets,
  checkDeployWorkflow,
  createDeployWorkflow,
  checkPreviewDeployWorkflow,
  createPreviewDeployWorkflow,
} from "@/lib/capacitor.functions";
import { checkAgentDocs, syncAgentDocs } from "@/lib/agent-docs.functions";
import { SELF_REPO_BLOCKED_STEPS, isSelfRepo, type SelfRepoBlockedStep } from "@/lib/self-repo";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/apps/setup")({
  component: SetupOverviewPage,
});

type StepKey = "capacitor" | "signing" | "keystore" | "ios" | "deploy" | "preview" | "agentDocs";
type BulkStepKey = "deploy" | "preview" | "agentDocs";

type CellState =
  | { kind: "loading" }
  | { kind: "ok" }
  | { kind: "outdated" }
  | { kind: "missing"; detail?: string }
  | { kind: "off" }
  | { kind: "blocked"; reason: string }
  | { kind: "error"; message: string };

type RunStatus = "queued" | "running" | "done" | { error: string };

// Same query keys as the Setup tab, so both views share one cache.
const STEPS: {
  key: StepKey;
  title: string;
  queryKey: string;
  selfBlocked?: SelfRepoBlockedStep;
}[] = [
  { key: "capacitor", title: "Capacitor", queryKey: "capacitor-status", selfBlocked: "capacitor" },
  { key: "signing", title: "Android signing", queryKey: "android-signing" },
  { key: "keystore", title: "Android keystore", queryKey: "android-keystore-secrets" },
  { key: "ios", title: "iOS secrets", queryKey: "ios-secrets" },
  {
    key: "deploy",
    title: "Deploy workflow",
    queryKey: "deploy-workflow",
    selfBlocked: "deploy-workflow",
  },
  {
    key: "preview",
    title: "Preview deploy",
    queryKey: "preview-deploy-workflow",
    selfBlocked: "preview-deploy",
  },
  { key: "agentDocs", title: "Agent docs", queryKey: "agent-docs", selfBlocked: "agent-docs" },
];

const BULK_COPY: Record<BulkStepKey, { title: (n: number) => string; body: string }> = {
  deploy: {
    title: (n) => `Update deploy.yml in ${n} app${n === 1 ? "" : "s"}?`,
    body: "bgp-admin commits the deploy.yml it generates today to the main branch of each app below. This does not start a deploy.",
  },
  preview: {
    title: (n) => `Update preview-deploy.yml in ${n} app${n === 1 ? "" : "s"}?`,
    body: "bgp-admin commits the preview-deploy.yml it generates today to the main branch of each app below. Each commit starts a new preview build of that app on Cloudflare Pages.",
  },
  agentDocs: {
    title: (n) => `Sync CLAUDE.md and AGENTS.md in ${n} app${n === 1 ? "" : "s"}?`,
    body: "bgp-admin commits the current shared templates to the main branch of each app below. Notes an app added outside the managed block are kept.",
  },
};

const STALE_MS = 5 * 60_000;

function SetupOverviewPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listApps);
  const checkCapacitorFn = useServerFn(checkCapacitorStatus);
  const checkSigningFn = useServerFn(checkAndroidSigning);
  const checkKeystoreFn = useServerFn(checkAndroidKeystoreSecrets);
  const checkIosFn = useServerFn(checkIosSecrets);
  const checkDeployFn = useServerFn(checkDeployWorkflow);
  const checkPreviewFn = useServerFn(checkPreviewDeployWorkflow);
  const checkAgentDocsFn = useServerFn(checkAgentDocs);
  const createDeployFn = useServerFn(createDeployWorkflow);
  const createPreviewFn = useServerFn(createPreviewDeployWorkflow);
  const syncAgentDocsFn = useServerFn(syncAgentDocs);

  const appsQ = useQuery({ queryKey: ["apps"], queryFn: () => listFn() });
  const apps = appsQ.data?.apps ?? [];

  const [confirming, setConfirming] = useState<BulkStepKey | null>(null);
  const [run, setRun] = useState<{ step: BulkStepKey; status: Record<string, RunStatus> } | null>(
    null,
  );
  const running = !!run && Object.values(run.status).some((s) => s === "queued" || s === "running");

  const queriesFor = <T,>(
    queryKey: string,
    fn: (args: { data: { appId: string } }) => Promise<T>,
    selfBlocked?: SelfRepoBlockedStep,
  ) =>
    apps.map((a) => ({
      queryKey: [queryKey, a.id],
      queryFn: () => fn({ data: { appId: a.id } }),
      enabled: !(selfBlocked && isSelfRepo(a.github_owner, a.github_repo)),
      staleTime: STALE_MS,
      retry: false,
    }));

  const capacitor = useQueries({
    queries: queriesFor("capacitor-status", checkCapacitorFn, "capacitor"),
  });
  const signing = useQueries({ queries: queriesFor("android-signing", checkSigningFn) });
  const keystore = useQueries({
    queries: queriesFor("android-keystore-secrets", checkKeystoreFn),
  });
  const ios = useQueries({ queries: queriesFor("ios-secrets", checkIosFn) });
  const deploy = useQueries({
    queries: queriesFor("deploy-workflow", checkDeployFn, "deploy-workflow"),
  });
  const preview = useQueries({
    queries: queriesFor("preview-deploy-workflow", checkPreviewFn, "preview-deploy"),
  });
  const agentDocs = useQueries({
    queries: queriesFor("agent-docs", checkAgentDocsFn, "agent-docs"),
  });

  const cellState = (step: (typeof STEPS)[number], i: number): CellState => {
    const app = apps[i];
    if (step.selfBlocked && isSelfRepo(app.github_owner, app.github_repo)) {
      return { kind: "blocked", reason: SELF_REPO_BLOCKED_STEPS[step.selfBlocked] };
    }
    const q = {
      capacitor,
      signing,
      keystore,
      ios,
      deploy,
      preview,
      agentDocs,
    }[step.key][i];
    if (!q || q.isLoading) return { kind: "loading" };
    if (q.error) return { kind: "error", message: (q.error as Error).message };

    switch (step.key) {
      case "capacitor": {
        const d = capacitor[i].data;
        const missing = [
          !d?.hasConfig && "capacitor.config.ts",
          !d?.hasIos && "ios/",
          !d?.hasAndroid && "android/",
        ].filter(Boolean);
        return missing.length
          ? { kind: "missing", detail: `Missing ${missing.join(", ")}` }
          : { kind: "ok" };
      }
      case "signing": {
        const d = signing[i].data;
        if (d?.configured) return { kind: "ok" };
        return { kind: "missing", detail: d?.fileExists ? undefined : "Needs Capacitor first" };
      }
      case "keystore":
        return keystore[i].data?.configured ? { kind: "ok" } : { kind: "missing" };
      case "ios":
        return ios[i].data?.configured ? { kind: "ok" } : { kind: "missing" };
      case "deploy": {
        const d = deploy[i].data;
        if (!d?.exists) return { kind: "missing" };
        return d.outdated ? { kind: "outdated" } : { kind: "ok" };
      }
      case "preview": {
        const d = preview[i].data;
        if (d?.disabled) return { kind: "off" };
        if (!d?.exists) return { kind: "missing" };
        return d.outdated ? { kind: "outdated" } : { kind: "ok" };
      }
      case "agentDocs": {
        const d = agentDocs[i].data;
        if (d?.allInSync) return { kind: "ok" };
        return d?.statuses.some((s) => s.exists) ? { kind: "outdated" } : { kind: "missing" };
      }
    }
  };

  // Bulk updates only replace files that are already there and out of date. Adding a step
  // an app does not have stays a per-app decision (a paid game must never get a public
  // preview by accident), and disabled apps are left alone.
  const bulkTargets = (key: BulkStepKey) => {
    const step = STEPS.find((s) => s.key === key)!;
    return apps.filter((a, i) => a.is_active && cellState(step, i).kind === "outdated");
  };

  const runBulk = async (key: BulkStepKey) => {
    const targets = bulkTargets(key);
    const action = { deploy: createDeployFn, preview: createPreviewFn, agentDocs: syncAgentDocsFn }[
      key
    ];
    const queryKey = STEPS.find((s) => s.key === key)!.queryKey;
    const status: Record<string, RunStatus> = Object.fromEntries(
      targets.map((a) => [a.id, "queued" as RunStatus]),
    );
    setRun({ step: key, status: { ...status } });

    const failures: string[] = [];
    // One app at a time: each update is a commit, and a failure should not stop the rest.
    for (const app of targets) {
      status[app.id] = "running";
      setRun({ step: key, status: { ...status } });
      try {
        await action({ data: { appId: app.id } });
        status[app.id] = "done";
      } catch (e) {
        const message = (e as Error).message;
        status[app.id] = { error: message };
        failures.push(`${app.name}: ${message}`);
      }
      setRun({ step: key, status: { ...status } });
      await qc.invalidateQueries({ queryKey: [queryKey, app.id] });
    }

    const done = targets.length - failures.length;
    if (failures.length) {
      toast.error(`Updated ${done} of ${targets.length} apps. ${failures.join(" · ")}`, {
        duration: 20000,
      });
    } else {
      toast.success(`Updated ${done} app${done === 1 ? "" : "s"}.`);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto w-full">
      <Link
        to="/apps"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Apps
      </Link>
      <div className="mb-6">
        <span className="label-mono">registry</span>
        <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Setup overview</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
          Where every app stands on each setup step. When a newer bgp-admin changes a file it
          generates, the apps still on the old version show as out of date, and the Update button at
          the top of that column brings them all up to date at once. Click any cell to open that
          app&apos;s Setup tab.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground mb-2">
        <Legend state={{ kind: "ok" }} label="Up to date" />
        <Legend state={{ kind: "outdated" }} label="Out of date" />
        <Legend state={{ kind: "missing" }} label="Not set up" />
        <Legend state={{ kind: "off" }} label="Turned off for this app" />
        <Legend state={{ kind: "blocked", reason: "" }} label="Not used by bgp-admin itself" />
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-3xl">
        Update buttons only replace files that are out of date, and skip disabled apps. A step an
        app does not have yet is set up from that app&apos;s Setup tab, so nothing gets added to an
        app by accident.
      </p>

      {appsQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {appsQ.error && <p className="text-sm text-destructive">{(appsQ.error as Error).message}</p>}

      {apps.length > 0 && (
        <div className="rounded-md border border-border bg-card overflow-x-auto">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-56">App</TableHead>
                {STEPS.map((step) => {
                  const bulkKey = (["deploy", "preview", "agentDocs"] as const).find(
                    (k) => k === step.key,
                  );
                  const count = bulkKey ? bulkTargets(bulkKey).length : 0;
                  return (
                    <TableHead key={step.key} className="text-center align-top py-2">
                      <div className="text-xs leading-tight">{step.title}</div>
                      {bulkKey && count > 0 && (
                        <Button
                          size="sm"
                          variant="default"
                          className="h-6 px-2 text-[11px] mt-1.5"
                          disabled={running}
                          onClick={() => setConfirming(bulkKey)}
                        >
                          Update {count}
                        </Button>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((app, i) => (
                <TableRow key={app.id} className={app.is_active ? "" : "opacity-60"}>
                  <TableCell className="py-2">
                    <Link
                      to="/apps/$id"
                      params={{ id: app.id }}
                      search={{ tab: "setup" }}
                      className="font-medium text-sm hover:underline"
                    >
                      {app.name}
                    </Link>
                    <div className="text-[11px] font-mono text-muted-foreground truncate max-w-52">
                      {app.github_repo}
                      {!app.is_active && " · disabled"}
                    </div>
                  </TableCell>
                  {STEPS.map((step) => {
                    const runStatus = run?.step === step.key ? run.status[app.id] : undefined;
                    return (
                      <TableCell key={step.key} className="text-center py-2">
                        <Link
                          to="/apps/$id"
                          params={{ id: app.id }}
                          search={{ tab: "setup" }}
                          className="inline-flex items-center justify-center rounded p-1.5 hover:bg-accent"
                        >
                          {runStatus ? (
                            <RunIcon status={runStatus} />
                          ) : (
                            <StateIcon state={cellState(step, i)} />
                          )}
                        </Link>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        {confirming && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {BULK_COPY[confirming].title(bulkTargets(confirming).length)}
              </AlertDialogTitle>
              <AlertDialogDescription>{BULK_COPY[confirming].body}</AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="list-disc pl-5 text-sm space-y-0.5">
              {bulkTargets(confirming).map((a) => (
                <li key={a.id}>{a.name}</li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const key = confirming;
                  setConfirming(null);
                  void runBulk(key);
                }}
              >
                Update
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}

/** An icon with a hover hint and the same words for screen readers. */
function Hinted({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <span title={hint} className="inline-flex">
      {children}
      <span className="sr-only">{hint}</span>
    </span>
  );
}

function StateIcon({ state }: { state: CellState }) {
  switch (state.kind) {
    case "loading":
      return (
        <Hinted hint="Checking…">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />
        </Hinted>
      );
    case "ok":
      return (
        <Hinted hint="Up to date">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        </Hinted>
      );
    case "outdated":
      return (
        <Hinted hint="Out of date">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        </Hinted>
      );
    case "missing":
      return (
        <Hinted hint={state.detail ?? "Not set up"}>
          <XCircle className="h-4 w-4 text-muted-foreground/40" />
        </Hinted>
      );
    case "off":
      return (
        <Hinted hint="Turned off for this app">
          <span className="text-[11px] font-mono uppercase text-muted-foreground">off</span>
        </Hinted>
      );
    case "blocked":
      return (
        <Hinted hint={state.reason || "Not used by bgp-admin itself"}>
          <span className="text-muted-foreground/60">—</span>
        </Hinted>
      );
    case "error":
      return (
        <Hinted hint={`Could not check: ${state.message}`}>
          <XCircle className="h-4 w-4 text-destructive" />
        </Hinted>
      );
  }
}

function RunIcon({ status }: { status: RunStatus }) {
  if (status === "queued")
    return (
      <Hinted hint="Waiting its turn">
        <Loader2 className="h-4 w-4 text-muted-foreground/40" />
      </Hinted>
    );
  if (status === "running")
    return (
      <Hinted hint="Updating…">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </Hinted>
    );
  if (status === "done")
    return (
      <Hinted hint="Updated">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
      </Hinted>
    );
  return (
    <Hinted hint={`Update failed: ${status.error}`}>
      <XCircle className="h-4 w-4 text-destructive" />
    </Hinted>
  );
}

function Legend({ state, label }: { state: CellState; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StateIcon state={state} />
      {label}
    </span>
  );
}

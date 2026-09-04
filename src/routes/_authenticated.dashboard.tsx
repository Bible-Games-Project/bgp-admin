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
  TriangleAlert,
} from "lucide-react";
import {
  isCurrentUserAdmin,
  listRepoRuns,
  triggerDeploy,
  getRepoMarketingVersion,
  getCommitsAheadOfLatestTag,
} from "@/lib/deploy.functions";
import { cancelOpenReviewSubmission, getAppStoreVersionState } from "@/lib/appstore.functions";
import { listApps } from "@/lib/apps.functions";
import { DEFAULT_RELEASE_NOTES } from "@/lib/release-notes";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

// App Store Connect states are SHOUTED_CONSTANTS; nobody should have to read those.
function humanState(state: string): string {
  return state.toLowerCase().replace(/_/g, " ");
}

// The four rejection states mean genuinely different things, and the difference decides
// whether there is anything to fix at all — "developer rejected" is someone on our side
// pulling the submission, not Apple refusing it.
function rejectionNotice(state: string, versionString: string): string | null {
  switch (state) {
    case "REJECTED":
      return `Apple rejected version ${versionString} after review. Read why before sending it again — the same problem gets the same answer.`;
    case "METADATA_REJECTED":
      return `Apple rejected version ${versionString} over its store listing, not the build itself. Fix what they flagged; a fresh build is not what is missing.`;
    case "DEVELOPER_REJECTED":
      return `Version ${versionString} was pulled out of review from your side, not rejected by Apple. If that was deliberate and already dealt with, this release is fine to send.`;
    case "INVALID_BINARY":
      return `Apple found the build attached to version ${versionString} invalid. This release uploads a new one, which is usually what fixes it.`;
    default:
      return null;
  }
}

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
  githubRepo,
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
  // Once the number has been typed by hand, nothing may overwrite it.
  const [versionTouched, setVersionTouched] = useState(false);
  const marketingVersion = `${major || "0"}.${minor || "0"}`;
  const [deployIos, setDeployIos] = useState(true);
  const [deployAndroid, setDeployAndroid] = useState(true);
  const [prodDialogOpen, setProdDialogOpen] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState(DEFAULT_RELEASE_NOTES);
  // Never ship blank notes: an emptied box falls back to the generic text.
  const effectiveReleaseNotes = releaseNotes.trim() || DEFAULT_RELEASE_NOTES;

  useEffect(() => setRef(defaultRef), [defaultRef]);

  const { data: repoVersionData } = useQuery({
    queryKey: ["repoVersion", appId, ref],
    queryFn: () => fetchRepoVersion({ data: { appId, ref } }),
    enabled: !!appId && !!ref,
    staleTime: 60_000,
  });
  const repoVersion = repoVersionData?.version ?? null;

  // Nobody should have to know what number to type: App Store Connect already holds the
  // answer, so read it and prefill. Only queried while the production dialog is open,
  // since it is the only place the number actually matters.
  const fetchAscState = useServerFn(getAppStoreVersionState);
  const { data: ascState, isFetching: ascFetching } = useQuery({
    queryKey: ["appStoreVersionState", appId],
    queryFn: () => fetchAscState({ data: { appId } }),
    enabled: !!appId && prodDialogOpen,
    staleTime: 30_000,
  });

  const ascSuggested = ascState?.suggested;
  useEffect(() => {
    if (!ascSuggested || versionTouched) return;
    setMajor(ascSuggested.major);
    setMinor(ascSuggested.minor);
  }, [ascSuggested, versionTouched]);

  // Apple takes one submission at a time, and refuses a version that is not higher than
  // the one on sale. Both are knowable before building, so refuse here rather than
  // failing twenty minutes into a run.
  const ascRejection =
    deployIos && ascState?.available && !ascState.error && ascState.editable
      ? rejectionNotice(ascState.editable.state, ascState.editable.versionString)
      : null;

  const cancelSubmissionFn = useServerFn(cancelOpenReviewSubmission);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const cancelSubmissionM = useMutation({
    mutationFn: () => cancelSubmissionFn({ data: { appId } }),
    onSuccess: (result) => {
      toast.success(result.message);
      setConfirmingCancel(false);
      qc.invalidateQueries({ queryKey: ["appStoreVersionState", appId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Confirming before the store answers would skip both the blocker checks and the
  // version prefill, so the number typed would be whatever was there before. A failed
  // lookup leaves isFetching false, so the button never sticks disabled.
  const ascPending = deployIos && ascFetching && !ascState;

  const ascBlocker: {
    message: string;
    cancellable?: boolean;
    rejectedSteps?: boolean;
  } | null = (() => {
    if (!deployIos || !ascState?.available || ascState.error) return null;
    const open = ascState.openSubmission;
    if (open?.state === "UNRESOLVED_ISSUES") {
      return {
        message:
          "Apple rejected the last submission and it is still open, holding the one submission slot this app gets. Do not try to force a production release past it — swap the build on the existing submission instead, which answers Apple on the same thread rather than starting the queue over.",
        rejectedSteps: true,
      };
    }
    if (open) {
      return {
        message: `A submission is already ${humanState(open.state)} with Apple, and only one is allowed at a time. Nothing can be edited while Apple has it, so either wait for a verdict or withdraw it to send this one instead.`,
        cancellable: true,
      };
    }
    if (ascState.inFlight) {
      return {
        message: `Version ${ascState.inFlight.versionString} is already with Apple (${humanState(ascState.inFlight.state)}). Wait for it to finish or cancel it in App Store Connect before sending another.`,
      };
    }
    const live = ascState.live;
    if (live) {
      const [liveMajor, liveMinor] = live.versionString.split(".");
      const chosen = Number(major || 0) * 10000 + Number(minor || 0);
      const published = Number(liveMajor || 0) * 10000 + Number(liveMinor || 0);
      if (chosen < published) {
        return {
          message: `Version ${major}.${minor} is below ${live.versionString}, which is already on sale. Apple only accepts higher numbers.`,
        };
      }
    }
    return null;
  })();

  const fetchCommitsAhead = useServerFn(getCommitsAheadOfLatestTag);
  const {
    data: aheadData,
    isFetching: aheadFetching,
    refetch: refetchAhead,
  } = useQuery({
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
          },
        },
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

  const prodDeployM = useMutation({
    mutationFn: () =>
      deployFn({
        data: {
          appId,
          workflowFile: "deploy.yml",
          ref,
          inputs: {
            deploy_ios: deployIos,
            deploy_android: deployAndroid,
            marketing_version: marketingVersion.trim() || undefined,
            production: true,
            release_notes: effectiveReleaseNotes,
          },
        },
      }),
    onSuccess: () => {
      const platforms = [];
      if (deployIos) platforms.push("iOS");
      if (deployAndroid) platforms.push("Android");
      const versionStr = marketingVersion.trim() ? ` v${marketingVersion}` : "";
      toast.success(`Releasing to production ${platforms.join(" + ")}${versionStr} on ${ref}`);
      setProdDialogOpen(false);
      setReleaseNotes(DEFAULT_RELEASE_NOTES);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["runs", appId] }), 1500);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const usingDefaultNotes = !releaseNotes.trim();
  const actionsDisabled =
    deployM.isPending || prodDeployM.isPending || !ref.trim() || (!deployIos && !deployAndroid);

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
              <RefreshCw
                className={`h-3 w-3 ${aheadFetching ? "animate-spin" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  refetchAhead();
                }}
              />
              {aheadData.ahead === 0 ? (
                <span>
                  up to date with <span className="text-foreground">{aheadData.tag}</span>
                </span>
              ) : (
                <span>
                  <span className="text-foreground font-semibold">{aheadData.ahead}</span> commit
                  {aheadData.ahead === 1 ? "" : "s"} ahead of{" "}
                  <span className="text-foreground">{aheadData.tag}</span>
                </span>
              )}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : aheadData && !aheadData.tag ? (
            <span className="text-xs font-mono text-muted-foreground">no tags yet</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 h-9 shrink-0">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              className="bg-transparent text-sm font-mono w-32 outline-none"
              placeholder="main"
            />
          </div>

          <div
            className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 h-9"
            title="Marketing version: Major.Minor. The build number is appended automatically by CI (GITHUB_RUN_NUMBER)."
          >
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
              Major
            </span>
            <input
              value={major}
              onChange={(e) => {
                setVersionTouched(true);
                setMajor(e.target.value.replace(/\D/g, ""));
              }}
              className="bg-transparent text-sm font-mono w-8 outline-none text-center"
              placeholder="0"
              inputMode="numeric"
            />
            <span className="text-muted-foreground">.</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mx-1">
              Minor
            </span>
            <input
              value={minor}
              onChange={(e) => {
                setVersionTouched(true);
                setMinor(e.target.value.replace(/\D/g, ""));
              }}
              className="bg-transparent text-sm font-mono w-8 outline-none text-center"
              placeholder="0"
              inputMode="numeric"
            />
            <span className="text-muted-foreground">.</span>
            <span
              className="text-xs font-mono text-muted-foreground italic"
              title="Auto-incremented by CI on every deploy"
            >
              auto
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 border-t border-border pt-4">
          <div className="space-y-1.5">
            <Button
              onClick={() => deployM.mutate()}
              disabled={actionsDisabled}
              className="w-full gap-2"
            >
              {deployM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              Deploy to Testing
            </Button>
            <p className="text-[11px] font-mono text-muted-foreground text-center">
              Play internal track · TestFlight
            </p>
          </div>

          <div className="space-y-1.5">
            <Button
              variant="destructive"
              onClick={() => setProdDialogOpen(true)}
              disabled={actionsDisabled}
              className="w-full gap-2"
            >
              {prodDeployM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <TriangleAlert className="h-4 w-4" />
              )}
              Release to Production
            </Button>
            <p className="text-[11px] font-mono text-muted-foreground text-center">
              Play production · App Store review
            </p>
          </div>
        </div>
      </div>

      <Dialog
        open={prodDialogOpen}
        onOpenChange={(open) => {
          if (prodDeployM.isPending) return;
          // A half-armed cancel must not still be armed next time the dialog opens.
          if (!open) setConfirmingCancel(false);
          setProdDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release to Production</DialogTitle>
            <DialogDescription>
              This builds {ref} and ships it to the Google Play production track
              {deployIos
                ? " and submits the build for Apple review, set to release automatically once approved"
                : ""}
              . Not trivially reversible.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs font-mono space-y-1">
              <div>
                branch: <span className="text-foreground">{ref}</span>
              </div>
              <div>
                version: <span className="text-foreground">{marketingVersion || "—"}</span>
              </div>
              <div>
                platforms:{" "}
                <span className="text-foreground">
                  {[deployIos && "iOS", deployAndroid && "Android"].filter(Boolean).join(" + ") ||
                    "none"}
                </span>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Release notes / What&apos;s New
              </label>
              <Textarea
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                placeholder={DEFAULT_RELEASE_NOTES}
                rows={4}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {usingDefaultNotes ? (
                  <>
                    Left empty, so both stores get the default text:{" "}
                    <span className="text-foreground">{DEFAULT_RELEASE_NOTES}</span>
                  </>
                ) : (
                  <>Sent to both stores. Play truncates anything past 500 characters.</>
                )}
              </p>
            </div>

            {deployIos && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
                <p className="font-medium flex items-center gap-1.5">
                  {ascFetching && <Loader2 className="h-3 w-3 animate-spin" />}
                  App Store Connect
                </p>
                {ascFetching && !ascState ? (
                  <p className="text-muted-foreground">Checking what version the store expects…</p>
                ) : !ascState?.available ? (
                  <p className="text-muted-foreground">
                    Not connected, so the version above was not checked against the store. Make sure
                    it is higher than whatever is published.
                  </p>
                ) : ascState.error ? (
                  <p className="text-muted-foreground">{ascState.error}</p>
                ) : (
                  <>
                    {ascState.editable && (
                      <p className="text-muted-foreground">
                        Open and waiting for a build:{" "}
                        <span className="text-foreground font-mono">
                          {ascState.editable.versionString}
                        </span>{" "}
                        ({humanState(ascState.editable.state)})
                      </p>
                    )}
                    {ascState.live && (
                      <p className="text-muted-foreground">
                        On sale now:{" "}
                        <span className="text-foreground font-mono">
                          {ascState.live.versionString}
                        </span>
                      </p>
                    )}
                    {!ascState.editable && !ascState.live && !ascState.inFlight && (
                      <p className="text-muted-foreground">No versions yet — this is the first.</p>
                    )}
                    {ascState.suggested && !versionTouched && (
                      <p className="text-muted-foreground">{ascState.suggested.reason}</p>
                    )}
                    {versionTouched && ascState.suggested && (
                      <p className="text-muted-foreground">
                        You changed the version by hand. The store suggested{" "}
                        <button
                          type="button"
                          className="text-foreground font-mono underline underline-offset-2"
                          onClick={() => setVersionTouched(false)}
                        >
                          {ascState.suggested.major}.{ascState.suggested.minor}
                        </button>
                        .
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {ascRejection && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <p className="font-medium">This app has a rejected version.</p>
                <p className="text-muted-foreground mt-1">{ascRejection}</p>
                {ascState?.ascAppId && (
                  <a
                    href={`https://appstoreconnect.apple.com/apps/${ascState.ascAppId}/resolutioncenter`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 mt-1.5 text-primary hover:underline"
                  >
                    Open Resolution Center <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <p className="text-muted-foreground mt-1.5">
                  Apple does not expose the rejection message itself over its API, so the reason
                  only lives in there.
                </p>
              </div>
            )}

            {ascBlocker && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs">
                <p className="font-medium">This release cannot go out yet.</p>
                <p className="text-muted-foreground mt-1">{ascBlocker.message}</p>
                {ascState?.ascAppId && (
                  <a
                    href={`https://appstoreconnect.apple.com/apps/${ascState.ascAppId}/resolutioncenter`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 mt-1.5 text-primary hover:underline"
                  >
                    Open Resolution Center <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {ascBlocker.rejectedSteps && (
                  <ol className="mt-2 space-y-1.5 text-muted-foreground list-decimal pl-4">
                    <li>
                      Read what Apple actually asked for in Resolution Center. Everything below
                      depends on it.
                    </li>
                    <li>
                      If it is the store listing — screenshots, description, privacy, age rating —
                      fix it in App Store Connect. No new build is involved.
                    </li>
                    <li>
                      If it is the app itself, fix the code, merge to {ref}, then use{" "}
                      <span className="text-foreground">Deploy to Testing</span>. That uploads the
                      build to App Store Connect the same way a production release does — it just
                      does not submit it.
                    </li>
                    <li>
                      In App Store Connect, open the version, remove the old build and select the
                      one you just uploaded.
                    </li>
                    <li>
                      Submit from there, replying to Apple on the existing thread. The release does
                      not come back through this button.
                    </li>
                  </ol>
                )}
                {ascBlocker.cancellable && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={confirmingCancel ? "destructive" : "outline"}
                      disabled={cancelSubmissionM.isPending}
                      onClick={() =>
                        confirmingCancel ? cancelSubmissionM.mutate() : setConfirmingCancel(true)
                      }
                      className="gap-1.5 h-7 text-xs"
                    >
                      {cancelSubmissionM.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                      {confirmingCancel
                        ? "Yes, withdraw it from Apple"
                        : "Cancel the open submission"}
                    </Button>
                    {confirmingCancel && !cancelSubmissionM.isPending && (
                      <button
                        onClick={() => setConfirmingCancel(false)}
                        className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                      >
                        Keep it
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <p className="font-medium">First release of an app? Expect this to fail.</p>
              <p className="text-muted-foreground mt-1">
                An app&apos;s first production release needs its store listing completed by hand:
                screenshots, description, category, privacy policy, and age rating in App Store
                Connect, plus the content rating, data safety form, and a closed test in Play
                Console. Nothing here can fill those in. Once the listing is complete, every later
                release is fully automatic.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProdDialogOpen(false)}
              disabled={prodDeployM.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => prodDeployM.mutate()}
              disabled={prodDeployM.isPending || !!ascBlocker || ascPending}
              className="gap-2"
            >
              {(prodDeployM.isPending || ascPending) && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {ascPending ? "Checking App Store Connect…" : "Confirm production release"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RunsHistory({ appId }: { appId: string }) {
  const runsFn = useServerFn(listRepoRuns);
  const q = useQuery({
    queryKey: ["runs", appId, "deploy.yml"],
    queryFn: () => runsFn({ data: { appId, workflowFile: "deploy.yml" } }),
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
  const sessionQ = useQuery({
    queryKey: ["sessionUser"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
    },
  });
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
          Your account is signed in but not authorized to use this console. Ask an admin to add your
          user to the allow list.
        </p>
        {sessionQ.data && (
          <div className="mt-4 rounded-md border border-border bg-card p-3 text-xs font-mono space-y-1">
            <div>
              <span className="text-muted-foreground">signed in as: </span>
              {sessionQ.data.email ?? "(no email)"}
            </div>
            <div>
              <span className="text-muted-foreground">user_id: </span>
              <span className="select-all">{sessionQ.data.id}</span>
            </div>
            <p className="text-muted-foreground pt-1">
              An admin must add this exact user_id to the <code>admins</code> table.
            </p>
          </div>
        )}
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
          <p className="text-sm text-muted-foreground">Select a project to see the deploy panel.</p>
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

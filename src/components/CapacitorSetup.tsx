import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { checkCapacitorStatus, setupCapacitor } from "@/lib/capacitor.functions";

interface CapacitorSetupProps {
  appId: string;
  bundleId: string | null | undefined;
  onSuccess: () => void;
}

export function CapacitorSetup({ appId, bundleId, onSuccess }: CapacitorSetupProps) {
  const qc = useQueryClient();

  const checkFn = useServerFn(checkCapacitorStatus);
  const setupFn = useServerFn(setupCapacitor);

  const statusQuery = useQuery({
    queryKey: ["capacitor-status", appId],
    queryFn: () => checkFn({ data: { appId } }),
  });

  const setupM = useMutation({
    mutationFn: () => setupFn({ data: { appId } }),
    onSuccess: (result) => {
      toast.success(
        <div className="flex items-center gap-2">
          <span>{result.message}</span>
          <a
            href={result.runUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            View run <ExternalLink className="w-3 h-3" />
          </a>
        </div>,
        { duration: 10000 },
      );
      qc.invalidateQueries({ queryKey: ["capacitor-status", appId] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = statusQuery.data;
  const isFullySetup = s?.hasConfig && s?.hasIos && s?.hasAndroid;

  return (
    <div className="space-y-6">
      {!bundleId && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Bundle ID is not set. Configure it in the{" "}
            <span className="font-semibold">General</span> tab before running Capacitor setup.
          </span>
        </div>
      )}

      <div className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Setup Status</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["capacitor-status", appId] })}
            disabled={statusQuery.isFetching}
            className="gap-2"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${statusQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        {statusQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking repository…
          </div>
        ) : statusQuery.error ? (
          <p className="text-sm text-destructive">{(statusQuery.error as Error).message}</p>
        ) : (
          <div className="space-y-3">
            <StatusRow label="Config file" detail="capacitor.config.ts" ok={s?.hasConfig ?? false} />
            <StatusRow label="iOS native project" detail="ios/" ok={s?.hasIos ?? false} />
            <StatusRow label="Android native project" detail="android/" ok={s?.hasAndroid ?? false} />
          </div>
        )}
      </div>

      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-1">
            {isFullySetup ? "Capacitor is configured" : "Run Setup"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {bundleId ? (
              <>
                Installs <span className="font-mono text-xs">@capacitor/core</span>,{" "}
                <span className="font-mono text-xs">@capacitor/cli</span>,{" "}
                <span className="font-mono text-xs">@capacitor/ios</span> and{" "}
                <span className="font-mono text-xs">@capacitor/android</span>, creates{" "}
                <span className="font-mono text-xs">capacitor.config.ts</span> with bundle ID{" "}
                <span className="font-mono text-xs font-semibold">{bundleId}</span>, and scaffolds
                the native iOS and Android projects. Runs via GitHub Actions and takes 5–10 minutes.
              </>
            ) : (
              "Set a bundle ID in the General tab to enable setup."
            )}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            {setupM.isPending && (
              <p className="text-sm text-muted-foreground truncate">
                <Loader2 className="inline w-4 h-4 animate-spin mr-2" />
                Running setup workflow… this takes 5–10 minutes
              </p>
            )}
          </div>
          <Button
            onClick={() => setupM.mutate()}
            disabled={setupM.isPending || !bundleId}
            variant={isFullySetup ? "outline" : "default"}
            className="shrink-0"
          >
            {setupM.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Setting up…
              </>
            ) : isFullySetup ? (
              "Re-run Setup"
            ) : (
              "Setup Capacitor"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, detail, ok }: { label: string; detail: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-muted-foreground/50 shrink-0" />
      )}
      <span className="text-sm">{label}</span>
      <span className="font-mono text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

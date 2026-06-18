import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import {
  checkCapacitorStatus,
  setupCapacitor,
  checkAndroidSigning,
  configureAndroidSigning,
  checkAndroidKeystoreSecrets,
  generateAndroidKeystoreSecrets,
  checkIosSecrets,
  configureIosSecrets,
  checkDeployWorkflow,
  createDeployWorkflow,
} from "@/lib/capacitor.functions";
import { listSetupSteps, setSetupStep } from "@/lib/app-setup.functions";
import { Checkbox } from "@/components/ui/checkbox";

interface AppSetupTabProps {
  appId: string;
  bundleId: string | null | undefined;
  appName: string;
  onSuccess: () => void;
}

export function AppSetupTab({ appId, bundleId, appName, onSuccess }: AppSetupTabProps) {
  const qc = useQueryClient();

  const [keystoreResult, setKeystoreResult] = useState<{
    password: string;
    alias: string;
  } | null>(null);

  const [mobileProvisionBase64, setMobileProvisionBase64] = useState<string | null>(null);
  const checkCapacitorFn = useServerFn(checkCapacitorStatus);
  const setupCapacitorFn = useServerFn(setupCapacitor);
  const checkAndroidSigningFn = useServerFn(checkAndroidSigning);
  const configureAndroidSigningFn = useServerFn(configureAndroidSigning);
  const checkAndroidKeystoreFn = useServerFn(checkAndroidKeystoreSecrets);
  const generateAndroidKeystoreFn = useServerFn(generateAndroidKeystoreSecrets);
  const checkIosSecretsFn = useServerFn(checkIosSecrets);
  const configureIosSecretsFn = useServerFn(configureIosSecrets);
  const checkDeployFn = useServerFn(checkDeployWorkflow);
  const createDeployFn = useServerFn(createDeployWorkflow);

  const capacitorQ = useQuery({
    queryKey: ["capacitor-status", appId],
    queryFn: () => checkCapacitorFn({ data: { appId } }),
  });

  const androidSigningQ = useQuery({
    queryKey: ["android-signing", appId],
    queryFn: () => checkAndroidSigningFn({ data: { appId } }),
  });

  const keystoreQ = useQuery({
    queryKey: ["android-keystore-secrets", appId],
    queryFn: () => checkAndroidKeystoreFn({ data: { appId } }),
  });

  const iosSecretsQ = useQuery({
    queryKey: ["ios-secrets", appId],
    queryFn: () => checkIosSecretsFn({ data: { appId } }),
  });

  const deployQ = useQuery({
    queryKey: ["deploy-workflow", appId],
    queryFn: () => checkDeployFn({ data: { appId } }),
  });

  const listSetupFn = useServerFn(listSetupSteps);
  const setSetupFn = useServerFn(setSetupStep);

  const setupStepsQ = useQuery({
    queryKey: ["app-setup-steps", appId],
    queryFn: () => listSetupFn({ data: { appId } }),
  });

  const completedKeys = new Set((setupStepsQ.data?.steps ?? []).map((s: any) => s.step_key));

  const toggleStepM = useMutation({
    mutationFn: (vars: { stepKey: string; completed: boolean }) =>
      setSetupFn({ data: { appId, ...vars } }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["app-setup-steps", appId] });
      const prev = qc.getQueryData<any>(["app-setup-steps", appId]);
      qc.setQueryData(["app-setup-steps", appId], (old: any) => {
        const steps = (old?.steps ?? []).filter((s: any) => s.step_key !== vars.stepKey);
        if (vars.completed) steps.push({ step_key: vars.stepKey, completed_at: new Date().toISOString() });
        return { steps };
      });
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["app-setup-steps", appId], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["app-setup-steps", appId] }),
  });

  const capacitorM = useMutation({
    mutationFn: () => setupCapacitorFn({ data: { appId } }),
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

  const androidSigningM = useMutation({
    mutationFn: () => configureAndroidSigningFn({ data: { appId } }),
    onSuccess: (result) => {
      toast.success(
        <div className="flex items-center gap-2">
          <span>{result.message}</span>
          {result.commitUrl && (
            <a
              href={result.commitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View commit <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>,
        { duration: 8000 },
      );
      qc.invalidateQueries({ queryKey: ["android-signing", appId] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const keystoreM = useMutation({
    mutationFn: () => generateAndroidKeystoreFn({ data: { appId } }),
    onSuccess: (result) => {
      setKeystoreResult({ password: result.password, alias: result.alias });
      toast.success(result.message, { duration: 10000 });
      qc.invalidateQueries({ queryKey: ["android-keystore-secrets", appId] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const iosSecretsM = useMutation({
    mutationFn: () => {
      if (!mobileProvisionBase64) throw new Error("No .mobileprovision file selected");
      return configureIosSecretsFn({ data: { appId, mobileProvisionBase64 } });
    },
    onSuccess: (result) => {
      toast.success(result.message, { duration: 8000 });
      qc.invalidateQueries({ queryKey: ["ios-secrets", appId] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deployM = useMutation({
    mutationFn: () => createDeployFn({ data: { appId } }),
    onSuccess: (result) => {
      toast.success(
        <div className="flex items-center gap-2">
          <span>{result.message}</span>
          {result.commitUrl && (
            <a
              href={result.commitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View commit <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>,
        { duration: 8000 },
      );
      qc.invalidateQueries({ queryKey: ["deploy-workflow", appId] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cs = capacitorQ.data;
  const capacitorDone = cs?.hasConfig && cs?.hasIos && cs?.hasAndroid;
  const androidSigningDone = androidSigningQ.data?.configured ?? false;
  const keystoreDone = keystoreQ.data?.configured ?? false;
  const iosSecretsDone = iosSecretsQ.data?.configured ?? false;
  const deployDone = deployQ.data?.exists ?? false;

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200 mb-4">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          The app repository must be <span className="font-semibold">public</span>. The deploy system uses the GitHub Actions API, which requires public repos.
        </span>
      </div>
      {!bundleId && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 mb-4">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Bundle ID is not set. Configure it in the{" "}
            <span className="font-semibold">General</span> tab before running setup.
          </span>
        </div>
      )}

      <SetupStep
        number={1}
        title="Capacitor"
        description="Install @capacitor/core, @capacitor/ios and @capacitor/android, create capacitor.config.ts, and scaffold the native ios/ and android/ project directories."
        done={!!capacitorDone}
        isLast={false}
        statusContent={
          capacitorQ.isLoading ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking…
            </span>
          ) : capacitorQ.error ? (
            <span className="text-xs text-destructive">{(capacitorQ.error as Error).message}</span>
          ) : (
            <div className="flex flex-col gap-1.5 mt-2">
              <StatusRow label="capacitor.config.ts" ok={cs?.hasConfig ?? false} />
              <StatusRow label="ios/" ok={cs?.hasIos ?? false} />
              <StatusRow label="android/" ok={cs?.hasAndroid ?? false} />
            </div>
          )
        }
        actionContent={
          <div className="flex items-center gap-3 mt-3">
            <Button
              size="sm"
              variant={capacitorDone ? "outline" : "default"}
              disabled={capacitorM.isPending || !bundleId}
              onClick={() => capacitorM.mutate()}
            >
              {capacitorM.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Setting up…</>
              ) : capacitorDone ? "Re-run" : "Setup Capacitor"}
            </Button>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ["capacitor-status", appId] })}
              disabled={capacitorQ.isFetching}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${capacitorQ.isFetching ? "animate-spin" : ""}`} />
            </button>
            {capacitorM.isPending && (
              <span className="text-xs text-muted-foreground">Running via GitHub Actions (5–10 min)…</span>
            )}
          </div>
        }
      />

      <SetupStep
        number={2}
        title="Android Signing Config"
        description="Insert the signing configuration into android/app/build.gradle so release builds can be signed."
        done={androidSigningDone}
        isLast={false}
        statusContent={
          androidSigningQ.isLoading ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking…
            </span>
          ) : (
            <div className="flex flex-col gap-1.5 mt-2">
              <StatusRow label="android/app/build.gradle signing config" ok={androidSigningDone} />
            </div>
          )
        }
        actionContent={
          <div className="flex items-center gap-3 mt-3">
            <Button
              size="sm"
              variant={androidSigningDone ? "outline" : "default"}
              disabled={androidSigningM.isPending || !androidSigningQ.data?.fileExists}
              onClick={() => androidSigningM.mutate()}
            >
              {androidSigningM.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Configuring…</>
              ) : androidSigningDone ? "Re-configure" : "Configure Signing"}
            </Button>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ["android-signing", appId] })}
              disabled={androidSigningQ.isFetching}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${androidSigningQ.isFetching ? "animate-spin" : ""}`} />
            </button>
            {!androidSigningQ.data?.fileExists && !androidSigningQ.isLoading && (
              <span className="text-xs text-muted-foreground">Requires Step 1 first</span>
            )}
          </div>
        }
      />

      <SetupStep
        number={3}
        title="Android Keystore"
        description="Generate a release keystore and set ANDROID_KEYSTORE, KEYSTORE_PASSWORD and KEY_ALIAS directly as GitHub secrets in the app repo."
        done={keystoreDone}
        isLast={false}
        statusContent={
          keystoreQ.isLoading ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking…
            </span>
          ) : (
            <div className="flex flex-col gap-1.5 mt-2">
              <StatusRow label="ANDROID_KEYSTORE + KEYSTORE_PASSWORD + KEY_ALIAS" ok={keystoreDone} />
            </div>
          )
        }
        actionContent={
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant={keystoreDone ? "outline" : "default"}
                disabled={keystoreM.isPending}
                onClick={() => keystoreM.mutate()}
              >
                {keystoreM.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Generating…</>
                ) : keystoreDone ? "Regenerate" : "Generate Keystore"}
              </Button>
              <button
                onClick={() => qc.invalidateQueries({ queryKey: ["android-keystore-secrets", appId] })}
                disabled={keystoreQ.isFetching}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${keystoreQ.isFetching ? "animate-spin" : ""}`} />
              </button>
              {keystoreM.isPending && (
                <span className="text-xs text-muted-foreground">Generating via GitHub Actions (~1 min)…</span>
              )}
            </div>
            {keystoreResult && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950 p-3 space-y-2">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  Save these values — they won't be shown again.
                </p>
                <CopyRow label="KEYSTORE_PASSWORD" value={keystoreResult.password} />
                <CopyRow label="KEY_ALIAS" value={keystoreResult.alias} />
              </div>
            )}
          </div>
        }
      />

      <SetupStep
        number={4}
        title="iOS Secrets"
        description="Upload your .mobileprovision file. We'll parse the profile name and team ID, generate ExportOptions.plist, and set IOS_BUILD_PROVISION_PROFILE_BASE64 and IOS_EXPORT_OPTIONS_PLIST as repository secrets."
        done={iosSecretsDone}
        isLast={false}
        statusContent={
          iosSecretsQ.isLoading ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking…
            </span>
          ) : (
            <div className="flex flex-col gap-1.5 mt-2">
              <StatusRow label="IOS_BUILD_PROVISION_PROFILE_BASE64 + IOS_EXPORT_OPTIONS_PLIST" ok={iosSecretsDone} />
            </div>
          )
        }
        actionContent={
          <div className="mt-3 space-y-3">
            <div className="rounded-md bg-muted px-3 py-2.5 text-xs text-muted-foreground space-y-2.5">
              <p className="font-medium text-foreground">How to get a .mobileprovision file</p>
              <div>
                <p className="font-medium text-foreground/80 mb-1">1. Create an App ID (if not yet created)</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Go to <a href="https://developer.apple.com/account/resources/identifiers/list" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Apple Developer → Identifiers</a></li>
                  <li>Click <strong>+</strong> → App IDs → App → Continue</li>
                  <li>Set Description and Bundle ID (Explicit): <code>{bundleId ?? "your bundle ID"}</code></li>
                  <li>Register</li>
                </ol>
              </div>
              <div>
                <p className="font-medium text-foreground/80 mb-1">2. Create the provisioning profile</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Go to <a href="https://developer.apple.com/account/resources/profiles/list" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Apple Developer → Profiles</a></li>
                  <li>Click <strong>+</strong> → App Store Connect distribution → Continue</li>
                  <li>Select your App ID for <code>{bundleId ?? "your bundle ID"}</code></li>
                  <li>Select your distribution certificate → Continue → Download</li>
                </ol>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <span className="text-xs text-muted-foreground border border-dashed border-border rounded px-3 py-1.5 hover:border-foreground transition-colors">
                {mobileProvisionBase64 ? "✓ .mobileprovision loaded" : "Select .mobileprovision…"}
              </span>
              <input
                type="file"
                accept=".mobileprovision"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const base64 = (reader.result as string).split(",")[1];
                    setMobileProvisionBase64(base64);
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant={iosSecretsDone ? "outline" : "default"}
                disabled={iosSecretsM.isPending || !mobileProvisionBase64}
                onClick={() => iosSecretsM.mutate()}
              >
                {iosSecretsM.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Setting…</>
                ) : iosSecretsDone ? "Re-upload" : "Set iOS Secrets"}
              </Button>
              <button
                onClick={() => qc.invalidateQueries({ queryKey: ["ios-secrets", appId] })}
                disabled={iosSecretsQ.isFetching}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${iosSecretsQ.isFetching ? "animate-spin" : ""}`} />
              </button>
              {iosSecretsM.isPending && (
                <span className="text-xs text-muted-foreground">Via GitHub Actions (~30 s)…</span>
              )}
            </div>
          </div>
        }
      />

      <SetupStep
        number={5}
        title="Store Listings"
        description="Create the app in Google Play Console and App Store Connect before the first deploy. The deploy workflow can upload builds to existing apps but cannot create new store listings."
        done={completedKeys.has("store_listings")}
        isLast={false}
        statusContent={
          <label className="mt-2 flex items-center gap-2 cursor-pointer w-fit">
            <Checkbox
              checked={completedKeys.has("store_listings")}
              disabled={toggleStepM.isPending || setupStepsQ.isLoading}
              onCheckedChange={(checked) =>
                toggleStepM.mutate({ stepKey: "store_listings", completed: !!checked })
              }
            />
            <span className="text-xs text-muted-foreground">Mark as completed</span>
          </label>
        }
        actionContent={
          <div className="mt-3 space-y-3">
            <div className="rounded-md bg-muted px-3 py-2.5 text-xs text-muted-foreground space-y-2.5">
              <div>
                <p className="font-medium text-foreground/80 mb-1">Google Play Console</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Go to <a href="https://play.google.com/console" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">play.google.com/console</a> → Create app</li>
                  <li>Fill in title, language, type and pricing → Create</li>
                  <li>Complete enough of the store listing to be able to upload to Internal Testing</li>
                  <li>Go to <strong>Users and permissions</strong> → Invite new users → add the service account (<code>client_email</code> from your <code>GOOGLE_PLAY_SERVICE_ACCOUNT_JSON</code>) with <strong>Release manager</strong> role for this app</li>
                </ol>
              </div>
              <div>
                <p className="font-medium text-foreground/80 mb-1">App Store Connect</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Go to <a href="https://appstoreconnect.apple.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">appstoreconnect.apple.com</a> → Apps → <strong>+</strong></li>
                  <li>Select platform, fill in name, primary language, Bundle ID (<code>{bundleId ?? "your bundle ID"}</code>) and SKU → Create</li>
                </ol>
              </div>
            </div>
          </div>
        }
      />

      <SetupStep
        number={6}
        title="Deploy Workflow"
        description={
          bundleId
            ? `Create .github/workflows/deploy.yml with bundle ID ${bundleId} and app name "${appName}". This file calls the centralized bgp-admin workflows for iOS and Android.`
            : "Create the deploy.yml workflow that wires iOS and Android deploys to the centralized bgp-admin CI."
        }
        done={deployDone}
        isLast={true}
        statusContent={
          deployQ.isLoading ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking…
            </span>
          ) : (
            <div className="flex flex-col gap-1.5 mt-2">
              <StatusRow label=".github/workflows/deploy.yml" ok={deployDone} />
            </div>
          )
        }
        actionContent={
          <div className="flex items-center gap-3 mt-3">
            <Button
              size="sm"
              variant={deployDone ? "outline" : "default"}
              disabled={deployM.isPending || !bundleId}
              onClick={() => deployM.mutate()}
            >
              {deployM.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Creating…</>
              ) : deployDone ? "Re-create" : "Create Deploy Workflow"}
            </Button>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ["deploy-workflow", appId] })}
              disabled={deployQ.isFetching}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${deployQ.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      />
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] text-amber-700 dark:text-amber-300 w-40 shrink-0">
        {label}
      </span>
      <span className="font-mono text-xs text-amber-900 dark:text-amber-100 flex-1 truncate">
        {value}
      </span>
      <button
        onClick={copy}
        className="shrink-0 text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-100 transition-colors"
        aria-label="Copy"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function SetupStep({
  number,
  title,
  description,
  done,
  isLast,
  statusContent,
  actionContent,
}: {
  number: number;
  title: string;
  description: string;
  done: boolean;
  isLast: boolean;
  statusContent: React.ReactNode;
  actionContent: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="relative shrink-0">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors ${
              done
                ? "border-green-500 bg-green-500 text-white"
                : "border-border bg-background text-muted-foreground"
            }`}
          >
            {number}
          </div>
          {done && (
            <div className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white dark:bg-background ring-1 ring-green-500">
              <CheckCircle2 className="w-3 h-3 text-green-500" />
            </div>
          )}
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-border" />}
      </div>

      <div className={`pb-8 min-w-0 flex-1 ${isLast ? "pb-0" : ""}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm">{title}</span>
          {done && (
            <span className="text-[10px] font-mono text-green-600 dark:text-green-400 uppercase tracking-wide">
              done
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        {statusContent}
        {actionContent}
      </div>
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
      ) : (
        <XCircle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
      )}
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

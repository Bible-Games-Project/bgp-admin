import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
  Copy,
  Check,
  Gem,
  Clapperboard,
} from "lucide-react";
import { checkAddonStatus, setupAddon, type AddonId } from "@/lib/addons.functions";
import { listSetupSteps, setSetupStep } from "@/lib/app-setup.functions";

// ─── Addon definitions ────────────────────────────────────────────────────────

interface AddonField {
  key: string;
  label: string;
  placeholder: string;
  hint: string;
}

interface AddonDef {
  id: AddonId;
  title: string;
  tagline: string;
  icon: React.ReactNode;
  consoleStepKey: string;
  consoleTitle: string;
  consoleSteps: React.ReactNode;
  fields: AddonField[];
  promptIntro: string;
  promptPlaceholder: string;
}

const IAP_CONSOLE_STEPS = (
  <ol className="list-decimal pl-4 space-y-1.5">
    <li>
      Create the in-app product in{" "}
      <ConsoleLink href="https://appstoreconnect.apple.com">App Store Connect</ConsoleLink>{" "}
      (Monetization → In-App Purchases) and in{" "}
      <ConsoleLink href="https://play.google.com/console">Google Play Console</ConsoleLink>{" "}
      (Monetize → Products → In-app products). Use the same product ID in both.
    </li>
    <li>
      Go to <ConsoleLink href="https://app.revenuecat.com">RevenueCat</ConsoleLink> and create a{" "}
      <strong>Project</strong> for this app.
    </li>
    <li>
      Inside the project, add an <strong>App Store app</strong> and a{" "}
      <strong>Play Store app</strong> — each one shows an SDK key (<code>appl_…</code> /{" "}
      <code>goog_…</code>). You will paste them below.
    </li>
    <li>
      Create an <strong>Entitlement</strong> named exactly <code>premium</code>.
    </li>
    <li>
      Under <strong>Products</strong>, import your store product IDs and attach them to the{" "}
      <code>premium</code> entitlement.
    </li>
    <li>
      Under <strong>Offerings</strong>, create a <code>default</code> offering with one package
      containing your product.
    </li>
  </ol>
);

const ADS_CONSOLE_STEPS = (
  <ol className="list-decimal pl-4 space-y-1.5">
    <li>
      Sign in to <ConsoleLink href="https://apps.admob.com">Google AdMob</ConsoleLink> and click{" "}
      <strong>Apps → Add app</strong>. Do it twice: once for iOS, once for Android.
    </li>
    <li>
      For each app, copy its <strong>App ID</strong> (looks like <code>ca-app-pub-1234…~5678</code>,
      with a <strong>~</strong>). Paste both below.
    </li>
    <li>
      Inside each app, go to <strong>Ad units → Add ad unit → Rewarded</strong>. This is the
      full-video ad the player must watch to continue.
    </li>
    <li>
      Copy each <strong>Ad unit ID</strong> (looks like <code>ca-app-pub-1234…/5678</code>, with a{" "}
      <strong>/</strong>). Paste both below.
    </li>
  </ol>
);

const ADDONS: AddonDef[] = [
  {
    id: "iap",
    title: "In-App Purchases",
    tagline:
      "Sell a one-time unlock (RevenueCat). Installs the native plugin, a useIAP hook and a ready-made Paywall component.",
    icon: <Gem className="w-4 h-4" />,
    consoleStepKey: "addon_iap_console",
    consoleTitle: "Create the product and the RevenueCat project",
    consoleSteps: IAP_CONSOLE_STEPS,
    fields: [
      {
        key: "rcApiKeyIos",
        label: "RevenueCat iOS SDK key",
        placeholder: "appl_xxxxxxxxxxxxxxxxx",
        hint: "RevenueCat → Project → your App Store app → API keys",
      },
      {
        key: "rcApiKeyAndroid",
        label: "RevenueCat Android SDK key",
        placeholder: "goog_xxxxxxxxxxxxxxxxx",
        hint: "RevenueCat → Project → your Play Store app → API keys",
      },
    ],
    promptIntro:
      "This app already has RevenueCat In-App Purchases fully installed and configured (native plugin + API keys committed). Use the existing hook at src/hooks/useIAP.ts — it exposes { hasPremium, isLoading, purchase, restore } — together with the ready-made src/components/Paywall.tsx component (you may restyle Paywall.tsx, but keep its props and the Restore button, which Apple requires). Do NOT install any package and do NOT modify src/hooks/useIAP.ts. Note: in the browser preview hasPremium is always false because purchases only work on a real device.\n\nUsing this system, add a premium gate to: ",
    promptPlaceholder:
      "e.g. lock every level after level 3; tapping a locked level opens the paywall",
  },
  {
    id: "rewarded-ads",
    title: "Rewarded Ads",
    tagline:
      "Full-screen video ads the player must watch to the end to continue (AdMob). Installs the native plugin and a useRewardedAd hook.",
    icon: <Clapperboard className="w-4 h-4" />,
    consoleStepKey: "addon_rewarded_ads_console",
    consoleTitle: "Create the AdMob apps and rewarded ad units",
    consoleSteps: ADS_CONSOLE_STEPS,
    fields: [
      {
        key: "admobAppIdIos",
        label: "AdMob App ID — iOS",
        placeholder: "ca-app-pub-1234567890123456~1234567890",
        hint: "AdMob → Apps → your iOS app → App settings (note the ~)",
      },
      {
        key: "admobAppIdAndroid",
        label: "AdMob App ID — Android",
        placeholder: "ca-app-pub-1234567890123456~0987654321",
        hint: "AdMob → Apps → your Android app → App settings (note the ~)",
      },
      {
        key: "adUnitIdIos",
        label: "Rewarded ad unit ID — iOS",
        placeholder: "ca-app-pub-1234567890123456/1234567890",
        hint: "AdMob → your iOS app → Ad units (note the /)",
      },
      {
        key: "adUnitIdAndroid",
        label: "Rewarded ad unit ID — Android",
        placeholder: "ca-app-pub-1234567890123456/0987654321",
        hint: "AdMob → your Android app → Ad units (note the /)",
      },
    ],
    promptIntro:
      "This app already has AdMob rewarded video ads fully installed and configured (native plugin + ad unit IDs committed). Use the existing hook at src/hooks/useRewardedAd.ts — it exposes { isReady, isLoading, showAd }. Call showAd(onReward): it plays a full rewarded video that the user must watch to the end, and then calls onReward; if the user closes the ad early, onReward is not called. In the browser preview the reward is granted immediately because real ads only play on a device. Do NOT install any package and do NOT modify src/hooks/useRewardedAd.ts.\n\nUsing this system, add a rewarded ad to: ",
    promptPlaceholder: "e.g. after failing a level, watching an ad grants one extra retry",
  },
];

// ─── Tab component ────────────────────────────────────────────────────────────

interface AppAddonsTabProps {
  appId: string;
  onSuccess: () => void;
}

export function AppAddonsTab({ appId, onSuccess }: AppAddonsTabProps) {
  return (
    <div className="space-y-8">
      {ADDONS.map((addon) => (
        <AddonCard key={addon.id} addon={addon} appId={appId} onSuccess={onSuccess} />
      ))}
    </div>
  );
}

function AddonCard({
  addon,
  appId,
  onSuccess,
}: {
  addon: AddonDef;
  appId: string;
  onSuccess: () => void;
}) {
  const qc = useQueryClient();
  const checkFn = useServerFn(checkAddonStatus);
  const setupFn = useServerFn(setupAddon);
  const listSetupFn = useServerFn(listSetupSteps);
  const setSetupFn = useServerFn(setSetupStep);

  const [values, setValues] = useState<Record<string, string>>({});
  const [promptEnding, setPromptEnding] = useState("");

  const statusQ = useQuery({
    queryKey: ["addon-status", appId, addon.id],
    queryFn: () => checkFn({ data: { appId, addon: addon.id } }),
  });

  const setupStepsQ = useQuery({
    queryKey: ["app-setup-steps", appId],
    queryFn: () => listSetupFn({ data: { appId } }),
  });
  const completedKeys = new Set((setupStepsQ.data?.steps ?? []).map((s: any) => s.step_key));
  const consoleDone = completedKeys.has(addon.consoleStepKey);

  const toggleConsoleM = useMutation({
    mutationFn: (completed: boolean) =>
      setSetupFn({ data: { appId, stepKey: addon.consoleStepKey, completed } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["app-setup-steps", appId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const setupM = useMutation({
    mutationFn: () => setupFn({ data: { appId, addon: addon.id, config: values } }),
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
      qc.invalidateQueries({ queryKey: ["addon-status", appId, addon.id] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const installed = statusQ.data?.installed ?? false;
  const allFieldsFilled = addon.fields.every((f) => (values[f.key] ?? "").trim().length > 0);
  const fullPrompt = addon.promptIntro + (promptEnding.trim() || "...");

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground">{addon.icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{addon.title}</span>
              {installed && (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-green-600 dark:text-green-400 uppercase tracking-wide">
                  <CheckCircle2 className="w-3 h-3" /> installed
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{addon.tagline}</p>
          </div>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["addon-status", appId, addon.id] })}
          disabled={statusQ.isFetching}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Refresh status"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${statusQ.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* Step 1 — manual console setup */}
        <AddonStep number={1} title={addon.consoleTitle} done={consoleDone}>
          <div className="rounded-md bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            {addon.consoleSteps}
          </div>
          <label className="mt-2 flex items-center gap-2 cursor-pointer w-fit">
            <Checkbox
              checked={consoleDone}
              disabled={toggleConsoleM.isPending || setupStepsQ.isLoading}
              onCheckedChange={(checked) => toggleConsoleM.mutate(!!checked)}
            />
            <span className="text-xs text-muted-foreground">Mark as completed</span>
          </label>
        </AddonStep>

        {/* Step 2 — paste keys and install */}
        <AddonStep number={2} title="Paste the keys and install" done={installed}>
          <div className="grid gap-3 sm:grid-cols-2">
            {addon.fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs font-medium">{f.label}</label>
                <Input
                  value={values[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.trim() }))}
                  className="font-mono text-xs h-8"
                />
                <p className="text-[10px] text-muted-foreground">{f.hint}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-3">
            <Button
              size="sm"
              variant={installed ? "outline" : "default"}
              disabled={setupM.isPending || !allFieldsFilled}
              onClick={() => setupM.mutate()}
            >
              {setupM.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Installing…
                </>
              ) : installed ? (
                "Re-install / update keys"
              ) : (
                `Install ${addon.title}`
              )}
            </Button>
            {setupM.isPending && (
              <span className="text-xs text-muted-foreground">
                Running via GitHub Actions (2–5 min)…
              </span>
            )}
            {!allFieldsFilled && !setupM.isPending && (
              <span className="text-xs text-muted-foreground">Fill in all keys first</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5 mt-3">
            {statusQ.isLoading ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Checking…
              </span>
            ) : statusQ.error ? (
              <span className="text-xs text-destructive">{(statusQ.error as Error).message}</span>
            ) : (
              <>
                <StatusRow
                  label={`package: ${addon.id === "iap" ? "@revenuecat/purchases-capacitor" : "@capacitor-community/admob"}`}
                  ok={statusQ.data?.packageInstalled ?? false}
                />
                {(statusQ.data?.files ?? []).map((f) => (
                  <StatusRow key={f.label} label={f.label} ok={f.ok} />
                ))}
              </>
            )}
          </div>
        </AddonStep>

        {/* Step 3 — Lovable prompt */}
        <AddonStep number={3} title="Use it: send this prompt to Lovable" done={false} isLast>
          <p className="text-xs text-muted-foreground mb-2">
            Everything is installed — the app's AI (Lovable) only needs to wire it into the game.
            Describe below where you want it, then copy the full prompt and paste it into Lovable.
          </p>
          <Textarea
            value={promptEnding}
            onChange={(e) => setPromptEnding(e.target.value)}
            placeholder={addon.promptPlaceholder}
            className="text-xs min-h-[60px] mb-2"
          />
          <PromptBlock text={fullPrompt} />
        </AddonStep>
      </div>
    </div>
  );
}

// ─── Small building blocks ────────────────────────────────────────────────────

function AddonStep({
  number,
  title,
  done,
  isLast,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  isLast?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold transition-colors ${
            done
              ? "border-green-500 bg-green-500 text-white"
              : "border-border bg-background text-muted-foreground"
          }`}
        >
          {done ? <Check className="w-3 h-3" /> : number}
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <div className="font-medium text-sm mb-2">{title}</div>
        {children}
      </div>
    </div>
  );
}

function PromptBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative">
      <pre className="rounded-md border border-border bg-muted p-3 pr-12 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        {text}
      </pre>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={copy}
        className="absolute top-1.5 right-1.5 h-7 px-2"
        aria-label="Copy prompt"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
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

function ConsoleLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {children}
    </a>
  );
}

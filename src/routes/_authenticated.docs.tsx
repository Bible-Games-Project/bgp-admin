import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, MousePointerClick } from "lucide-react";

export const Route = createFileRoute("/_authenticated/docs")({
  component: DocsPage,
});

function CodeBlock({ children, copyable }: { children: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative">
      <pre className="rounded-md border border-border bg-card p-4 pr-12 text-xs font-mono overflow-x-auto">
        <code>{children}</code>
      </pre>
      {copyable && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCopy}
          className="absolute top-2 right-2 h-7 px-2"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      )}
    </div>
  );
}

function SecretList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="label-mono mb-2">{title}</div>
      <ul className="space-y-1 font-mono text-xs text-muted-foreground">
        {items.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function AutomatedStep({ label, where }: { label: string; where: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2">
      <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
      <div className="min-w-0">
        <span className="text-xs font-medium">{label}</span>
        <span className="ml-2 text-[10px] font-mono text-muted-foreground">{where}</span>
      </div>
    </div>
  );
}

// ─── IAP code strings ─────────────────────────────────────────────────────────

const useIAPCode = `import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import type { Purchases as PurchasesType } from "@revenuecat/purchases-capacitor";

// ─── Configure these ──────────────────────────────────────────────────────────
export const IAP_ENTITLEMENT_ID = "premium"; // must match RevenueCat dashboard
export const RC_API_KEY_IOS     = "appl_REPLACE_WITH_YOUR_IOS_KEY";
export const RC_API_KEY_ANDROID = "goog_REPLACE_WITH_YOUR_ANDROID_KEY";
// ──────────────────────────────────────────────────────────────────────────────

export interface IAPState {
  hasPremium: boolean;
  isLoading:  boolean;
  purchase:   () => Promise<void>;
  restore:    () => Promise<void>;
}

function getApiKey(): string {
  return Capacitor.getPlatform() === "ios" ? RC_API_KEY_IOS : RC_API_KEY_ANDROID;
}

export function useIAP(): IAPState {
  const [hasPremium, setHasPremium] = useState(false);
  const [isLoading,  setIsLoading]  = useState(false);
  const purchasesRef = useRef<typeof PurchasesType | null>(null);

  const checkEntitlement = useCallback(async (Purchases: typeof PurchasesType) => {
    try {
      const { customerInfo } = await Purchases.getCustomerInfo();
      setHasPremium(IAP_ENTITLEMENT_ID in customerInfo.entitlements.active);
    } catch (e) { console.warn("[IAP] Could not get customer info:", e); }
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { Purchases } = await import("@revenuecat/purchases-capacitor");
        await Purchases.configure({ apiKey: getApiKey() });
        purchasesRef.current = Purchases;
        if (!cancelled) await checkEntitlement(Purchases);
      } catch (e) { console.warn("[IAP] Initialisation failed:", e); }
    })();
    return () => { cancelled = true; };
  }, [checkEntitlement]);

  const purchase = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    setIsLoading(true);
    try {
      const { Purchases } = await import("@revenuecat/purchases-capacitor");
      const offerings = await Purchases.getOfferings();
      const pkg = offerings.current?.availablePackages?.[0];
      if (!pkg) { console.warn("[IAP] No packages available"); return; }
      await Purchases.purchasePackage({ aPackage: pkg });
      await checkEntitlement(Purchases);
    } catch (e: unknown) {
      const err = e as { userCancelled?: boolean };
      if (!err?.userCancelled) console.error("[IAP] Purchase failed:", e);
    } finally { setIsLoading(false); }
  }, [checkEntitlement]);

  const restore = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    setIsLoading(true);
    try {
      const { Purchases } = await import("@revenuecat/purchases-capacitor");
      const { customerInfo } = await Purchases.restorePurchases();
      setHasPremium(IAP_ENTITLEMENT_ID in customerInfo.entitlements.active);
    } catch (e) { console.error("[IAP] Restore failed:", e); }
    finally { setIsLoading(false); }
  }, []);

  return { hasPremium, isLoading, purchase, restore };
}`;

const paywallCode = `// src/components/Paywall.tsx
// Style to match your app. The Restore button is MANDATORY for iOS.

interface PaywallProps {
  freeLimit:      number;
  totalStories?:  number;
  onClose:        () => void;
  onPurchase:     () => Promise<void>;
  onRestore:      () => Promise<void>; // ⚠️ Required by Apple App Store Guidelines
  isLoading:      boolean;
}

export const Paywall = ({
  freeLimit, totalStories = 100, onClose, onPurchase, onRestore, isLoading
}: PaywallProps) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4">
    <div className="relative w-full max-w-sm rounded-2xl bg-background border p-6 text-center">
      <button onClick={onClose} className="absolute top-4 right-4">✕</button>

      <h2 className="text-2xl font-bold mb-2">Unlock Full App</h2>
      <p className="text-muted-foreground text-sm mb-6">
        You've completed the first {freeLimit} items for free.
        Unlock all {totalStories}+ to continue.
      </p>

      <button onClick={() => void onPurchase()} disabled={isLoading}
        className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold mb-3 disabled:opacity-50">
        {isLoading ? "Loading…" : "Unlock Full App"}
      </button>

      {/* ⚠️ MANDATORY on iOS — required by Apple, do not remove */}
      <button onClick={() => void onRestore()} disabled={isLoading}
        className="w-full py-2 text-muted-foreground text-sm disabled:opacity-50">
        Restore previous purchase
      </button>
    </div>
  </div>
);`;

const gatePatternCode = `// In your parent component (e.g. Index.tsx / App.tsx):
import { useIAP } from "@/hooks/useIAP";
import { Paywall } from "@/components/Paywall";
import { useState } from "react";

export const FREE_LIMIT = 3; // ← how many items are free

// Inside the component:
const iap = useIAP();
const [showPaywall, setShowPaywall] = useState(false);

// Per-item check:
const isPremiumLocked = !iap.hasPremium && item.number > FREE_LIMIT;

// Click handler:
const handleClick = () => {
  if (isPremiumLocked) setShowPaywall(true);
  else startItem(item);
};

// JSX — visual indicator on locked items:
{isPremiumLocked && <GemIcon className="w-4 h-4 opacity-50" />}

// JSX — render paywall when triggered:
{showPaywall && (
  <Paywall
    freeLimit={FREE_LIMIT}
    onClose={() => setShowPaywall(false)}
    onPurchase={iap.purchase}
    onRestore={iap.restore}
    isLoading={iap.isLoading}
  />
)}`;

// ──────────────────────────────────────────────────────────────────────────────

type TopSection = "setup" | "iap";
type SetupSection = "prerequisites" | "new-app" | "reference";

function SubTabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { id: T; label: string }[];
}) {
  return (
    <div className="flex gap-1 mb-6 rounded-lg bg-muted p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
            value === t.id
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function DocsPage() {
  const [section, setSection] = useState<TopSection>("setup");
  const [setupSection, setSetupSection] = useState<SetupSection>("prerequisites");

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto w-full">
      <div className="flex gap-1 mb-8 border-b border-border">
        {(["setup", "iap"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2 ${
              section === s
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "setup" ? "Setup Guide" : "In-App Purchases"}
          </button>
        ))}
      </div>

      {section === "setup" && (
        <>
          <span className="label-mono">setup guide</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1 mb-6">
            Deploy System
          </h1>

          <SubTabs
            value={setupSection}
            onChange={setSetupSection}
            tabs={[
              { id: "prerequisites", label: "Prerequisites" },
              { id: "new-app", label: "New App" },
              { id: "reference", label: "Reference" },
            ]}
          />

          {setupSection === "prerequisites" && <SetupPrerequisites />}
          {setupSection === "new-app" && <SetupNewApp />}
          {setupSection === "reference" && <SetupReference />}
        </>
      )}

      {section === "iap" && <IAPDocs />}
    </div>
  );
}

// ─── Prerequisites ─────────────────────────────────────────────────────────────

function SetupPrerequisites() {
  return (
    <div className="space-y-8 text-sm">
      <p className="text-muted-foreground">
        Complete these steps once for the whole organization. You'll never need to repeat them
        for individual apps.
      </p>

      <div className="space-y-4">
        <div className="rounded-lg border-2 border-primary/20 bg-card p-4">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="font-display font-semibold">1.</span>
            <span className="font-display font-semibold">GitHub Personal Access Token</span>
          </div>
          <p className="text-muted-foreground text-xs mb-3">
            Create a classic PAT from your GitHub account. bgp-admin uses it to trigger
            deployments, commit assets, and create files in app repos.
          </p>
          <div className="space-y-3">
            <div className="rounded-md bg-muted p-3">
              <div className="font-medium text-xs mb-2">Where to create it</div>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground text-xs">
                <li>
                  Go to{" "}
                  <a
                    href="https://github.com/settings/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    GitHub → Settings → Developer settings → Personal access tokens → Classic
                  </a>
                </li>
                <li>Click "Generate new token (classic)"</li>
                <li>
                  Enable scopes: <code>repo</code> + <code>workflow</code>
                </li>
                <li>Generate and copy the token</li>
              </ol>
            </div>
            <div className="rounded-md bg-muted p-3">
              <div className="font-medium text-xs mb-2">Where to configure it</div>
              <p className="text-muted-foreground text-xs">
                Lovable Cloud → bgp-admin project → Settings → Environment Variables
                <br />
                Add: <code>GITHUB_PAT</code> = your token
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border-2 border-primary/20 bg-card p-4">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="font-display font-semibold">2.</span>
            <span className="font-display font-semibold">GitHub Organization Secrets (Shared)</span>
          </div>
          <p className="text-muted-foreground text-xs mb-3">
            Configure these once at organization level — all app repos inherit them automatically.
          </p>
          <div className="rounded-md bg-muted p-3 mb-3">
            <div className="font-medium text-xs mb-1">Where to add them</div>
            <p className="text-muted-foreground text-xs">
              <a
                href="https://github.com/organizations/Bible-Games-Project/settings/secrets/actions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Bible-Games-Project (org) → Settings → Secrets → Actions → New organization secret
              </a>
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-background p-3">
              <div className="font-medium text-xs mb-2">iOS (7)</div>
              <ul className="space-y-1 font-mono text-[10px] text-muted-foreground">
                <li>IOS_TEAM_ID</li>
                <li>IOS_BUILD_CERTIFICATE_BASE64</li>
                <li>IOS_P12_PASSWORD</li>
                <li>IOS_KEYCHAIN_PASSWORD</li>
                <li>APP_STORE_CONNECT_API_KEY_ID</li>
                <li>APP_STORE_CONNECT_ISSUER_ID</li>
                <li>APP_STORE_CONNECT_API_KEY_BASE64</li>
              </ul>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <div className="font-medium text-xs mb-2">Android (1)</div>
              <ul className="space-y-1 font-mono text-[10px] text-muted-foreground">
                <li>GOOGLE_PLAY_SERVICE_ACCOUNT_JSON</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="rounded-lg border-2 border-primary/20 bg-card p-4">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="font-display font-semibold">3.</span>
            <span className="font-display font-semibold">Enable Workflow Sharing</span>
          </div>
          <p className="text-muted-foreground text-xs mb-3">
            Allow app repos to call the shared workflows in bgp-admin:
          </p>
          <div className="rounded-md bg-muted p-3">
            <ol className="list-decimal pl-5 space-y-1 text-muted-foreground text-xs">
              <li>
                Go to{" "}
                <a
                  href="https://github.com/Bible-Games-Project/bgp-admin/settings/actions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  bgp-admin → Settings → Actions → General
                </a>
              </li>
              <li>Scroll to the Access section</li>
              <li>Select "Accessible from repositories in the Bible-Games-Project organization"</li>
              <li>Save</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="rounded-md bg-green-500/10 border border-green-500/20 p-3">
        <p className="text-xs text-muted-foreground">
          <strong>Done.</strong> These 3 steps cover the full organization. Adding a new app
          only needs the per-app steps in the{" "}
          <strong>New App</strong> tab.
        </p>
      </div>
    </div>
  );
}

// ─── New App ──────────────────────────────────────────────────────────────────

function AdminBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
      bgp-admin
    </span>
  );
}

function SetupNewApp() {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Follow these steps in order the first time you add a new app.
      </p>

      <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3">
        <p className="text-xs text-muted-foreground">
          <strong>The repository must be public.</strong> The deploy system uses the GitHub
          Actions API, which requires public repos.
        </p>
      </div>

      <div className="space-y-3">

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-display font-semibold text-base">1</span>
            <span className="font-medium">Create the app</span>
            <AdminBadge />
          </div>
          <p className="text-muted-foreground text-xs">
            Go to <strong>Apps → New App</strong> and fill in the slug, name, GitHub
            owner/repo, default branch, and bundle ID. The bundle ID is required for the next
            step.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-display font-semibold text-base">2</span>
            <span className="font-medium">Run Setup tab</span>
            <AdminBadge />
          </div>
          <p className="text-muted-foreground text-xs">
            Go to <strong>Apps → [app] → Setup tab</strong> and run all the steps there in
            order. This installs Capacitor, scaffolds <code>ios/</code> and{" "}
            <code>android/</code>, configures Android signing, and creates the deploy
            workflow.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="font-display font-semibold text-base">3</span>
            <span className="font-medium">Generate iOS provisioning profile</span>
          </div>
          <ol className="list-decimal pl-5 space-y-2 text-muted-foreground text-xs">
            <li>
              Go to{" "}
              <a
                href="https://developer.apple.com/account/resources/profiles/list"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Apple Developer → Profiles
              </a>
            </li>
            <li>Create new → App Store distribution</li>
            <li>Choose your App ID (or create one for this bundle ID)</li>
            <li>Select your distribution certificate → Download</li>
            <li>
              Convert: <code>base64 -i YourApp.mobileprovision | pbcopy</code>
            </li>
          </ol>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-display font-semibold text-base">4</span>
            <span className="font-medium">Set iOS secrets</span>
            <AdminBadge />
          </div>
          <p className="text-muted-foreground text-xs">
            Go to <strong>Apps → [app] → Setup tab → "Set iOS Secrets"</strong>. Upload your{" "}
            <code>.mobileprovision</code> file (downloaded from Apple Developer Portal in step
            3). We parse the profile name and team ID, generate{" "}
            <code>ExportOptions.plist</code> automatically, and set{" "}
            <code>IOS_BUILD_PROVISION_PROFILE_BASE64</code> and{" "}
            <code>IOS_EXPORT_OPTIONS_PLIST</code> as repository secrets.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-display font-semibold text-base">6</span>
            <span className="font-medium">Upload icon and splash screen</span>
            <AdminBadge />
          </div>
          <p className="text-muted-foreground text-xs">
            Go to <strong>Apps → [app] → Icon tab</strong> and{" "}
            <strong>Splash tab</strong> to upload your assets. All platform sizes are
            generated automatically and committed to the repo.
          </p>
        </div>

      </div>
    </div>
  );
}

// ─── Reference ────────────────────────────────────────────────────────────────

function SetupReference() {
  return (
    <div className="space-y-8 text-sm">
      <section>
        <h2 className="font-display font-semibold text-base mb-3">How It Works</h2>
        <p className="text-muted-foreground mb-2">
          bgp-admin hosts reusable workflows (<code>deploy-ios.yml</code>,{" "}
          <code>deploy-android.yml</code>, etc.) with all the build and signing logic. Each
          app repo only needs a thin <code>deploy.yml</code> that calls these shared workflows
          with its own secrets.
        </p>
        <p className="text-muted-foreground">
          When you hit <strong>Publicar</strong>, it triggers <code>deploy.yml</code> in the
          app repo via <code>workflow_dispatch</code>. That file then calls the centralized
          workflows with the app's specific configuration.
        </p>
      </section>

      <section>
        <h2 className="font-display font-semibold text-base mb-3">Versioning</h2>
        <div className="rounded-md border border-border bg-card p-3 space-y-1.5 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">Marketing Version (X.Y)</strong> — set in
            bgp-admin, user-visible (e.g., 1.0, 2.1)
          </p>
          <p>
            <strong className="text-foreground">Build Number</strong> — auto-incremented via{" "}
            <code>GITHUB_RUN_NUMBER</code>
          </p>
          <p>
            <strong className="text-foreground">iOS:</strong>{" "}
            <code>CFBundleShortVersionString</code> = X.Y,{" "}
            <code>CFBundleVersion</code> = X.Y.RUN_NUMBER
          </p>
          <p>
            <strong className="text-foreground">Android:</strong>{" "}
            <code>versionName</code> = X.Y.RUN_NUMBER,{" "}
            <code>versionCode</code> = RUN_NUMBER
          </p>
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold text-base mb-3">Common Errors</h2>
        <div className="space-y-2">
          <div className="rounded-md border border-border bg-card p-3">
            <div className="font-medium text-xs mb-1">422 workflow was not found</div>
            <p className="text-muted-foreground text-xs">
              <code>deploy.yml</code> is missing in the app repo, or the branch/filename
              doesn't match.
            </p>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <div className="font-medium text-xs mb-1">404 Not Found</div>
            <p className="text-muted-foreground text-xs">
              Wrong <code>owner/repo</code> in bgp-admin, repo is private (must be public),
              or <code>GITHUB_PAT</code> doesn't have access.
            </p>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <div className="font-medium text-xs mb-1">403 Forbidden</div>
            <p className="text-muted-foreground text-xs">
              <code>GITHUB_PAT</code> lacks <code>repo</code> or <code>workflow</code> scope.
              Use a classic PAT with both scopes.
            </p>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <div className="font-medium text-xs mb-1">Android signing failed</div>
            <p className="text-muted-foreground text-xs">
              <code>KEY_ALIAS</code> secret doesn't match the alias inside the{" "}
              <code>ANDROID_KEYSTORE</code> .jks file.
            </p>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <div className="font-medium text-xs mb-1">iOS provisioning profile mismatch</div>
            <p className="text-muted-foreground text-xs">
              Bundle ID in the provisioning profile doesn't match the app's bundle ID in{" "}
              <code>capacitor.config.ts</code>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── IAP Docs ─────────────────────────────────────────────────────────────────

function IAPDocs() {
  const [doc, setDoc] = useState<"native" | "web">("native");
  return (
    <div>
      <span className="label-mono">in-app purchases</span>
      <h1 className="text-2xl font-display font-semibold tracking-tight mt-1 mb-4">
        IAP — RevenueCat Integration
      </h1>

      <SubTabs
        value={doc}
        onChange={setDoc}
        tabs={[
          { id: "native", label: "1. Native Implementation" },
          { id: "web", label: "2. Web Integration (Lovable)" },
        ]}
      />

      {doc === "native" && <IAPNativeDocs />}
      {doc === "web" && <IAPWebDocs />}
    </div>
  );
}

function IAPNativeDocs() {
  return (
    <div className="space-y-6 text-sm">
      <section>
        <p className="text-muted-foreground mb-4">
          One-time setup to add RevenueCat-powered IAP to a Capacitor app. Run these steps
          in the app's repository, not in Lovable.
        </p>
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg mb-3">📦 1. Install the Plugin</h2>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-muted-foreground mb-3 text-xs">Run in the app repo root:</p>
          <CodeBlock copyable>npm install @revenuecat/purchases-capacitor</CodeBlock>
          <p className="text-muted-foreground mt-3 text-xs">
            Then sync native projects: <code>npx cap sync</code>
          </p>
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg mb-3">⚙️ 2. RevenueCat Dashboard</h2>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="font-medium text-xs mb-3">
              Steps at{" "}
              <a
                href="https://dashboard.revenuecat.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                dashboard.revenuecat.com
              </a>
              :
            </div>
            <ol className="list-decimal pl-5 space-y-2 text-muted-foreground text-xs">
              <li>Create a new <strong>Project</strong></li>
              <li>
                Add an <strong>iOS App</strong> and an <strong>Android App</strong> — copy
                each SDK key into <code>RC_API_KEY_IOS</code> /{" "}
                <code>RC_API_KEY_ANDROID</code>
              </li>
              <li>
                Under <strong>Entitlements</strong>, create one called <code>premium</code>
              </li>
              <li>
                Under <strong>Products</strong>, add your App Store / Play Store product IDs
                and attach them to the <code>premium</code> entitlement
              </li>
              <li>
                Under <strong>Offerings</strong>, create a <code>default</code> offering and
                add a package containing your product
              </li>
            </ol>
          </div>
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3">
            <p className="text-xs text-muted-foreground">
              <strong>Before testing:</strong> the in-app purchase product must be created and
              approved in App Store Connect (iOS) or Google Play Console (Android).
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg mb-3">🪝 3. useIAP Hook</h2>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-muted-foreground mb-3 text-xs">
            Create <code>src/hooks/useIAP.ts</code> and replace the API key placeholders:
          </p>
          <CodeBlock copyable>{useIAPCode}</CodeBlock>
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg mb-3">🎨 4. Paywall Component</h2>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-muted-foreground mb-3 text-xs">
            Create <code>src/components/Paywall.tsx</code>:
          </p>
          <CodeBlock copyable>{paywallCode}</CodeBlock>
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg mb-3">✅ Checklist</h2>
        <div className="rounded-lg border border-border bg-card p-4">
          <ul className="space-y-2 text-xs text-muted-foreground">
            {[
              "npm install @revenuecat/purchases-capacitor",
              "RevenueCat project created with iOS + Android apps",
              "Entitlement 'premium' created in RevenueCat dashboard",
              "Products linked to the entitlement",
              "Default offering with at least one package",
              "RC_API_KEY_IOS and RC_API_KEY_ANDROID filled in useIAP.ts",
              "npx cap sync run after install",
              "Paywall.tsx created with Restore button (Apple requirement)",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-0.5 text-muted-foreground">☐</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function IAPWebDocs() {
  return (
    <div className="space-y-6 text-sm">
      <section>
        <p className="text-muted-foreground mb-4">
          This guide covers wiring up the IAP gate in the web layer — the React code managed
          in Lovable. Paste the relevant sections below into a Lovable prompt.
        </p>
        <div className="rounded-md bg-blue-500/10 border border-blue-500/20 p-3">
          <div className="flex gap-2">
            <span className="text-blue-600 dark:text-blue-400">ℹ️</span>
            <p className="text-xs text-muted-foreground">
              <strong>In the browser</strong> (Lovable preview),{" "}
              <code>Capacitor.isNativePlatform()</code> returns <code>false</code>, so{" "}
              <code>hasPremium</code> is always <code>false</code>. To preview the paywall
              UI, temporarily pass <code>hasPremium={"{"}true{"}"}</code> as a prop.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg mb-3">🔒 Gate Pattern</h2>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-muted-foreground mb-3 text-xs">
            Add to the parent component that renders your list of items:
          </p>
          <CodeBlock copyable>{gatePatternCode}</CodeBlock>
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg mb-3">🎯 Visual Lock Indicator</h2>
        <div className="rounded-lg border border-border bg-card p-4">
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              Lock icon: <code>import {'{ Lock }'} from "lucide-react"</code>
            </li>
            <li>
              Premium feel: <code>import {'{ Gem }'} from "lucide-react"</code>
            </li>
            <li>Dim the card: add <code>opacity-50</code> or a muted border</li>
            <li>
              Style: <code>isPremiumLocked ? "bg-muted" : "bg-card"</code>
            </li>
          </ul>
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg mb-3">🧪 Testing</h2>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="font-medium text-xs mb-2">Browser (Lovable)</div>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
              <li>Native IAP is inactive — test paywall UI by temporarily hardcoding <code>hasPremium={"{"}false{"}"}</code></li>
              <li>Verify Paywall renders and closes correctly</li>
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="font-medium text-xs mb-2">Physical Device (TestFlight / Play Internal)</div>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
              <li>Use a RevenueCat sandbox account</li>
              <li>Verify purchase completes and <code>hasPremium</code> flips to <code>true</code></li>
              <li>Verify Restore button restores the entitlement</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

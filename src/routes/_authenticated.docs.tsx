import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/docs")({
  component: DocsPage,
});

const deployYml = `name: Deploy App

on:
  workflow_dispatch:

jobs:
  ios:
    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-ios.yml@main
    secrets: inherit

  android:
    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-android.yml@main
    secrets: inherit
`;

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

function DocsPage() {
  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto w-full">
      <span className="label-mono">how it works</span>
      <h1 className="text-2xl font-display font-semibold tracking-tight mt-1 mb-6">Docs</h1>

      <div className="space-y-10 text-sm">
        <section>
          <h2 className="font-display font-semibold text-base mb-2">Architecture</h2>
          <p className="text-muted-foreground">
            This admin hosts the reusable workflows (
            <code>deploy-ios.yml</code>, <code>deploy-android.yml</code>). Each game repo only
            ships a thin <code>deploy.yml</code> that calls them. Hitting{" "}
            <strong>Publicar</strong> in the console triggers that <code>deploy.yml</code> via
            the GitHub API (<code>workflow_dispatch</code>) — reusable workflows can't be
            dispatched directly, that's why every repo needs this one file.
          </p>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">
            Required workflow in the app repo
          </h2>
          <p className="text-muted-foreground mb-2">
            Create <code>.github/workflows/deploy.yml</code> with exactly this content (copy
            button on the right):
          </p>
          <CodeBlock copyable>{deployYml}</CodeBlock>
          <p className="text-muted-foreground mt-3 text-xs">
            Same file for every game — no per-app edits required. Bundle id / package name /
            play track live inside the reusable workflows or are derived from the repo.
          </p>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">
            Required repository secrets
          </h2>
          <p className="text-muted-foreground mb-3">
            In the app repo, under <code>Settings → Secrets and variables → Actions</code>,
            configure these <strong>5 secrets</strong>:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <SecretList
              title="iOS (2)"
              items={["IOS_BUILD_PROVISION_PROFILE_BASE64", "IOS_EXPORT_OPTIONS_PLIST"]}
            />
            <SecretList
              title="Android (3)"
              items={["ANDROID_KEYSTORE", "KEYSTORE_PASSWORD", "KEY_ALIAS"]}
            />
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            One keystore per app. <code>ANDROID_KEYSTORE</code> is the <code>.jks</code> in
            base64. Keep the original <code>.jks</code> backed up — losing it means you can
            never update that app on Play Store again.
          </p>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">
            Organization secrets (shared, set once)
          </h2>
          <p className="text-muted-foreground mb-3">
            Configured once at{" "}
            <code>Bible-Games-Project → Settings → Secrets → Actions</code> and inherited by
            every repo:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <SecretList
              title="iOS (6)"
              items={[
                "IOS_BUILD_CERTIFICATE_BASE64",
                "IOS_P12_PASSWORD",
                "IOS_KEYCHAIN_PASSWORD",
                "APP_STORE_CONNECT_API_KEY_ID",
                "APP_STORE_CONNECT_ISSUER_ID",
                "APP_STORE_CONNECT_API_KEY_BASE64",
              ]}
            />
            <SecretList
              title="Android (1)"
              items={["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"]}
            />
          </div>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">Adding a new app</h2>
          <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
            <li>
              In <code>Apps → New app</code>, set slug, name, GitHub owner/repo and default
              branch.
            </li>
            <li>
              In the app repo, drop the <code>deploy.yml</code> above into
              <code> .github/workflows/</code>.
            </li>
            <li>Generate a unique keystore for the app and configure the 5 repo secrets.</li>
            <li>
              Hit <strong>Publicar</strong> on the app page.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">GitHub permissions</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>
              <code>GITHUB_PAT</code> in this backend must be a fine-grained PAT with{" "}
              <code>Actions: Read &amp; Write</code> on every app repo.
            </li>
            <li>
              Since <code>bgp-admin</code> is private, under{" "}
              <code>Settings → Actions → General → Access</code> allow it to be used by other
              repos in the org so the reusable workflows resolve.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">Common errors</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
            <li>
              <strong>422 workflow was not found</strong>: <code>deploy.yml</code> missing in
              the app repo, or the workflow file name configured in the app doesn't match.
            </li>
            <li>
              <strong>404</strong>: wrong <code>owner/repo</code> or PAT has no access.
            </li>
            <li>
              <strong>403</strong>: PAT lacks <code>Actions: Write</code>.
            </li>
            <li>
              <strong>Android signing failed</strong>: <code>KEY_ALIAS</code> doesn't match
              the alias inside <code>ANDROID_KEYSTORE</code>.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

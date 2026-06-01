import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/docs")({
  component: DocsPage,
});

const iosYml = `name: Deploy iOS
on:
  workflow_dispatch:
    inputs:
      ref:
        description: Branch or tag
        required: false
        default: main

jobs:
  ios:
    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-ios.yml@main
    with:
      bundle-id: com.biblegames.eden
    secrets: inherit
`;

const androidYml = `name: Deploy Android
on:
  workflow_dispatch:
    inputs:
      ref:
        description: Branch or tag
        required: false
        default: main

jobs:
  android:
    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-android.yml@main
    with:
      package-name: com.biblegames.eden
      play-track: internal
    secrets: inherit
`;

function Code({ children }: { children: string }) {
  return (
    <pre className="rounded-md border border-border bg-card p-4 text-xs font-mono overflow-x-auto">
      <code>{children}</code>
    </pre>
  );
}

function DocsPage() {
  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto w-full prose-sm">
      <span className="label-mono">how it works</span>
      <h1 className="text-2xl font-display font-semibold tracking-tight mt-1 mb-6">Docs</h1>

      <div className="space-y-8 text-sm">
        <section>
          <h2 className="font-display font-semibold text-base mb-2">Architecture</h2>
          <p className="text-muted-foreground">
            This admin owns the reusable GitHub Actions workflows (
            <code>.github/workflows/deploy-ios.yml</code> and{" "}
            <code>.github/workflows/deploy-android.yml</code>) and a registry of apps. Each app
            repo only contains a thin caller workflow that points at this admin's reusable
            workflow. Triggering a deploy from the console fires the caller via the GitHub API.
          </p>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">Adding a new app</h2>
          <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
            <li>
              Go to <code>Apps → New app</code> and fill in: slug, name, GitHub owner/repo,
              iOS bundle id and Android package name.
            </li>
            <li>
              In the app's GitHub repository, create the two caller workflows shown below.
            </li>
            <li>
              Add the required secrets (see below) to that repo.
            </li>
            <li>
              Go to <code>Deploy</code>, pick the app, choose platform(s) and hit deploy.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">
            Required files in the app repo
          </h2>
          <p className="text-muted-foreground mb-2">
            <code>.github/workflows/deploy-ios.yml</code>:
          </p>
          <Code>{iosYml}</Code>
          <p className="text-muted-foreground mt-3 mb-2">
            <code>.github/workflows/deploy-android.yml</code>:
          </p>
          <Code>{androidYml}</Code>
          <p className="text-muted-foreground mt-3">
            Change <code>bundle-id</code> / <code>package-name</code> to match the app.
          </p>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">Secrets in the app repo</h2>
          <p className="text-muted-foreground mb-2">
            Configure under <code>Settings → Secrets and variables → Actions</code>:
          </p>
          <div className="grid md:grid-cols-2 gap-4 text-xs">
            <div className="rounded-md border border-border bg-card p-3">
              <div className="label-mono mb-2">iOS</div>
              <ul className="space-y-1 font-mono text-muted-foreground">
                <li>APPLE_ID</li>
                <li>APPLE_APP_SPECIFIC_PASSWORD</li>
                <li>BUILD_CERTIFICATE_BASE64</li>
                <li>P12_PASSWORD</li>
                <li>PROVISIONING_PROFILE_BASE64</li>
                <li>KEYCHAIN_PASSWORD</li>
              </ul>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <div className="label-mono mb-2">Android</div>
              <ul className="space-y-1 font-mono text-muted-foreground">
                <li>ANDROID_KEYSTORE (base64)</li>
                <li>KEYSTORE_PASSWORD</li>
                <li>KEY_ALIAS</li>
                <li>GOOGLE_PLAY_SERVICE_ACCOUNT_JSON</li>
              </ul>
            </div>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            Check the exact list against{" "}
            <code>.github/workflows/deploy-ios.yml</code> and{" "}
            <code>deploy-android.yml</code> in this repo, since they declare the
            <code> secrets:</code> they require.
          </p>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">GitHub permissions</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>
              The <code>GITHUB_PAT</code> stored in this backend must be a fine-grained PAT
              with <code>Actions: Read &amp; Write</code> on every app repo.
            </li>
            <li>
              If <code>bgp-admin</code> is private, go to{" "}
              <code>Settings → Actions → General → Access</code> and allow it to be used by
              other repositories in the org so the reusable workflows can be called.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display font-semibold text-base mb-2">Common errors</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
            <li>
              <strong>422 workflow was not found</strong>: the caller workflow doesn't exist
              in the app repo, or the file name in the app registry doesn't match.
            </li>
            <li>
              <strong>404</strong>: wrong <code>owner/repo</code>, or PAT has no access.
            </li>
            <li>
              <strong>403</strong>: PAT lacks <code>Actions: Write</code> scope.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

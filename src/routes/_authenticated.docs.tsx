import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/docs")({
  component: DocsPage,
});

const deployYml = `name: Deploy App

on:
  push:
    branches: [deploy-app]
  pull_request:
    branches: [main]
    types: [closed]
  workflow_dispatch:
    inputs:
      deploy_ios:
        description: "Deploy iOS"
        type: boolean
        default: false
      deploy_android:
        description: "Deploy Android"
        type: boolean
        default: false

jobs:
  ios:
    if: |
      github.ref == 'refs/heads/deploy-app' ||
      (github.event_name == 'pull_request' && github.event.pull_request.merged == true) ||
      (github.event_name == 'workflow_dispatch' && inputs.deploy_ios == true)
    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-ios.yml@main
    secrets:
      IOS_BUILD_CERTIFICATE_BASE64: \${{ secrets.IOS_BUILD_CERTIFICATE_BASE64 }}
      IOS_P12_PASSWORD: \${{ secrets.IOS_P12_PASSWORD }}
      IOS_BUILD_PROVISION_PROFILE_BASE64: \${{ secrets.IOS_BUILD_PROVISION_PROFILE_BASE64 }}
      IOS_KEYCHAIN_PASSWORD: \${{ secrets.IOS_KEYCHAIN_PASSWORD }}
      IOS_EXPORT_OPTIONS_PLIST: \${{ secrets.IOS_EXPORT_OPTIONS_PLIST }}
      APP_STORE_CONNECT_API_KEY_ID: \${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}
      APP_STORE_CONNECT_ISSUER_ID: \${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
      APP_STORE_CONNECT_API_KEY_BASE64: \${{ secrets.APP_STORE_CONNECT_API_KEY_BASE64 }}

  android:
    if: |
      github.ref == 'refs/heads/deploy-app' ||
      (github.event_name == 'pull_request' && github.event.pull_request.merged == true) ||
      (github.event_name == 'workflow_dispatch' && inputs.deploy_android == true)
    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-android.yml@main
    with:
      package-name: com.your.package.name    # ← CHANGE THIS
    secrets:
      ANDROID_KEYSTORE: \${{ secrets.ANDROID_KEYSTORE }}
      KEYSTORE_PASSWORD: \${{ secrets.KEYSTORE_PASSWORD }}
      KEY_ALIAS: \${{ secrets.KEY_ALIAS }}
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: \${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}

  notify:
    needs: [ios, android]
    if: always() && (needs.ios.result == 'success' || needs.android.result == 'success')
    uses: Bible-Games-Project/bgp-admin/.github/workflows/notify-telegram.yml@main
    with:
      app-name: "Your App Name"              # ← CHANGE THIS
    secrets:
      TELEGRAM_BOT_TOKEN: \${{ secrets.TELEGRAM_BOT_TOKEN }}
      TELEGRAM_CHAT_ID: \${{ secrets.TELEGRAM_CHAT_ID }}

  tag:
    needs: [ios, android]
    if: always() && (needs.ios.result == 'success' || needs.android.result == 'success')
    uses: Bible-Games-Project/bgp-admin/.github/workflows/tag-release.yml@main
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
      <span className="label-mono">setup guide</span>
      <h1 className="text-2xl font-display font-semibold tracking-tight mt-1 mb-6">
        How to Add a New App
      </h1>

      <div className="space-y-8 text-sm">
        <section>
          <p className="text-muted-foreground mb-6">
            This guide walks you through adding a new Capacitor app to the Bible Games Project
            deployment system. Follow these steps in order for a complete setup.
          </p>
        </section>

        <section>
          <h2 className="font-display font-semibold text-lg mb-3">
            📋 Prerequisites (One-Time Setup)
          </h2>
          <p className="text-muted-foreground mb-4">
            Before adding your first app, complete these organization-level configurations.
            You only need to do this <strong>once</strong> for the entire organization:
          </p>

          <div className="space-y-4">
            {/* GITHUB_PAT */}
            <div className="rounded-lg border-2 border-primary/20 bg-card p-4">
              <div className="flex items-baseline gap-2 mb-3">
                <div className="font-display font-semibold">1.</div>
                <div className="font-display font-semibold">GitHub Personal Access Token</div>
              </div>
              <p className="text-muted-foreground text-xs mb-3">
                Create a personal access token (PAT) from your GitHub account to allow
                bgp-admin to trigger deployments and manage assets.
              </p>
              <div className="space-y-3">
                <div className="rounded-md bg-muted p-3">
                  <div className="font-medium text-xs mb-2">📍 Where to create it:</div>
                  <ol className="list-decimal pl-5 space-y-1 text-muted-foreground text-xs">
                    <li>
                      Go to{" "}
                      <a
                        href="https://github.com/settings/tokens?type=beta"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        GitHub → Settings → Developer settings → Fine-grained tokens
                      </a>
                    </li>
                    <li>Click "Generate new token"</li>
                    <li>
                      <strong>Repository access:</strong> Select only your app repositories
                      (e.g., eden-choice-chronicles)
                    </li>
                    <li>
                      <strong>Permissions:</strong>
                      <ul className="list-disc pl-5 mt-1">
                        <li>Actions: Read & Write (trigger deployments)</li>
                        <li>Contents: Read & Write (commit icon/splash assets)</li>
                      </ul>
                    </li>
                    <li>Set an expiration date</li>
                    <li>Generate and copy the token</li>
                  </ol>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <div className="font-medium text-xs mb-2">⚙️ Where to configure it:</div>
                  <p className="text-muted-foreground text-xs">
                    Go to{" "}
                    <a
                      href="https://lovable.dev"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Lovable Cloud
                    </a>{" "}
                    → bgp-admin project → Settings → Environment Variables
                    <br />
                    Add: <code className="text-xs">GITHUB_PAT</code> = your token
                  </p>
                </div>
              </div>
            </div>

            {/* Organization Secrets */}
            <div className="rounded-lg border-2 border-primary/20 bg-card p-4">
              <div className="flex items-baseline gap-2 mb-3">
                <div className="font-display font-semibold">2.</div>
                <div className="font-display font-semibold">
                  GitHub Organization Secrets (Shared)
                </div>
              </div>
              <p className="text-muted-foreground text-xs mb-3">
                Configure these secrets once at organization level. All app repositories will
                inherit them automatically.
              </p>
              <div className="space-y-3">
                <div className="rounded-md bg-muted p-3">
                  <div className="font-medium text-xs mb-2">
                    📍 Where to configure them:
                  </div>
                  <p className="text-muted-foreground text-xs">
                    <a
                      href="https://github.com/organizations/Bible-Games-Project/settings/secrets/actions"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      GitHub → Bible-Games-Project (org) → Settings → Secrets → Actions →
                      New organization secret
                    </a>
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  <div className="rounded-md border border-border bg-background p-3">
                    <div className="font-medium text-xs mb-2">iOS Secrets (7)</div>
                    <ul className="space-y-1 font-mono text-[10px] text-muted-foreground">
                      <li>• IOS_TEAM_ID</li>
                      <li>• IOS_BUILD_CERTIFICATE_BASE64</li>
                      <li>• IOS_P12_PASSWORD</li>
                      <li>• IOS_KEYCHAIN_PASSWORD</li>
                      <li>• APP_STORE_CONNECT_API_KEY_ID</li>
                      <li>• APP_STORE_CONNECT_ISSUER_ID</li>
                      <li>• APP_STORE_CONNECT_API_KEY_BASE64</li>
                    </ul>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <div className="font-medium text-xs mb-2">Android Secrets (1)</div>
                    <ul className="space-y-1 font-mono text-[10px] text-muted-foreground">
                      <li>• GOOGLE_PLAY_SERVICE_ACCOUNT_JSON</li>
                    </ul>
                  </div>
                </div>

                <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3">
                  <div className="flex gap-2">
                    <span className="text-amber-600 dark:text-amber-400">💡</span>
                    <div className="text-xs text-muted-foreground">
                      <strong>Quick guide:</strong>
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>
                          <strong>IOS_TEAM_ID:</strong> Find in App Store Connect →
                          Membership (10 chars)
                        </li>
                        <li>
                          <strong>Certificate & P12:</strong> Download from Apple Developer
                          Portal, export as .p12 with password
                        </li>
                        <li>
                          <strong>App Store Connect API:</strong> Create key in App Store
                          Connect → Users → Keys
                        </li>
                        <li>
                          <strong>Google Play:</strong> Create service account in Google
                          Cloud Console, grant access in Play Console
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Workflow Access */}
            <div className="rounded-lg border-2 border-primary/20 bg-card p-4">
              <div className="flex items-baseline gap-2 mb-3">
                <div className="font-display font-semibold">3.</div>
                <div className="font-display font-semibold">Enable Workflow Sharing</div>
              </div>
              <p className="text-muted-foreground text-xs mb-3">
                Allow app repositories to use the shared workflows from bgp-admin:
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
                      bgp-admin repo → Settings → Actions → General
                    </a>
                  </li>
                  <li>
                    Scroll to <strong>Access</strong> section
                  </li>
                  <li>
                    Select: "Accessible from repositories in the Bible-Games-Project
                    organization"
                  </li>
                  <li>Save</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-md bg-green-500/10 border border-green-500/20 p-3">
            <div className="flex gap-2">
              <span className="text-green-600 dark:text-green-400">✅</span>
              <p className="text-xs text-muted-foreground">
                <strong>Once these 3 steps are complete,</strong> you're ready to add as
                many apps as you want. Each new app only needs the app-specific configuration
                from the steps below.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-display font-semibold text-lg mb-3">
            🚀 Step-by-Step: Adding a New App
          </h2>

          <div className="space-y-6">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <div className="font-display font-semibold text-base">Step 1</div>
                <div className="font-medium">Setup Capacitor in your project</div>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                Initialize Capacitor and add iOS/Android platforms to your app:
              </p>
              <CodeBlock>{`# Install Capacitor
bun add @capacitor/core @capacitor/cli @capacitor/assets

# Initialize (creates capacitor.config.ts)
bunx cap init "Your App Name" "com.biblegames.yourapp"

# Add platforms
bunx cap add ios
bunx cap add android

# Create assets directory for icon and splash screen
mkdir -p assets

# Build and sync
bun run build
bunx cap sync`}</CodeBlock>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <div className="font-display font-semibold text-base">Step 2</div>
                <div className="font-medium">Configure Android signing</div>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                In <code>android/app/build.gradle</code>, add signing configuration above{" "}
                <code>android {"{"}</code>:
              </p>
              <CodeBlock>{`def keystorePropertiesFile = rootProject.file("key.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}`}</CodeBlock>
              <p className="text-muted-foreground mt-3 mb-2 text-xs">
                And inside <code>android {"{ ... }"}</code>:
              </p>
              <CodeBlock>{`signingConfigs {
    release {
        if (keystorePropertiesFile.exists()) {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
        }
    }
}

buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
    }
}`}</CodeBlock>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <div className="font-display font-semibold text-base">Step 3</div>
                <div className="font-medium">Generate Android keystore</div>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                Create a unique keystore for this app. ⚠️ Back up the .jks file securely —
                losing it means you can never update the app on Google Play.
              </p>
              <CodeBlock>{`keytool -genkey -v -keystore your-app-release.jks \\
  -keyalg RSA -keysize 2048 -validity 10000 \\
  -alias your-app-alias

# Convert to base64 for GitHub secret
base64 -i your-app-release.jks | pbcopy`}</CodeBlock>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <div className="font-display font-semibold text-base">Step 4</div>
                <div className="font-medium">Generate iOS provisioning profile</div>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                Create a provisioning profile for your app's bundle ID:
              </p>
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
                <li>Click + to create new profile</li>
                <li>Select "App Store" distribution type</li>
                <li>Choose your App ID (or create one for your bundle ID)</li>
                <li>Select your distribution certificate</li>
                <li>Download the .mobileprovision file</li>
                <li>
                  Convert to base64: <code>base64 -i YourApp.mobileprovision | pbcopy</code>
                </li>
              </ol>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <div className="font-display font-semibold text-base">Step 5</div>
                <div className="font-medium">Create iOS ExportOptions.plist</div>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                Create an export options file for your app and convert to base64:
              </p>
              <CodeBlock>{`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>teamID</key>
    <string>YOUR_TEAM_ID</string>
    <key>provisioningProfiles</key>
    <dict>
        <key>com.biblegames.yourapp</key>
        <string>YourApp AppStore Profile</string>
    </dict>
</dict>
</plist>

# Convert to base64
base64 -i ExportOptions.plist | pbcopy`}</CodeBlock>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <div className="font-display font-semibold text-base">Step 6</div>
                <div className="font-medium">Configure repository secrets</div>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                Go to your app repo → Settings → Secrets and variables → Actions → New
                repository secret. Add these 5 secrets:
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <SecretList
                  title="iOS (2)"
                  items={["IOS_BUILD_PROVISION_PROFILE_BASE64", "IOS_EXPORT_OPTIONS_PLIST"]}
                />
                <SecretList
                  title="Android (3)"
                  items={["ANDROID_KEYSTORE", "KEYSTORE_PASSWORD", "KEY_ALIAS"]}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <div className="font-display font-semibold text-base">Step 7</div>
                <div className="font-medium">Add deploy workflow to your repo</div>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                Create <code>.github/workflows/deploy.yml</code> in your app repo. Update the
                2 values marked with ← CHANGE THIS:
              </p>
              <CodeBlock copyable>{deployYml}</CodeBlock>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <div className="font-display font-semibold text-base">Step 8</div>
                <div className="font-medium">Register the app in bgp-admin</div>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                In this admin panel, go to Apps → New app and fill in:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
                <li>
                  <strong>Slug:</strong> Unique identifier (lowercase, numbers, dashes)
                </li>
                <li>
                  <strong>Name:</strong> Display name of the app
                </li>
                <li>
                  <strong>GitHub Owner:</strong> Organization or username (e.g.,
                  Bible-Games-Project)
                </li>
                <li>
                  <strong>GitHub Repo:</strong> Repository name
                </li>
                <li>
                  <strong>Default Branch:</strong> Usually "main"
                </li>
                <li>
                  <strong>Marketing Version:</strong> X.Y format (e.g., 1.0) — this is the
                  user-visible version
                </li>
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <div className="font-display font-semibold text-base">Step 9</div>
                <div className="font-medium">Configure app icon and splash screen</div>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                In the bgp-admin panel, go to your app's detail page and use the{" "}
                <strong>Icon</strong> and <strong>Splash</strong> tabs to upload your assets:
              </p>
              <div className="space-y-3">
                <div className="rounded-md border border-border bg-muted p-3">
                  <div className="font-medium text-xs mb-2">Icon Tab</div>
                  <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
                    <li>Upload a square PNG image (recommended: 1024×1024px minimum)</li>
                    <li>
                      Optionally upload a dark mode variant for adaptive theming
                    </li>
                    <li>
                      All required iOS and Android icon sizes will be generated automatically
                    </li>
                  </ul>
                </div>
                <div className="rounded-md border border-border bg-muted p-3">
                  <div className="font-medium text-xs mb-2">Splash Tab</div>
                  <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
                    <li>Upload a square splash screen image (recommended: 2732×2732px)</li>
                    <li>Choose background colors for light and dark modes</li>
                    <li>
                      Optionally upload a dark mode variant
                    </li>
                    <li>
                      All required splash screen sizes will be generated for both platforms
                    </li>
                  </ul>
                </div>
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                ✨ The system will automatically clone your repo, save the images to the{" "}
                <code>assets/</code> folder, run <code>@capacitor/assets</code> to generate
                all sizes, commit the changes, and push them to GitHub.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <div className="font-display font-semibold text-base">Step 10</div>
                <div className="font-medium">Test deployment</div>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                From the app's detail page in bgp-admin, click <strong>Publicar</strong>. This
                will trigger the deploy.yml workflow via GitHub API.
              </p>
              <p className="text-muted-foreground text-xs">
                Monitor the deployment progress in your GitHub repo under Actions tab. The
                workflow will:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs mt-2">
                <li>Build and sign iOS app</li>
                <li>Upload to App Store Connect (TestFlight)</li>
                <li>Build and sign Android app</li>
                <li>Upload to Google Play (internal testing track)</li>
                <li>Create a git tag with the version</li>
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-display font-semibold text-lg mb-3">🏗️ How It Works</h2>
          <p className="text-muted-foreground mb-3">
            This admin hosts reusable workflows (<code>deploy-ios.yml</code>,{" "}
            <code>deploy-android.yml</code>, etc.) that contain all the build and deployment
            logic. Each app repo only needs a thin <code>deploy.yml</code> that calls these
            shared workflows.
          </p>
          <p className="text-muted-foreground">
            When you hit <strong>Publicar</strong> in this console, it triggers the{" "}
            <code>deploy.yml</code> in your app repo via GitHub API (
            <code>workflow_dispatch</code>). That file then calls the centralized workflows with
            your app's specific secrets and configuration.
          </p>
        </section>

        <section>
          <h2 className="font-display font-semibold text-lg mb-3">📦 Versioning Strategy</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
            <li>
              <strong>Marketing Version (X.Y):</strong> User-visible version set in bgp-admin
              (e.g., 1.0, 2.1)
            </li>
            <li>
              <strong>Build Number:</strong> Auto-incremented using{" "}
              <code>GITHUB_RUN_NUMBER</code>
            </li>
            <li>
              <strong>iOS:</strong> <code>CFBundleShortVersionString</code> = X.Y,{" "}
              <code>CFBundleVersion</code> = X.Y.RUN_NUMBER
            </li>
            <li>
              <strong>Android:</strong> <code>versionName</code> = X.Y.RUN_NUMBER,{" "}
              <code>versionCode</code> = RUN_NUMBER
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display font-semibold text-lg mb-3">⚠️ Common Errors</h2>
          <div className="space-y-2">
            <div className="rounded-md border border-border bg-card p-3">
              <div className="font-medium text-xs mb-1">422 workflow was not found</div>
              <p className="text-muted-foreground text-xs">
                <code>deploy.yml</code> is missing in the app repo, or the branch/file name
                doesn't match the configuration.
              </p>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <div className="font-medium text-xs mb-1">404 Not Found</div>
              <p className="text-muted-foreground text-xs">
                Wrong <code>owner/repo</code> in bgp-admin, or <code>GITHUB_PAT</code> doesn't
                have access to the repository.
              </p>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <div className="font-medium text-xs mb-1">403 Forbidden</div>
              <p className="text-muted-foreground text-xs">
                <code>GITHUB_PAT</code> lacks <code>Actions: Read & Write</code> permission.
              </p>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <div className="font-medium text-xs mb-1">Android signing failed</div>
              <p className="text-muted-foreground text-xs">
                <code>KEY_ALIAS</code> secret doesn't match the actual alias inside the{" "}
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

        <section className="pt-4 border-t border-border">
          <div className="rounded-md bg-blue-500/10 border border-blue-500/20 p-3">
            <div className="flex gap-2">
              <span className="text-blue-600 dark:text-blue-400">💬</span>
              <p className="text-xs text-muted-foreground">
                <strong>Need help?</strong> This guide covers the complete setup process. If
                you encounter issues, check the Common Errors section above or review your
                GitHub Actions logs for detailed error messages.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

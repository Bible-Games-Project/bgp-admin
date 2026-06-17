import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

async function loadApp(supabase: any, appId: string) {
  const { data, error } = await supabase
    .from("apps")
    .select("*")
    .eq("id", appId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("App not found");
  return data;
}

function githubHeaders() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_PAT not configured");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bgp-admin-capacitor",
  };
}

export const checkCapacitorStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const branch = app.default_ref || "main";
    const base = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents`;

    const checkPath = async (path: string) => {
      const res = await fetch(`${base}/${path}?ref=${encodeURIComponent(branch)}`, {
        headers: githubHeaders(),
      });
      return res.ok;
    };

    const [hasTsConfig, hasJsonConfig, hasIos, hasAndroid] = await Promise.all([
      checkPath("capacitor.config.ts"),
      checkPath("capacitor.config.json"),
      checkPath("ios"),
      checkPath("android"),
    ]);

    return {
      hasConfig: hasTsConfig || hasJsonConfig,
      hasIos,
      hasAndroid,
    };
  });

export const checkAndroidKeystoreSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const base = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/actions/secrets`;
    const [r1, r2, r3] = await Promise.all([
      fetch(`${base}/ANDROID_KEYSTORE`, { headers: githubHeaders() }),
      fetch(`${base}/KEYSTORE_PASSWORD`, { headers: githubHeaders() }),
      fetch(`${base}/KEY_ALIAS`, { headers: githubHeaders() }),
    ]);
    return { configured: r1.ok && r2.ok && r3.ok };
  });

export const generateAndroidKeystoreSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);

    const password = randomBytes(16).toString("hex");
    const alias = "release";
    const dispatchedAt = new Date().toISOString();

    const workflowUrl = `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/workflows/generate-android-keystore.yml/dispatches`;
    const workflowRes = await fetch(workflowUrl, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          github_owner: app.github_owner,
          github_repo: app.github_repo,
          app_name: app.name,
          pat: process.env.GITHUB_PAT ?? "",
          password,
          alias,
        },
      }),
    });

    if (!workflowRes.ok) {
      const text = await workflowRes.text();
      throw new Error(`Failed to trigger keystore workflow: ${workflowRes.status} ${text}`);
    }

    await new Promise((r) => setTimeout(r, 4000));

    const runsUrl = `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/workflows/generate-android-keystore.yml/runs?per_page=5&created=>=${dispatchedAt.substring(0, 19)}Z`;
    let runId: number | null = null;

    for (let attempt = 0; attempt < 6; attempt++) {
      const runsRes = await fetch(runsUrl, { headers: githubHeaders() });
      if (runsRes.ok) {
        const runsData = (await runsRes.json()) as any;
        const match = (runsData.workflow_runs ?? []).find(
          (r: any) => new Date(r.created_at) >= new Date(dispatchedAt),
        );
        if (match) { runId = match.id; break; }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (!runId) {
      throw new Error("Keystore workflow triggered but run not found. Check GitHub Actions.");
    }

    const pollTimeoutMs = 5 * 60 * 1000;
    const pollStart = Date.now();
    let conclusion: string | null = null;

    while (Date.now() - pollStart < pollTimeoutMs) {
      await new Promise((r) => setTimeout(r, 8000));
      const runRes = await fetch(
        `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
        { headers: githubHeaders() },
      );
      if (!runRes.ok) continue;
      const runData = (await runRes.json()) as any;
      if (runData.status === "completed") { conclusion = runData.conclusion; break; }
    }

    if (!conclusion) {
      throw new Error(`Keystore workflow timed out. Check: https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`);
    }
    if (conclusion !== "success") {
      throw new Error(`Keystore workflow failed (${conclusion}). See: https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`);
    }

    return {
      success: true,
      password,
      alias,
      runUrl: `https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
      message: `Android keystore generated. ANDROID_KEYSTORE, KEYSTORE_PASSWORD and KEY_ALIAS have been set in ${app.github_owner}/${app.github_repo}.`,
    };
  });

export const checkAndroidSigning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const branch = app.default_ref || "main";
    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/android/app/build.gradle?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(url, { headers: githubHeaders() });
    if (!res.ok) return { configured: false, fileExists: false };
    const json = (await res.json()) as any;
    const content = Buffer.from(json.content, "base64").toString("utf-8");
    return { configured: content.includes("keystorePropertiesFile"), fileExists: true };
  });

export const configureAndroidSigning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const branch = app.default_ref || "main";
    const apiUrl = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/android/app/build.gradle`;
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
      headers: githubHeaders(),
    });
    if (!getRes.ok) {
      throw new Error(
        "android/app/build.gradle not found. Run Capacitor setup first (Step 1).",
      );
    }
    const existing = (await getRes.json()) as any;
    const original = Buffer.from(existing.content, "base64").toString("utf-8");

    if (original.includes("keystorePropertiesFile")) {
      return { success: true, message: "Android signing was already configured.", commitUrl: undefined as string | undefined };
    }

    const KEYSTORE_BLOCK = [
      'def keystorePropertiesFile = rootProject.file("key.properties")',
      "def keystoreProperties = new Properties()",
      "if (keystorePropertiesFile.exists()) {",
      "    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))",
      "}",
      "",
    ].join("\n");

    const SIGNING_CONFIGS = [
      "    signingConfigs {",
      "        release {",
      "            if (keystorePropertiesFile.exists()) {",
      "                keyAlias keystoreProperties['keyAlias']",
      "                keyPassword keystoreProperties['keyPassword']",
      "                storeFile file(keystoreProperties['storeFile'])",
      "                storePassword keystoreProperties['storePassword']",
      "            }",
      "        }",
      "    }",
    ].join("\n");

    // Insert keystore block before `android {`
    let modified = original.replace(/(android\s*\{)/, `${KEYSTORE_BLOCK}\n$1`);

    // Insert signingConfigs block before `buildTypes {`
    modified = modified.replace(/(\s+buildTypes\s*\{)/, `\n${SIGNING_CONFIGS}\n$1`);

    // Add signingConfig inside the release block (first occurrence)
    modified = modified.replace(
      /(buildTypes[\s\S]*?release\s*\{)/,
      "$1\n            signingConfig signingConfigs.release",
    );

    const base64Content = Buffer.from(modified).toString("base64");
    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore: configure Android signing via bgp-admin",
        content: base64Content,
        branch,
        sha: existing.sha,
      }),
    });

    if (!putRes.ok) {
      const text = await putRes.text();
      throw new Error(`Failed to update build.gradle: ${putRes.status} ${text.slice(0, 200)}`);
    }

    const result = (await putRes.json()) as any;
    return {
      success: true,
      message: "Android signing configured in android/app/build.gradle.",
      commitUrl: result.commit?.html_url as string | undefined,
    };
  });

export const checkDeployWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);
    const branch = app.default_ref || "main";
    const url = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/.github/workflows/deploy.yml?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(url, { headers: githubHeaders() });
    return { exists: res.ok };
  });

export const createDeployWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);

    if (!app.bundle_id) {
      throw new Error("Bundle ID is required. Set it in the General tab first.");
    }

    const branch = app.default_ref || "main";
    const bundleId = app.bundle_id as string;
    const appName = app.name as string;

    const content = [
      "name: Deploy",
      "",
      "on:",
      "  push:",
      "    branches: [deploy-app]",
      "  pull_request:",
      "    branches: [main]",
      "    types: [closed]",
      "  workflow_dispatch:",
      "    inputs:",
      "      deploy_ios:",
      '        description: "Deploy iOS"',
      "        type: boolean",
      "        default: false",
      "      deploy_android:",
      '        description: "Deploy Android"',
      "        type: boolean",
      "        default: false",
      "      marketing_version:",
      '        description: "Marketing version (e.g. 1.0). Leave empty to use package.json"',
      "        type: string",
      '        default: ""',
      "",
      "jobs:",
      "  ios:",
      "    if: |",
      "      github.ref == 'refs/heads/deploy-app' ||",
      "      (github.event_name == 'pull_request' && github.event.pull_request.merged == true) ||",
      "      (github.event_name == 'workflow_dispatch' && inputs.deploy_ios == true)",
      "    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-ios.yml@main",
      "    with:",
      "      marketing-version: ${{ inputs.marketing_version }}",
      "    secrets:",
      "      IOS_TEAM_ID: ${{ secrets.IOS_TEAM_ID }}",
      "      IOS_BUILD_CERTIFICATE_BASE64: ${{ secrets.IOS_BUILD_CERTIFICATE_BASE64 }}",
      "      IOS_P12_PASSWORD: ${{ secrets.IOS_P12_PASSWORD }}",
      "      IOS_BUILD_PROVISION_PROFILE_BASE64: ${{ secrets.IOS_BUILD_PROVISION_PROFILE_BASE64 }}",
      "      IOS_KEYCHAIN_PASSWORD: ${{ secrets.IOS_KEYCHAIN_PASSWORD }}",
      "      IOS_EXPORT_OPTIONS_PLIST: ${{ secrets.IOS_EXPORT_OPTIONS_PLIST }}",
      "      APP_STORE_CONNECT_API_KEY_ID: ${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}",
      "      APP_STORE_CONNECT_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}",
      "      APP_STORE_CONNECT_API_KEY_BASE64: ${{ secrets.APP_STORE_CONNECT_API_KEY_BASE64 }}",
      "",
      "  android:",
      "    if: |",
      "      github.ref == 'refs/heads/deploy-app' ||",
      "      (github.event_name == 'pull_request' && github.event.pull_request.merged == true) ||",
      "      (github.event_name == 'workflow_dispatch' && inputs.deploy_android == true)",
      "    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-android.yml@main",
      "    with:",
      `      package-name: ${bundleId}`,
      "      marketing-version: ${{ inputs.marketing_version }}",
      "    secrets:",
      "      ANDROID_KEYSTORE: ${{ secrets.ANDROID_KEYSTORE }}",
      "      KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}",
      "      KEY_ALIAS: ${{ secrets.KEY_ALIAS }}",
      "      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}",
      "",
      "  notify:",
      "    needs: [ios, android]",
      "    if: always() && (needs.ios.result == 'success' || needs.android.result == 'success')",
      "    uses: Bible-Games-Project/bgp-admin/.github/workflows/notify-telegram.yml@main",
      "    with:",
      `      app-name: ${JSON.stringify(appName)}`,
      "    secrets:",
      "      TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}",
      "      TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}",
      "",
      "  tag:",
      "    needs: [ios, android]",
      "    if: always() && (needs.ios.result == 'success' || needs.android.result == 'success')",
      "    uses: Bible-Games-Project/bgp-admin/.github/workflows/tag-release.yml@main",
      "",
    ].join("\n");

    const filePath = ".github/workflows/deploy.yml";
    const apiUrl = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/${filePath}`;

    // Fetch existing SHA if the file already exists (needed for updates)
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
      headers: githubHeaders(),
    });
    let sha: string | undefined;
    if (getRes.ok) {
      const existing = (await getRes.json()) as any;
      sha = existing.sha;
    }

    const base64Content = Buffer.from(content).toString("base64");
    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore: add deploy workflow via bgp-admin",
        content: base64Content,
        branch,
        ...(sha && { sha }),
      }),
    });

    if (!putRes.ok) {
      const text = await putRes.text();
      throw new Error(`Failed to create deploy workflow: ${putRes.status} ${text.slice(0, 200)}`);
    }

    const result = (await putRes.json()) as any;
    return {
      success: true,
      commitUrl: result.commit?.html_url as string | undefined,
      message: "deploy.yml created successfully.",
    };
  });

export const setupCapacitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ appId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const app = await loadApp(context.supabase, data.appId);

    if (!app.bundle_id) {
      throw new Error(
        "Bundle ID is required. Set it in the General tab before running Capacitor setup.",
      );
    }

    const branch = app.default_ref || "main";
    const dispatchedAt = new Date().toISOString();

    const workflowUrl = `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/workflows/setup-capacitor.yml/dispatches`;
    const workflowRes = await fetch(workflowUrl, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          github_owner: app.github_owner,
          github_repo: app.github_repo,
          branch,
          bundle_id: app.bundle_id,
          app_name: app.name,
          pat: process.env.GITHUB_PAT ?? "",
        },
      }),
    });

    if (!workflowRes.ok) {
      const text = await workflowRes.text();
      throw new Error(
        `Failed to trigger Capacitor setup workflow: ${workflowRes.status} ${text}`,
      );
    }

    // Wait for GitHub to register the run
    await new Promise((r) => setTimeout(r, 4000));

    // Locate the workflow run that was just dispatched
    const runsUrl = `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/workflows/setup-capacitor.yml/runs?per_page=5&created=>=${dispatchedAt.substring(0, 19)}Z`;
    let runId: number | null = null;

    for (let attempt = 0; attempt < 6; attempt++) {
      const runsRes = await fetch(runsUrl, { headers: githubHeaders() });
      if (runsRes.ok) {
        const runsData = (await runsRes.json()) as any;
        const match = (runsData.workflow_runs ?? []).find(
          (r: any) => new Date(r.created_at) >= new Date(dispatchedAt),
        );
        if (match) {
          runId = match.id;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (!runId) {
      throw new Error(
        "Capacitor setup workflow was triggered but could not locate the run. Check GitHub Actions for status.",
      );
    }

    // Poll until complete (10-minute timeout)
    const pollTimeoutMs = 10 * 60 * 1000;
    const pollIntervalMs = 8000;
    const pollStart = Date.now();
    let conclusion: string | null = null;

    while (Date.now() - pollStart < pollTimeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const runRes = await fetch(
        `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
        { headers: githubHeaders() },
      );
      if (!runRes.ok) continue;
      const runData = (await runRes.json()) as any;
      if (runData.status === "completed") {
        conclusion = runData.conclusion;
        break;
      }
    }

    if (!conclusion) {
      throw new Error(
        `Capacitor setup workflow timed out after 10 minutes. Check run: https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
      );
    }

    if (conclusion !== "success") {
      const jobsRes = await fetch(
        `https://api.github.com/repos/Bible-Games-Project/bgp-admin/actions/runs/${runId}/jobs`,
        { headers: githubHeaders() },
      );
      let failedStep = "";
      if (jobsRes.ok) {
        const jobsData = (await jobsRes.json()) as any;
        const failedJob = (jobsData.jobs ?? []).find((j: any) => j.conclusion !== "success");
        if (failedJob) {
          const failedStepObj = (failedJob.steps ?? []).find(
            (s: any) => s.conclusion !== "success" && s.conclusion !== null,
          );
          if (failedStepObj) failedStep = ` Failed step: "${failedStepObj.name}".`;
        }
      }
      throw new Error(
        `Capacitor setup workflow failed (${conclusion}).${failedStep} See: https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
      );
    }

    return {
      success: true,
      runUrl: `https://github.com/Bible-Games-Project/bgp-admin/actions/runs/${runId}`,
      message:
        "Capacitor set up successfully. The ios/ and android/ native projects have been added to the repository.",
    };
  });

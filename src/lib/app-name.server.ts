/**
 * Pushes the app name (the single source of truth, `apps.name`) into the
 * game repo so the name players see on their device always matches bgp-admin.
 */

function githubHeaders() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_PAT not configured");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bgp-admin",
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

type NameTarget = {
  path: string;
  rewrite: (content: string, appName: string) => string;
};

const TARGETS: NameTarget[] = [
  {
    path: "capacitor.config.ts",
    rewrite: (content, appName) =>
      content.replace(/appName:\s*['"][^'"]*['"]/, `appName: '${appName.replace(/'/g, "\\'")}'`),
  },
  {
    path: "android/app/src/main/res/values/strings.xml",
    rewrite: (content, appName) =>
      content
        .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${escapeXml(appName)}$2`)
        .replace(
          /(<string name="title_activity_main">)[^<]*(<\/string>)/,
          `$1${escapeXml(appName)}$2`,
        ),
  },
  {
    path: "ios/App/App/Info.plist",
    rewrite: (content, appName) =>
      content.replace(
        /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
        `$1${escapeXml(appName)}$2`,
      ),
  },
];

/**
 * Best-effort: files that don't exist yet (repo without Capacitor set up) are
 * skipped silently — the name lands there when Capacitor setup runs.
 * Returns the paths that could not be updated, never throws.
 */
export async function syncAppNameToRepo({
  owner,
  repo,
  ref,
  appName,
}: {
  owner: string;
  repo: string;
  ref: string;
  appName: string;
}): Promise<{ updated: string[]; failed: string[] }> {
  const updated: string[] = [];
  const failed: string[] = [];

  let headers: Record<string, string>;
  try {
    headers = githubHeaders();
  } catch {
    return { updated, failed: TARGETS.map((t) => t.path) };
  }

  for (const target of TARGETS) {
    try {
      const getRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${target.path}?ref=${encodeURIComponent(ref)}`,
        { headers },
      );
      // Not set up yet — nothing to rewrite.
      if (getRes.status === 404) continue;
      if (!getRes.ok) {
        failed.push(target.path);
        continue;
      }

      const json: any = await getRes.json();
      const content = Buffer.from(json.content, "base64").toString("utf-8");
      const next = target.rewrite(content, appName);
      // Already correct, or the file doesn't carry the name in the expected shape.
      if (next === content) continue;

      const putRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${target.path}`,
        {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `chore: update app name to "${appName}" via bgp-admin`,
            content: Buffer.from(next, "utf-8").toString("base64"),
            branch: ref,
            sha: json.sha,
          }),
        },
      );
      if (!putRes.ok) {
        failed.push(target.path);
        continue;
      }
      updated.push(target.path);
    } catch {
      failed.push(target.path);
    }
  }

  return { updated, failed };
}

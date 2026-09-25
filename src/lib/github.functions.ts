import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { commitAgentDocs } from "@/lib/agent-docs.server";

const ORG = "Bible-Games-Project";

export const PREVIEW_WORKFLOW_PATH = ".github/workflows/preview-deploy.yml";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

export function githubHeaders() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_PAT not configured");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bgp-admin-capacitor",
  };
}

/**
 * Checks that the repo an app points at exists, is public and has the branch the
 * console works on. Returns what to fix, or null when the repo is usable.
 *
 * A repo linked from Lovable is named after the Lovable project, not after the
 * app, so a name typed from memory is easy to get wrong. Without this check the
 * mistake only surfaces minutes into a setup workflow, as a bare
 * "Repository not found" from git clone.
 */
export async function findRepoProblem({
  owner,
  repo,
  branch,
  fieldsOnGeneralTab = false,
}: {
  owner: string;
  repo: string;
  branch: string;
  /** Set when the caller is not the app form, so the message says where the fields are. */
  fieldsOnGeneralTab?: boolean;
}): Promise<string | null> {
  const full = `${owner}/${repo}`;
  const repoField = fieldsOnGeneralTab ? "Repo name on the General tab" : "the Repo name field";
  const branchField = fieldsOnGeneralTab
    ? "Default branch (General tab → Advanced)"
    : "Default branch (under Advanced)";
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: githubHeaders(),
  });
  // GitHub answers 404 both for a repo that does not exist and for a private
  // one the console's token cannot see.
  if (res.status === 404) {
    return `GitHub has no public repo called ${full}. Open the repo on GitHub and copy its exact name into ${repoField} — a repo linked from Lovable is named after the Lovable project, not after the app. If the name is right, the repo is still private: make it public.`;
  }
  if (!res.ok) {
    return `GitHub did not answer for ${full} (${res.status}). Try again in a minute.`;
  }
  const info = (await res.json()) as { private: boolean; default_branch: string };
  if (info.private) {
    return `${full} is private. Make it public on GitHub: Settings → General → Danger Zone → Change repository visibility.`;
  }
  if (branch !== info.default_branch) {
    const branchRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
      { headers: githubHeaders() },
    );
    // A renamed branch redirects to its new name, which git clone does not follow.
    const found = branchRes.ok ? ((await branchRes.json()) as { name: string }).name : null;
    if (branchRes.status === 404 || (found !== null && found !== branch)) {
      return `${full} has no branch called "${branch}". Its main branch is "${info.default_branch}" — enter that as ${branchField}.`;
    }
  }
  return null;
}

export function buildPreviewDeployWorkflowYaml(): string {
  return [
    "name: Preview Deploy (Cloudflare Pages)",
    "",
    "on:",
    "  push:",
    "    branches: [main]",
    "  workflow_dispatch: {}",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  preview:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "",
    "      - uses: oven-sh/setup-bun@v2",
    "        with:",
    "          bun-version: latest",
    "",
    "      - name: Install dependencies",
    "        id: deps",
    "        run: bun install",
    "        continue-on-error: true",
    "",
    "      - name: Build",
    "        id: build",
    "        if: steps.deps.outcome == 'success'",
    "        run: bun run build",
    "        continue-on-error: true",
    "",
    "      - name: Locate build output",
    "        id: outdir",
    "        run: |",
    "          for d in .output/public dist/client dist build out; do",
    '            if [ -d "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then',
    '              echo "dir=$d" >> "$GITHUB_OUTPUT"',
    '              echo "found=true" >> "$GITHUB_OUTPUT"',
    "              exit 0",
    "            fi",
    "          done",
    '          echo "found=false" >> "$GITHUB_OUTPUT"',
    "",
    // Calls wrangler directly: cloudflare/pages-action was deleted from GitHub in
    // September 2026 and took every generated preview workflow down with it.
    // The project is created here because only "create repo" in bgp-admin makes
    // one up front; linked repos would otherwise fail with "Project not found".
    "      - name: Deploy to Cloudflare Pages",
    "        if: steps.outdir.outputs.found == 'true'",
    "        env:",
    "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    "          PROJECT: bgp-${{ github.event.repository.name }}",
    "          OUT_DIR: ${{ steps.outdir.outputs.dir }}",
    "        run: |",
    '          if ! curl -sf -o /dev/null -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \\',
    '            "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT"; then',
    '            echo "Creating the Cloudflare Pages project $PROJECT"',
    '            bunx wrangler@4 pages project create "$PROJECT" --production-branch=main',
    "          fi",
    '          bunx wrangler@4 pages deploy "$OUT_DIR" --project-name="$PROJECT" --branch=main',
    "",
    "      - name: No build output yet",
    "        if: steps.outdir.outputs.found != 'true'",
    "        run: |",
    "          echo \"::notice::No build output found (deps=${{ steps.deps.outcome }}, build=${{ steps.build.outcome }}). Skipping Cloudflare Pages deploy - expected until the app has real code with a working 'bun run build'. Push again once .output/public/, dist/, dist/client/, build/, or out/ contains files.\"",
    "",
  ].join("\n");
}

export async function commitPreviewWorkflow({
  owner,
  repo,
  branch,
}: {
  owner: string;
  repo: string;
  branch: string;
}): Promise<{ committed: boolean; commitUrl?: string }> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${PREVIEW_WORKFLOW_PATH}`;

  const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(),
  });
  let sha: string | undefined;
  if (getRes.ok) {
    const existing = (await getRes.json()) as any;
    sha = existing.sha;
  }

  const base64Content = Buffer.from(buildPreviewDeployWorkflowYaml()).toString("base64");
  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...githubHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: add Cloudflare Pages preview workflow via bgp-admin",
      content: base64Content,
      branch,
      ...(sha && { sha }),
    }),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`Failed to commit preview workflow: ${putRes.status} ${text.slice(0, 200)}`);
  }

  const result = (await putRes.json()) as any;
  return { committed: true, commitUrl: result.commit?.html_url as string | undefined };
}

const createRepoInput = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/, "letters, numbers, dashes, underscores and dots only"),
});

export const createAppRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => createRepoInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const createRes = await fetch(`https://api.github.com/orgs/${ORG}/repos`, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.name, private: false, auto_init: true }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      if (createRes.status === 422) {
        throw new Error(`A repository named "${data.name}" already exists in ${ORG}. Choose a different name.`);
      }
      if (createRes.status === 403 || createRes.status === 404) {
        throw new Error(
          `GitHub PAT cannot create repos in ${ORG} (${createRes.status}). Make sure it has the "repo" scope and permission to create repositories in this organization.`,
        );
      }
      throw new Error(`Failed to create GitHub repo: ${createRes.status} ${text.slice(0, 200)}`);
    }

    const repo = await createRes.json();
    const defaultBranch = repo.default_branch as string;

    const warnings: string[] = [];

    let previewWorkflowCommitted = false;
    try {
      const r = await commitPreviewWorkflow({ owner: ORG, repo: data.name, branch: defaultBranch });
      previewWorkflowCommitted = r.committed;
    } catch (e) {
      warnings.push(
        `The preview deploy workflow could not be added automatically (${(e as Error).message}). You can retry it from the app's Setup tab.`,
      );
    }

    let agentDocsCommitted = false;
    try {
      await commitAgentDocs({ owner: ORG, repo: data.name, branch: defaultBranch });
      agentDocsCommitted = true;
    } catch (e) {
      warnings.push(
        `CLAUDE.md / AGENTS.md could not be added automatically (${(e as Error).message}). You can retry it from the app's Setup tab.`,
      );
    }

    return {
      success: true,
      owner: ORG,
      repo: data.name as string,
      defaultBranch,
      repoUrl: repo.html_url as string,
      previewWorkflowCommitted,
      agentDocsCommitted,
      warning: warnings.length ? `Repo created, but: ${warnings.join(" ")}` : undefined,
    };
  });

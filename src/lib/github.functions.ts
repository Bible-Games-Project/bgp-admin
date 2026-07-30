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
    "          for d in dist/client dist build out; do",
    '            if [ -d "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then',
    '              echo "dir=$d" >> "$GITHUB_OUTPUT"',
    '              echo "found=true" >> "$GITHUB_OUTPUT"',
    "              exit 0",
    "            fi",
    "          done",
    '          echo "found=false" >> "$GITHUB_OUTPUT"',
    "",
    "      - name: Deploy to Cloudflare Pages",
    "        if: steps.outdir.outputs.found == 'true'",
    "        uses: cloudflare/pages-action@v1",
    "        with:",
    "          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    "          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    "          projectName: bgp-${{ github.event.repository.name }}",
    "          directory: ${{ steps.outdir.outputs.dir }}",
    "          branch: main",
    "",
    "      - name: No build output yet",
    "        if: steps.outdir.outputs.found != 'true'",
    "        run: |",
    "          echo \"::notice::No build output found (deps=${{ steps.deps.outcome }}, build=${{ steps.build.outcome }}). Skipping Cloudflare Pages deploy - expected until the app has real code with a working 'bun run build'. Push again once dist/, dist/client/, build/, or out/ contains files.\"",
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

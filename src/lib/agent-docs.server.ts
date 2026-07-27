/**
 * Shared agent docs injected into every app repo.
 *
 * The .server.ts suffix keeps this out of the client bundle — without it the full
 * text of every template ships to the browser, and that cost grows with each doc
 * added. See config.server.ts for the convention.
 *
 * Every markdown file under templates/agent-docs/ is picked up automatically and
 * lands at the same relative path in the target repo, so adding a new doc (or a
 * .claude/skills/ entry) needs no code change here — just the file.
 *
 * Templates are inlined at build time (`eager: true`): the server runs on
 * Cloudflare Workers and cannot read from disk. Editing a template therefore only
 * reaches app repos once bgp-admin is redeployed, which happens on every push to
 * main via .github/workflows/cloudflare-preview.yml.
 */
import {
  buildManagedBlock,
  extractManagedBlock,
  localContentOf,
  mergeManagedBlock,
} from "@/lib/agent-docs.merge";

const modules = import.meta.glob("../../templates/agent-docs/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SOURCE_DIR = "templates/agent-docs/";

/** Repo-relative path -> content, e.g. "AGENTS.md", "docs/agents/working-style.md". */
export const AGENT_DOC_TEMPLATES: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([absolutePath, content]) => {
    const idx = absolutePath.indexOf(SOURCE_DIR);
    if (idx === -1) throw new Error(`Unexpected agent doc template path: ${absolutePath}`);
    return [absolutePath.slice(idx + SOURCE_DIR.length), content];
  }),
);

/** Sorted so root files (CLAUDE.md, AGENTS.md) come before nested ones. */
export const AGENT_DOC_FILES: string[] = Object.keys(AGENT_DOC_TEMPLATES).sort((a, b) => {
  const depth = a.split("/").length - b.split("/").length;
  return depth !== 0 ? depth : a.localeCompare(b);
});

function githubHeaders() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_PAT not configured");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bgp-admin-agent-docs",
  };
}

async function getFile(
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: githubHeaders() },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to read ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
}

async function putFile(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  content: string,
  sha?: string,
) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...githubHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `docs: sync ${path} from bgp-admin`,
      content: Buffer.from(content).toString("base64"),
      branch,
      ...(sha && { sha }),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to commit ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  const result = (await res.json()) as any;
  return result.commit?.html_url as string | undefined;
}

export type AgentDocStatus = {
  file: string;
  exists: boolean;
  /** true when the repo's managed block already matches the current template */
  inSync: boolean;
  /** true when the file exists but has content of its own outside the managed block */
  hasLocalContent: boolean;
};

export async function inspectAgentDocs({
  owner,
  repo,
  branch,
}: {
  owner: string;
  repo: string;
  branch: string;
}): Promise<AgentDocStatus[]> {
  return Promise.all(
    AGENT_DOC_FILES.map(async (file) => {
      const current = await getFile(owner, repo, file, branch);
      if (!current) return { file, exists: false, inSync: false, hasLocalContent: false };

      return {
        file,
        exists: true,
        inSync:
          extractManagedBlock(current.content) === buildManagedBlock(AGENT_DOC_TEMPLATES[file]),
        hasLocalContent: localContentOf(current.content).length > 0,
      };
    }),
  );
}

export type AgentDocCommitResult = { file: string; changed: boolean; commitUrl?: string };

/**
 * Writes the shared agent docs into a repo, merging with whatever is already
 * there. Safe to call on both brand-new and long-lived repos.
 */
export async function commitAgentDocs({
  owner,
  repo,
  branch,
}: {
  owner: string;
  repo: string;
  branch: string;
}): Promise<AgentDocCommitResult[]> {
  const results: AgentDocCommitResult[] = [];

  // Sequential on purpose: concurrent commits to the same branch race on the
  // parent SHA and GitHub rejects the losers with a 409.
  for (const file of AGENT_DOC_FILES) {
    const current = await getFile(owner, repo, file, branch);
    const merged = mergeManagedBlock(current?.content ?? null, AGENT_DOC_TEMPLATES[file]);

    if (current && current.content === merged) {
      results.push({ file, changed: false });
      continue;
    }

    const commitUrl = await putFile(owner, repo, file, branch, merged, current?.sha);
    results.push({ file, changed: true, commitUrl });
  }

  return results;
}

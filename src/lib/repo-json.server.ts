// A JSON file of a game's repo on GitHub, for the Videos page and the weekly brief.
import { githubHeaders } from "@/lib/github.functions";

/** A file of the game's repo as JSON, or undefined when it isn't there or isn't JSON. */
export async function repoJson(
  app: { github_owner: string; github_repo: string; default_ref: string | null },
  path: string,
) {
  const ref = encodeURIComponent(app.default_ref || "main");
  const res = await fetch(
    `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/${path}?ref=${ref}`,
    { headers: { ...githubHeaders(), Accept: "application/vnd.github.raw+json" } },
  );
  if (res.status === 404) return undefined;
  if (!res.ok)
    throw new Error(`GitHub didn't answer for ${path} (${res.status}). Try again in a minute.`);
  try {
    return JSON.parse(await res.text()) as unknown;
  } catch {
    return undefined;
  }
}

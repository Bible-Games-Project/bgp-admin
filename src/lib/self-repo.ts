/**
 * bgp-admin is registered as an app in its own console — it ships to the App
 * Store and Play Store like any game. But it is not an ordinary app repo: it is
 * the control plane, and several things the setup tab generates already exist
 * here in a hand-tuned form.
 *
 * Running the generators against this repo overwrites that hand-tuned setup.
 * It has happened once already (2026-08-11): the Capacitor generator re-injected
 * `spa.prerender` into vite.config.ts, which broke `bun run build` and left the
 * panel undeployable until the commits were reverted.
 *
 * The steps listed in SELF_REPO_BLOCKED_STEPS are therefore disabled for this
 * repo. Everything else in the setup tab (keystore, iOS secrets, store
 * listings) only touches GitHub secrets or checklists and stays available,
 * because bgp-admin does need them for its own releases.
 */

export const SELF_REPO_OWNER = "Bible-Games-Project";
export const SELF_REPO_NAME = "bgp-admin";

export type SelfRepoBlockedStep = "capacitor" | "deploy-workflow" | "preview-deploy" | "agent-docs";

/** Why each step is off, shown in the UI and thrown from the server function. */
export const SELF_REPO_BLOCKED_STEPS: Record<SelfRepoBlockedStep, string> = {
  capacitor:
    "bgp-admin has a hand-tuned Capacitor setup. The generator re-injects spa.prerender into vite.config.ts, which breaks the build.",
  "deploy-workflow":
    "bgp-admin releases to the stores manually via workflow_dispatch. The generated deploy.yml also fires on every merged PR to main.",
  "preview-deploy":
    "bgp-admin already deploys itself to Cloudflare Workers via cloudflare-preview.yml, which carries the GITHUB_PAT secret the server functions need.",
  "agent-docs":
    "bgp-admin maintains its own AGENTS.md. The shared templates describe a game repo and forbid touching the files this repo owns.",
};

export function isSelfRepo(owner: string | null | undefined, repo: string | null | undefined) {
  return (
    owner?.toLowerCase() === SELF_REPO_OWNER.toLowerCase() &&
    repo?.toLowerCase() === SELF_REPO_NAME.toLowerCase()
  );
}

/** Server-side enforcement. The UI disables these buttons, this makes it stick. */
export function assertNotSelfRepo(
  app: { github_owner?: string | null; github_repo?: string | null },
  step: SelfRepoBlockedStep,
) {
  if (!isSelfRepo(app.github_owner, app.github_repo)) return;
  throw new Error(
    `This step is disabled for ${SELF_REPO_OWNER}/${SELF_REPO_NAME}. ${SELF_REPO_BLOCKED_STEPS[step]}`,
  );
}

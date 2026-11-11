// Where a game's deploy.yml run sent its build: testing (TestFlight, Play internal),
// production (App Store review, Play production) or an AAB nobody uploaded. GitHub doesn't
// list a run's inputs, so it is read from the run's jobs.

export type RunTarget = "testing" | "production" | "aab";

export type RunJob = {
  /** e.g. "ios / Build & Deploy iOS (production)", or "ios" when the platform was skipped. */
  name: string;
  status: string;
  conclusion: string | null;
  steps?: { name: string; status: string; conclusion: string | null }[];
};

export type RunTargetInfo = {
  /** null when the run doesn't say, e.g. an Android-only run from before job names said it. */
  target: RunTarget | null;
  /** The stores this run built for, in the order iOS, Android. */
  platforms: ("iOS" | "Android")[];
};

// The caller's job id ("ios", "android") comes first, then the reusable workflow's job name.
const platformOf = (name: string): "iOS" | "Android" | null =>
  /^ios(\s|\/|$)/i.test(name) ? "iOS" : /^android(\s|\/|$)/i.test(name) ? "Android" : null;

// deploy-ios.yml and deploy-android.yml end their job name with the target in brackets.
function targetFromName(name: string): RunTarget | null {
  const m = name.match(/\((production|testing|AAB only)\)\s*$/i);
  if (!m) return null;
  const word = m[1].toLowerCase();
  return word === "aab only" ? "aab" : (word as RunTarget);
}

// Runs from before the job names carried the target: the iOS job runs these steps only
// when it submits the build for App Store review.
const REVIEW_STEPS = ["Preflight App Store Connect", "Submit build for App Store review"];

function iosTargetFromSteps(job: RunJob): RunTarget | null {
  const steps = (job.steps ?? []).filter((s) => REVIEW_STEPS.includes(s.name));
  if (steps.length === 0) return null;
  if (steps.some((s) => s.conclusion && s.conclusion !== "skipped")) return "production";
  if (steps.every((s) => s.conclusion === "skipped")) return "testing";
  return null; // the job hasn't reached them yet
}

export function runTarget(event: string, jobs: RunJob[]): RunTargetInfo {
  const platforms: RunTargetInfo["platforms"] = [];
  const targets: RunTarget[] = [];

  for (const job of jobs) {
    const platform = platformOf(job.name);
    if (!platform || job.conclusion === "skipped") continue;
    if (!platforms.includes(platform)) platforms.push(platform);
    const target =
      targetFromName(job.name) ?? (platform === "iOS" ? iosTargetFromSteps(job) : null);
    if (target) targets.push(target);
  }
  platforms.sort((a, b) => (a === "iOS" ? -1 : b === "iOS" ? 1 : 0));

  let target: RunTarget | null = targets.includes("production")
    ? "production"
    : targets.includes("testing")
      ? "testing"
      : targets.includes("aab")
        ? "aab"
        : null;
  // A push to deploy-app or a merged pull request never asks for production.
  if (!target && platforms.length > 0 && event !== "workflow_dispatch") target = "testing";

  return { target, platforms };
}

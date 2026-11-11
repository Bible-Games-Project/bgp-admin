import { describe, expect, test } from "bun:test";
import { type RunJob, runTarget } from "./deploy-run-target";

const job = (name: string, conclusion: string | null = "success", steps?: RunJob["steps"]) => ({
  name,
  status: conclusion ? "completed" : "in_progress",
  conclusion,
  steps,
});
const step = (name: string, conclusion: string | null) => ({
  name,
  status: conclusion ? "completed" : "queued",
  conclusion,
});
const plan = job("plan");
const notify = job("notify / Send Telegram Notification 🎉");

// Shaped like ascent-echoes runs #29 (testing) and #30 (production) on 2026-11-11, from
// before the job names carried the target.
const oldIos = (preflight: string | null, submit: string | null, conclusion = "success") =>
  job("ios / Build & Deploy iOS", conclusion, [
    step("Checkout code", "success"),
    step("Preflight App Store Connect", preflight),
    step("Upload to App Store Connect", "success"),
    step("Submit build for App Store review", submit),
  ]);
const oldAndroid = job("android / Build & Deploy Android");

describe("runTarget", () => {
  test("a testing run named by the new job names", () => {
    expect(
      runTarget("workflow_dispatch", [
        plan,
        job("ios / Build & Deploy iOS (testing)"),
        job("android / Build & Deploy Android (testing)"),
        notify,
      ]),
    ).toEqual({ target: "testing", platforms: ["iOS", "Android"] });
  });

  test("a production run named by the new job names, even while it is still building", () => {
    expect(
      runTarget("workflow_dispatch", [
        plan,
        job("android / Build & Deploy Android (production)", null),
        job("ios / Build & Deploy iOS (production)", null),
      ]),
    ).toEqual({ target: "production", platforms: ["iOS", "Android"] });
  });

  test("an older run that submitted to App Store review is production", () => {
    expect(
      runTarget("workflow_dispatch", [plan, oldIos("success", "success"), oldAndroid]),
    ).toEqual({ target: "production", platforms: ["iOS", "Android"] });
  });

  test("an older production run that failed at the submission is still production", () => {
    expect(
      runTarget("workflow_dispatch", [plan, oldIos("success", "failure", "failure"), oldAndroid]),
    ).toEqual({ target: "production", platforms: ["iOS", "Android"] });
  });

  test("an older run that skipped the review steps is testing", () => {
    expect(
      runTarget("workflow_dispatch", [plan, oldIos("skipped", "skipped"), oldAndroid]),
    ).toEqual({ target: "testing", platforms: ["iOS", "Android"] });
  });

  test("an older run that hasn't reached the review steps doesn't say yet", () => {
    expect(runTarget("workflow_dispatch", [plan, oldIos(null, null, null)]).target).toBeNull();
  });

  test("an older Android-only run from the console can't be told apart", () => {
    expect(runTarget("workflow_dispatch", [plan, job("ios", "skipped"), oldAndroid])).toEqual({
      target: null,
      platforms: ["Android"],
    });
  });

  test("an automatic run (merged pull request, push to deploy-app) is testing", () => {
    expect(runTarget("pull_request", [plan, job("ios", "skipped"), oldAndroid])).toEqual({
      target: "testing",
      platforms: ["Android"],
    });
  });

  test("a closed pull request that wasn't merged deployed nothing", () => {
    expect(
      runTarget("pull_request", [plan, job("ios", "skipped"), job("android", "skipped")]),
    ).toEqual({ target: null, platforms: [] });
  });

  test("an AAB built without uploading", () => {
    expect(
      runTarget("workflow_dispatch", [
        plan,
        job("ios", "skipped"),
        job("android / Build Android (AAB only)"),
      ]),
    ).toEqual({ target: "aab", platforms: ["Android"] });
  });
});

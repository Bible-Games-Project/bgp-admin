import { describe, expect, test } from "bun:test";
import { aiChatPrompt, explainFailure, failureExcerpt } from "./deploy-failure";

// Shaped like GitHub's raw job logs: a timestamp on every line, a header per step.
const log = (...lines: string[]) =>
  lines.map((l, i) => `2026-09-26T13:22:${String(i).padStart(2, "0")}.1234567Z ${l}`).join("\n");

const submitLog = log(
  "##[group]Run actions/checkout@v4",
  "##[endgroup]",
  "Syncing repository",
  "##[group]Run node - <<'EOF'",
  "\u001b[36;1mnode - <<'EOF'\u001b[0m",
  "env:",
  "  BUNDLE_IDENTIFIER: com.biblegames.eden",
  "##[endgroup]",
  "Looking up app by bundle id com.biblegames.eden...",
  "(node:2808) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.",
  "❌ POST /v1/reviewSubmissionItems -> 409:",
  "  • /v1/appStoreReviewDetails/51c4: The provided entity is missing a required attribute — You must provide a value for the attribute 'contactFirstName' with this request",
  "##[error]POST /v1/reviewSubmissionItems -> 409:",
  "##[group]Run security delete-keychain $RUNNER_TEMP/app-signing.keychain-db || true",
  "##[endgroup]",
  "Post job cleanup.",
);

describe("failureExcerpt", () => {
  test("keeps the failed step's output and error, without timestamps, colours or noise", () => {
    expect(failureExcerpt(submitLog)).toBe(
      [
        "Looking up app by bundle id com.biblegames.eden...",
        "❌ POST /v1/reviewSubmissionItems -> 409:",
        "  • /v1/appStoreReviewDetails/51c4: The provided entity is missing a required attribute — You must provide a value for the attribute 'contactFirstName' with this request",
        "Error: POST /v1/reviewSubmissionItems -> 409:",
      ].join("\n"),
    );
  });

  test("a long build log keeps its last lines and the earlier lines that say error", () => {
    const progress = Array.from({ length: 200 }, (_, i) => `CompileC file${i}.o`);
    const text = failureExcerpt(
      log(
        "##[group]Run xcodebuild archive",
        "##[endgroup]",
        "Package.swift: error: RevenueCat does not support provisioning profiles.",
        ...progress,
        "** ARCHIVE FAILED **",
        "##[error]Process completed with exit code 65.",
      ),
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe(
      "Package.swift: error: RevenueCat does not support provisioning profiles.",
    );
    expect(lines[1]).toBe("…");
    expect(lines.at(-1)).toBe("Error: Process completed with exit code 65.");
    expect(lines).toContain("** ARCHIVE FAILED **");
    expect(lines.length).toBeLessThan(60);
  });

  test("a log without an error line gives nothing", () => {
    expect(failureExcerpt(log("##[group]Run true", "##[endgroup]", "done"))).toBe("");
  });
});

describe("explainFailure", () => {
  const explain = (error: string, step: string | null = null) => explainFailure({ step, error });

  test("App Store Connect fields only the account's owner can fill in are yours", () => {
    const v = explain(failureExcerpt(submitLog));
    expect(v.owner).toBe("you");
    expect(v.where).toBe("App Store Connect");
    expect(v.todo).toContain("App Review Information");
  });

  test("Google Play permissions and first releases are yours", () => {
    expect(
      explain("Committing the Edit\nError: The caller does not have permission"),
    ).toMatchObject({ owner: "you", where: "Google Play Console" });
    expect(
      explain("Error: Only ***s with status draft may be created on draft app."),
    ).toMatchObject({ owner: "you", where: "Google Play Console" });
  });

  test("another version still with Apple is yours to clear", () => {
    const v = explain(
      [
        "❌ POST /v1/appStoreVersions -> 409: {",
        '    "detail" : "You cannot create a new version of the App in the current state.",',
        "Error: Process completed with exit code 1.",
      ].join("\n"),
    );
    expect(v).toMatchObject({ owner: "you", where: "App Store Connect" });
  });

  test("a version number already used is fixed from the console", () => {
    expect(
      explain(
        "ERROR ITMS-90062: The value for key CFBundleShortVersionString [1.0.2] must contain a higher version than that of the previously approved version [1.0.3].",
      ),
    ).toMatchObject({ owner: "you", where: "the console" });
  });

  test("signing, builds and Apple's checks of the file are the developer's", () => {
    expect(
      explain("jarsigner error: java.lang.RuntimeException: keystore load: Tag number over 30")
        .owner,
    ).toBe("developer");
    expect(explain("security: failed to decode message: UNKNOWN (-8183(d)").owner).toBe(
      "developer",
    );
    expect(explain("ERROR ITMS-90725: SDK version issue").owner).toBe("developer");
    const build = explain(
      "Package.swift: error: RevenueCat does not support provisioning profiles.\nError: Process completed with exit code 65.",
      "Build .xcarchive",
    );
    expect(build.owner).toBe("developer");
    expect(build.summary).toContain("didn't build");
  });

  test("overlapping uploads and timeouts only need another try", () => {
    expect(explain("Error: This Edit has been deleted.").owner).toBe("retry");
    expect(explainFailure({ step: "Upload", error: "", conclusion: "timed_out" }).owner).toBe(
      "retry",
    );
  });

  test("anything else says to ask an AI chat", () => {
    const v = explain("Error: Something new went wrong.", "Mystery step");
    expect(v.owner).toBe("unknown");
    expect(v.todo).toContain("AI chat");
  });
});

describe("aiChatPrompt", () => {
  test("carries the game, the step and the error", () => {
    const text = aiChatPrompt({
      game: "Bible Story Game",
      job: "ios / Build & Deploy iOS",
      step: "Submit build for App Store review",
      error: "Error: boom",
    });
    expect(text).toContain('"Bible Story Game"');
    expect(text).toContain("Failed step: Submit build for App Store review");
    expect(text).toContain("Error: boom");
    expect(text).toContain("App Store Connect or Google Play Console");
  });
});

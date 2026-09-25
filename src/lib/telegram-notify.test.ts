import { githubHeaders } from "@/lib/github.functions";
import sodium from "libsodium-wrappers";
import nacl from "tweetnacl";
import { blake2b } from "blakejs";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);

// The deploy.yml the setup tab generates must notify Telegram both on success
// and on failure, and pass both store results into the reusable workflow.
describe("generated deploy.yml wires the Telegram notify job", () => {
  const capacitor = readFileSync(
    join(here, "capacitor.functions.ts"),
    "utf8",
  );

  it("fires when a job failed, not only when both succeeded", () => {
    expect(capacitor).toContain("needs.ios.result != 'skipped'");
    expect(capacitor).toContain("needs.android.result != 'skipped'");
    expect(capacitor).not.toContain(
      "needs.ios.result == 'success' || needs.android.result == 'success'\"        ",
    );
  });

  it("passes both store results into the reusable notify workflow", () => {
    expect(capacitor).toContain("ios-result: ${{ needs.ios.result }}");
    expect(capacitor).toContain("android-result: ${{ needs.android.result }}");
  });
});

// The reusable workflow itself must render a failure headline and a per-store
// status line — checked as text, running it is a GitHub runner's job.
describe("notify-telegram.yml speaks about failures", () => {
  const workflow = readFileSync(
    join(here, "../../.github/workflows/notify-telegram.yml"),
    "utf8",
  );

  it("takes ios-result / android-result inputs", () => {
    expect(workflow).toContain("ios-result:");
    expect(workflow).toContain("android-result:");
  });

  it("has a distinct headline when a store failed", () => {
    expect(workflow).toContain("Publish had a problem");
    expect(workflow).toContain("Beta published successfully");
  });

  // curl --data-urlencode escapes "%" itself, so a pre-escaped %0A shows up in
  // the chat as the literal text "%0A" instead of a line break.
  it("builds the message with real newlines, not URL-escaped ones", () => {
    expect(workflow).toContain("--data-urlencode text=");
    expect(workflow).not.toContain("%0A");
  });
});

// Linked repos ask for the same Telegram secrets the create flow sets: the
// helper must exist and be wired into both createApp and createAppWithRepo.
describe("telegram secrets reach linked repos too (apps.functions.ts)", () => {
  const apps = readFileSync(
    join(here, "apps.functions.ts"),
    "utf8",
  );

  it("has a shared secret-setting helper", () => {
    expect(apps).toContain("setPublishTelegramSecrets");
  });

  it("createApp calls it (link existing repo route)", () => {
    const createAppBody = apps.slice(
      apps.indexOf("export const createApp "),
      apps.indexOf("export const createAppWithRepo"),
    );
    expect(createAppBody).toContain("setPublishTelegramSecrets");
  });

  it("createAppWithRepo calls it too (create new repo route)", () => {
    const withRepoBody = apps.slice(
      apps.indexOf("export const createAppWithRepo"),
      apps.indexOf("export const updateApp"),
    );
    // The create-new-repo flow shares the same helper (via setRepoSecrets +
    // telegramSecrets()) instead of duplicating the crypto by hand.
    expect(withRepoBody).toMatch(/setRepoSecrets|setPublishTelegramSecrets/);
    expect(withRepoBody).toContain("telegramSecrets()");
  });

  it("sealed-box crypto (BLAKE2b nonce, libsodium-compatible) is in repo-secrets.server.ts", () => {
    const helper = readFileSync(join(here, "repo-secrets.server.ts"), "utf8");
    expect(helper).toContain("blake2b(");
    expect(helper).toContain("nacl.box(");
    expect(helper).toContain("export const setRepoSecrets");
    expect(helper).toContain("export const setPublishTelegramSecrets");
    expect(helper).toContain("TELEGRAM_BOT_TOKEN");
    expect(helper).toContain("TELEGRAM_CHAT_ID");
  });
});

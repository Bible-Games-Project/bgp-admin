import { describe, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";

// github.functions imports the agent docs, which only load under Vite.
mock.module("@/lib/agent-docs.server", () => ({ commitAgentDocs: async () => [] }));

describe("preview workflow", () => {
  it("adds an index.html for TanStack Start builds before deploying, and only then", async () => {
    const { buildPreviewDeployWorkflowYaml } = await import("@/lib/github.functions");
    const yaml = buildPreviewDeployWorkflowYaml();
    const locate = yaml.indexOf("- name: Locate build output");
    const shell = yaml.indexOf("- name: Add index.html for TanStack Start builds");
    const deploy = yaml.indexOf("- name: Deploy to Cloudflare Pages");
    expect(locate).toBeGreaterThan(-1);
    expect(shell).toBeGreaterThan(locate);
    expect(deploy).toBeGreaterThan(shell);
    const step = yaml.slice(shell, deploy);
    // A game that already has an index.html (plain Vite) is never touched.
    expect(step).toContain('if [ -f "$OUT_DIR/index.html" ]; then exit 0; fi');
    expect(step).toContain("CAPACITOR_BUILD=1");
    // The script it fetches is the one in this repo.
    const url = step.match(/https:\/\/raw\.githubusercontent\.com\/\S+/)![0];
    expect(url.endsWith("/main/scripts/generate-capacitor-html.js")).toBe(true);
    expect(existsSync("scripts/generate-capacitor-html.js")).toBe(true);
  });
});

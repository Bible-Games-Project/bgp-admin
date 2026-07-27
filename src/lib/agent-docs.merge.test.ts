import { describe, expect, test } from "bun:test";
import { BEGIN_MARKER, localContentOf, mergeManagedBlock } from "./agent-docs.merge";

const TEMPLATE = "# AGENTS.md\n\nRule one.";
const blockCount = (s: string) => s.split(BEGIN_MARKER).length - 1;

describe("mergeManagedBlock", () => {
  test("creates the block when the file does not exist", () => {
    const result = mergeManagedBlock(null, TEMPLATE);
    expect(blockCount(result)).toBe(1);
    expect(result).toContain("Rule one.");
  });

  test("treats a blank file as absent", () => {
    expect(mergeManagedBlock("   \n\n", TEMPLATE)).toBe(mergeManagedBlock(null, TEMPLATE));
  });

  test("is idempotent", () => {
    const once = mergeManagedBlock(null, TEMPLATE);
    expect(mergeManagedBlock(once, TEMPLATE)).toBe(once);
  });

  test("adopts a pre-existing file without discarding it", () => {
    const legacy = "# AGENTS.md\n\nProject rule that must survive.\n";
    const result = mergeManagedBlock(legacy, TEMPLATE);
    expect(result).toContain("Project rule that must survive.");
    expect(blockCount(result)).toBe(1);
    expect(mergeManagedBlock(result, TEMPLATE)).toBe(result);
  });

  test("updates the block in place and keeps notes below it", () => {
    const seeded = mergeManagedBlock(null, TEMPLATE);
    const withNotes = `${seeded}\n## Local notes\n\nDo not touch the shaders.\n`;
    const result = mergeManagedBlock(withNotes, `${TEMPLATE}\nRule two.`);

    expect(result).toContain("Rule two.");
    expect(result).toContain("Do not touch the shaders.");
    expect(result).not.toContain("Rule one.\n\n<!-- BGP-ADMIN:END"); // old block gone
    expect(blockCount(result)).toBe(1);
  });

  test("keeps content above the block", () => {
    const seeded = mergeManagedBlock(null, TEMPLATE);
    const result = mergeManagedBlock(`Top matter.\n\n${seeded}`, TEMPLATE);
    expect(result.startsWith("Top matter.")).toBe(true);
    expect(blockCount(result)).toBe(1);
  });

  test("ignores a stray END marker with no BEGIN", () => {
    const stray = "# AGENTS.md\n\n<!-- BGP-ADMIN:END -->\n\nSome notes.\n";
    const result = mergeManagedBlock(stray, TEMPLATE);
    expect(blockCount(result)).toBe(1);
    expect(result).toContain("Some notes.");
  });
});

describe("localContentOf", () => {
  test("is empty for a freshly seeded file", () => {
    expect(localContentOf(mergeManagedBlock(null, TEMPLATE))).toBe("");
  });

  test("returns only what the project added", () => {
    const seeded = mergeManagedBlock(null, TEMPLATE);
    expect(localContentOf(`${seeded}\nMy note.\n`)).toBe("My note.");
  });
});

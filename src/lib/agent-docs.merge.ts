/**
 * Managed-block merge used to inject shared agent docs into app repos.
 *
 * Kept free of `?raw` imports and server code so it can be unit tested with
 * `bun test` (see agent-docs.merge.test.ts).
 */

// Keep these markers byte-stable forever: they are how we find our own block in
// repos that were seeded by an older version of bgp-admin.
export const BEGIN_MARKER = "<!-- BGP-ADMIN:BEGIN -->";
export const END_MARKER = "<!-- BGP-ADMIN:END -->";

const MANAGED_NOTICE =
  "<!-- Managed by bgp-admin (templates/agent-docs). Edits inside this block are overwritten on the next sync. Add project-specific notes below the END marker. -->";

export function buildManagedBlock(template: string): string {
  return `${BEGIN_MARKER}\n${MANAGED_NOTICE}\n\n${template.trim()}\n\n${END_MARKER}`;
}

/** Returns the whole managed block including markers, or null if the file has none. */
export function extractManagedBlock(content: string): string | null {
  const start = content.indexOf(BEGIN_MARKER);
  const end = content.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) return null;
  return content.slice(start, end + END_MARKER.length);
}

/**
 * Merges our template into a repo's existing file, preserving anything the project
 * added outside the managed block. Idempotent: merging the same template twice is a no-op.
 *
 * - no file yet          -> the block alone
 * - file with markers    -> block replaced in place, rest untouched
 * - file without markers -> block prepended, existing content kept below
 */
export function mergeManagedBlock(existing: string | null, template: string): string {
  const block = buildManagedBlock(template);
  if (!existing || !existing.trim()) return `${block}\n`;

  const start = existing.indexOf(BEGIN_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (start !== -1 && end !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + END_MARKER.length);
  }

  // No markers yet: adopt the file without discarding what it already says.
  return `${block}\n\n${existing.trimStart()}`;
}

/** Content the project owns, i.e. everything outside our block. */
export function localContentOf(content: string): string {
  const block = extractManagedBlock(content);
  return (block ? content.replace(block, "") : content).trim();
}

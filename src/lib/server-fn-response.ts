/**
 * Server-function answers that TanStack Start can't read.
 *
 * A server function answers with a serialized body (`x-tss-serialized`) or, when it returns a
 * Response itself, with `x-tss-raw`. Anything else came from somewhere else: Cloudflare
 * answering for a Worker that ran out of time or memory (as JSON, because the call asks for
 * JSON), or a crash before the function ran. TanStack Start hands a JSON one to the page as if
 * it were the answer, so a query got `undefined` and showed «["build-chat", "…"] data is
 * undefined» (Joan, 2026-11-26), and an HTML one became an error whose text was the whole page.
 * This turns both into a plain error, which React Query also tries again by itself.
 */
export function unreadableServerFnResponse(response: Response): Error | null {
  const headers = response.headers;
  if (headers.get("x-tss-serialized") || headers.get("x-tss-raw") === "true") return null;
  // notFound() answers 404 with its own JSON, and redirects are followed by fetch.
  if (response.status === 404 || (response.status >= 300 && response.status < 400)) return null;
  const json = (headers.get("content-type") ?? "").includes("application/json");
  if (response.ok && !json) return null;
  const code = response.ok ? "" : ` (error ${response.status})`;
  return new Error(
    `The console's server didn't answer properly${code}. It usually works again in a few seconds.`,
  );
}

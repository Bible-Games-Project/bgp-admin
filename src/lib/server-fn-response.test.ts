import { describe, expect, test } from "bun:test";
import { unreadableServerFnResponse } from "./server-fn-response";

const answer = (status: number, headers: Record<string, string>) =>
  new Response(null, { status, headers });

describe("unreadableServerFnResponse", () => {
  test("a serialized answer is fine, also when it carries the function's error", () => {
    const json = { "content-type": "application/json", "x-tss-serialized": "true" };
    expect(unreadableServerFnResponse(answer(200, json))).toBeNull();
    expect(unreadableServerFnResponse(answer(500, json))).toBeNull();
  });

  test("a Response the function returned itself is fine", () => {
    expect(unreadableServerFnResponse(answer(200, { "x-tss-raw": "true" }))).toBeNull();
  });

  test("notFound() and plain non-JSON answers are left to TanStack Start", () => {
    expect(
      unreadableServerFnResponse(answer(404, { "content-type": "application/json" })),
    ).toBeNull();
    expect(unreadableServerFnResponse(answer(200, { "content-type": "text/html" }))).toBeNull();
  });

  test("Cloudflare's JSON error for a Worker that gave up is an error, not undefined data", () => {
    const error = unreadableServerFnResponse(answer(503, { "content-type": "application/json" }));
    expect(error?.message).toContain("error 503");
  });

  test("an unserialized JSON 200 is an error too", () => {
    expect(
      unreadableServerFnResponse(answer(200, { "content-type": "application/json" })),
    ).toBeInstanceOf(Error);
  });

  test("an HTML error page becomes a short message instead of the page's text", () => {
    const error = unreadableServerFnResponse(
      answer(500, { "content-type": "text/html; charset=utf-8" }),
    );
    expect(error?.message).toContain("error 500");
    expect(error?.message).not.toContain("<");
  });
});

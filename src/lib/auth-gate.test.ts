import { describe, expect, test } from "bun:test";
import { afterSignIn, nextSearch } from "./auth-gate";

describe("afterSignIn", () => {
  test("goes back to the console page that asked for sign-in", () => {
    expect(afterSignIn("/apps")).toBe("/apps");
    expect(afterSignIn("/apps/a9590adb-5638-42a1-aea2-9334b1eaa253?tab=store")).toBe(
      "/apps/a9590adb-5638-42a1-aea2-9334b1eaa253?tab=store",
    );
  });

  test("falls back to the dashboard for anything else", () => {
    expect(afterSignIn(undefined)).toBe("/dashboard");
    expect(afterSignIn("")).toBe("/dashboard");
    expect(afterSignIn("https://evil.example/apps")).toBe("/dashboard");
    expect(afterSignIn("//evil.example/apps")).toBe("/dashboard");
    expect(afterSignIn("/\\evil.example")).toBe("/dashboard");
    expect(afterSignIn("/login?next=/apps")).toBe("/dashboard");
    expect(afterSignIn("/mfa-challenge")).toBe("/dashboard");
  });

  test("a page whose name only starts like a sign-in page is kept", () => {
    expect(afterSignIn("/login-help")).toBe("/login-help");
  });
});

test("nextSearch keeps only a string next", () => {
  expect(nextSearch({ next: "/apps" })).toEqual({ next: "/apps" });
  expect(nextSearch({ next: 3 })).toEqual({});
  expect(nextSearch({})).toEqual({});
});

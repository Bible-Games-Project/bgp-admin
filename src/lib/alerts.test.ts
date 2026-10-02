import { describe, expect, test } from "bun:test";
import {
  appStoreMessage,
  escapeHtml,
  packMessages,
  reminderThreshold,
  reviewMessage,
  upcomingMessage,
  weeklyMessage,
  weeklySummary,
} from "./alerts";
import type { ReviewDigest } from "./monitor";

const ctx = {
  consoleUrl: "https://console.example",
  appName: (id: string) => ({ eden: "Bible <Story> Game" })[id] ?? "A game",
};
const now = new Date("2026-09-28T08:00:00Z");

const review: ReviewDigest = {
  id: "r1",
  stars: 2,
  recommended: null,
  title: "Crashes",
  text: "It closes <always> & I lose my progress",
  author: "Ana",
  country: "Spain",
  language: null,
  date: "2026-09-28T07:00:00Z",
  waiting: true,
  canReply: true,
  url: null,
};

describe("messages", () => {
  test("escapes everything that comes from outside", () => {
    expect(escapeHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  test("a low review is flagged and links to the reply box", () => {
    const text = reviewMessage({ appId: "eden", store: "app_store", review }, ctx);
    expect(text).toBe(
      [
        "⚠️ ★★☆☆☆  <b>Bible &lt;Story&gt; Game</b>",
        "App Store · Spain",
        "<b>Crashes</b>",
        "It closes &lt;always&gt; &amp; I lose my progress",
        "— Ana",
        '<a href="https://console.example/reviews?app=eden">Reply in the console</a>',
      ].join("\n"),
    );
  });

  test("a Steam review links to Steam", () => {
    const text = reviewMessage(
      {
        appId: "eden",
        store: "steam",
        review: { ...review, stars: null, recommended: true, url: "https://steam/r" },
      },
      ctx,
    );
    expect(text.startsWith("👍 Recommended")).toBe(true);
    expect(text).toContain('<a href="https://steam/r">Reply on Steam</a>');
  });

  test("App Store steps", () => {
    expect(
      appStoreMessage({ kind: "approved", appId: "eden", version: "1.0.75", live: true }, ctx),
    ).toBe("✅ Apple approved <b>Bible &lt;Story&gt; Game</b> 1.0.75. It's live on the App Store.");
    expect(appStoreMessage({ kind: "rejected", appId: "eden", version: "1.0.75" }, ctx)).toContain(
      "❌ Apple rejected",
    );
  });

  test("a rejection says whose job the fix is", () => {
    const rejected = (state: string) =>
      appStoreMessage({ kind: "rejected", appId: "eden", version: "1.0.75", state }, ctx);
    expect(rejected("INVALID_BINARY")).toContain("Apple refused the build");
    expect(rejected("INVALID_BINARY")).toContain("a job for the developer");
    expect(rejected("METADATA_REJECTED")).toContain("Yours to fix in App Store Connect");
    expect(rejected("REJECTED")).toContain("whose job it is");
  });

  test("a reminder says how long is left", () => {
    const text = upcomingMessage(
      {
        id: "x",
        title: "The console's GitHub token expires",
        detail: "Make a new one.",
        date: "2026-10-05",
        daysLeft: 7,
        actions: [],
      },
      ctx,
      now,
    );
    expect(text.split("\n")[0]).toBe(
      "⏰ <b>The console's GitHub token expires</b> in 7 days (2026-10-05).",
    );
  });
});

describe("reminderThreshold", () => {
  test("picks the nearest threshold at or above the days left", () => {
    expect(reminderThreshold(90)).toBeNull();
    expect(reminderThreshold(60)).toBe(60);
    expect(reminderThreshold(45)).toBe(60);
    expect(reminderThreshold(30)).toBe(30);
    expect(reminderThreshold(8)).toBe(30);
    expect(reminderThreshold(7)).toBe(7);
    expect(reminderThreshold(1)).toBe(1);
    expect(reminderThreshold(0)).toBe(1);
  });
});

describe("weekly summary", () => {
  test("adds up the month, the year and the week's reviews", () => {
    const row = (period: string, source: "app_store" | "google_play", netEur: number) => ({
      source,
      period,
      appKey: "k",
      appName: "n",
      productId: "app",
      productName: "Paid download",
      kind: "paid_app" as const,
      units: 1,
      refunds: 0,
      netEur,
      estimated: source === "google_play" && period === "2026-09",
    });
    const summary = weeklySummary({
      now,
      incomeRows: [
        row("2026-09", "app_store", 20),
        row("2026-09", "google_play", 14.1),
        row("2026-08", "app_store", 56.2),
        row("2026-01", "app_store", 10),
        row("2025", "app_store", 100),
      ],
      payments: [{ expenseId: "e", appId: null, date: "2026-03-01", eur: 99 }],
      reviews: [
        { date: "2026-09-27T00:00:00Z", stars: 4, waiting: false },
        { date: "2026-09-26T00:00:00Z", stars: 5, waiting: true },
        { date: "2026-09-01T00:00:00Z", stars: 1, waiting: true },
      ],
    });
    expect(summary.thisMonth.eur).toBeCloseTo(34.1);
    expect(summary.lastMonth).toEqual({ label: "August", eur: 56.2 });
    expect(summary.year.income).toBeCloseTo(100.3);
    expect(summary.year.expenses).toBe(99);
    expect(summary.reviews).toEqual({ count: 2, average: 4.5, waiting: 2 });
    expect(summary.estimated).toBe(true);

    const text = weeklyMessage(summary, ctx);
    expect(text).toContain(
      "September so far: <b>€34.10</b> (App Store €20.00, Google Play €14.10)",
    );
    expect(text).toContain("2026 so far: income €100.30, expenses €99.00, profit <b>€1.30</b>");
  });
});

describe("packMessages", () => {
  test("joins parts up to Telegram's limit", () => {
    expect(packMessages(["a", "b"], 10)).toEqual(["a\n\nb"]);
    expect(packMessages(["aaaa", "bbbb", "cccc"], 10)).toEqual(["aaaa\n\nbbbb", "cccc"]);
    expect(packMessages(["x".repeat(12)], 10)).toEqual([`${"x".repeat(9)}…`]);
    expect(packMessages([])).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { type Expense, type ExpensePayment, periodProfit } from "./expenses";
import {
  type HomeInput,
  attentionItems,
  daysUntil,
  gameHighlights,
  glance,
  needsAppleMembershipExpense,
  profitGlance,
  upcomingItems,
} from "./home";
import type { IncomeRow } from "./income";
import { type CheckRow, type MonitorApp, type ReviewDigest, vitalsFrom } from "./monitor";

const now = new Date("2026-09-30T10:00:00Z");

const apps: MonitorApp[] = [
  {
    id: "eden",
    name: "Bible Story Game",
    ios: "com.biblegames.eden",
    android: "com.biblegames.eden",
    steam: null,
    repo: { owner: "Bible-Games-Project", name: "eden-choice-chronicles" },
  },
  {
    id: "tls",
    name: "The Lost Sheep",
    ios: "com.JoanSabe.TheLostSheep",
    android: "com.JoanSabe.TheLostSheep",
    steam: 2298350,
    repo: null,
  },
];

const row = (key: string, state: unknown, problem: string | null = null): CheckRow => ({
  key,
  ran_at: "2026-09-30T09:50:00Z",
  state,
  problem,
});

const input = (checks: CheckRow[], extra: Partial<HomeInput> = {}): HomeInput => ({
  now,
  apps,
  checks,
  incomeProblems: [],
  expenses: [],
  ...extra,
});

const version = (state: string) => ({
  id: "v1",
  version: "1.0.75",
  state,
  platform: "IOS",
  created: "2026-09-29T10:00:00Z",
});

const digest = (id: string, extra: Partial<ReviewDigest> = {}): ReviewDigest => ({
  id,
  stars: 2,
  recommended: null,
  title: "Crashes on start",
  text: "It closes as soon as it opens.",
  author: "Ana",
  country: "Spain",
  language: null,
  date: "2026-09-29T10:00:00Z",
  waiting: true,
  canReply: true,
  url: null,
  ...extra,
});

describe("daysUntil", () => {
  test("counts calendar days in UTC", () => {
    expect(daysUntil("2026-09-30", now)).toBe(0);
    expect(daysUntil("2026-10-01T23:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-09-29", now)).toBe(-1);
  });
});

describe("attentionItems", () => {
  test("nothing stored, nothing to do", () => {
    expect(attentionItems(input([]))).toEqual([]);
  });

  test("a rejection points at Apple's message and Deploy, errors before warnings", () => {
    const items = attentionItems(
      input([
        row("app_store", {
          apps: {
            eden: { ascId: "6775889176", unresolved: false, versions: [version("REJECTED")] },
            tls: {
              ascId: "6740145333",
              unresolved: false,
              versions: [version("PENDING_DEVELOPER_RELEASE")],
            },
          },
        }),
      ]),
    );
    expect(items.map((i) => i.id)).toEqual(["rejected:eden", "release:tls"]);
    expect(items[0].title).toBe("Apple rejected Bible Story Game 1.0.75");
    expect(items[0].actions[0]).toMatchObject({
      kind: "external",
      href: "https://appstoreconnect.apple.com/apps/6775889176/resolutioncenter",
    });
    expect(items[0].actions[1]).toMatchObject({
      kind: "link",
      to: "/apps/$id",
      search: { tab: "deploy" },
    });
    expect(items[1].actions[0]).toEqual({
      kind: "release",
      label: "Release it now",
      appId: "tls",
      versionId: "v1",
    });
  });

  test("an invalid build is the developer's, and a game built elsewhere has no Deploy button", () => {
    const [item] = attentionItems(
      input([
        row("app_store", {
          apps: {
            tls: { ascId: "6740145333", unresolved: true, versions: [version("INVALID_BINARY")] },
          },
        }),
      ]),
    );
    expect(item.title).toBe("Apple refused the build of The Lost Sheep 1.0.75");
    expect(item.detail).toStartWith("For the developer:");
    expect(item.detail).toContain("built outside the console");
    expect(item.actions).toEqual([
      {
        kind: "external",
        label: "Open App Store Connect",
        href: "https://appstoreconnect.apple.com/apps/6740145333/distribution",
      },
    ]);
  });

  test("a rejected listing is yours, with the Store tab and no new build", () => {
    const [item] = attentionItems(
      input([
        row("app_store", {
          apps: {
            eden: {
              ascId: "6775889176",
              unresolved: true,
              versions: [version("METADATA_REJECTED")],
            },
          },
        }),
      ]),
    );
    expect(item.title).toBe("Apple rejected the store listing of Bible Story Game 1.0.75");
    expect(item.detail).toStartWith("Yours to fix, in App Store Connect");
    expect(item.actions.map((a) => a.label)).toEqual([
      "Read Apple's message",
      "Open the Store tab",
    ]);
  });

  test("a reviewer's rejection of a game built elsewhere sends the code changes to the developer", () => {
    const [item] = attentionItems(
      input([
        row("app_store", {
          apps: {
            tls: { ascId: "6740145333", unresolved: true, versions: [version("REJECTED")] },
          },
        }),
      ]),
    );
    expect(item.detail).toContain("built outside the console");
    expect(item.actions.map((a) => a.label)).toEqual(["Read Apple's message"]);
  });

  test("a failed deploy, a crashing game and low reviews each get an item", () => {
    const items = attentionItems(
      input([
        row("deploys", {
          apps: {
            eden: {
              id: 1,
              status: "completed",
              conclusion: "failure",
              created: "2026-09-29T10:00:00Z",
              url: "https://github.com/run/1",
              title: "Deploy",
            },
          },
        }),
        row("play_vitals", {
          apps: {
            eden: {
              crashes: 6,
              anrs: 1,
              users: 4,
              crashesBefore: 0,
              anrsBefore: 0,
              until: "2026-09-28",
              top: {
                type: "crash",
                cause: "NullPointerException",
                location: "",
                reports: 5,
                url: "https://play",
              },
            },
          },
        }),
        row("reviews_google_play", {
          apps: {
            eden: {
              known: [],
              recent: [
                digest("low"),
                digest("happy", { stars: 5 }),
                digest("answered", { waiting: false }),
              ],
            },
          },
        }),
      ]),
    );
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId["deploy:eden"].title).toBe("The last deploy of Bible Story Game failed");
    expect(byId["deploy:eden"].failedRun).toEqual({
      appId: "eden",
      runId: 1,
      runUrl: "https://github.com/run/1",
      game: "Bible Story Game",
    });
    expect(byId["crashing:eden"].detail).toContain("6 crashes and 1 freeze");
    expect(byId["crashing:eden"].detail).toContain("NullPointerException");
    expect(byId["reviews:eden"].title).toBe(
      "1 low-rated review of Bible Story Game waiting for a reply",
    );
    expect(byId["reviews:eden"].actions[0]).toMatchObject({
      to: "/reviews",
      search: { app: "eden", waiting: "1", sentiment: "negative" },
    });
  });

  test("store report problems and checks that failed are shown with their fix", () => {
    const items = attentionItems(
      input([row("signing", {}, "Apple refused the key.")], {
        incomeProblems: [{ source: "google_play", problem: "Tick View financial data." }],
      }),
    );
    expect(items.map((i) => i.title)).toEqual([
      "Google Play sales reports can't be read",
      "The console couldn't check Apple certificates and profiles",
    ]);
  });

  test("a job that stopped running says so", () => {
    const stale = { ...row("app_store", { apps: {} }), ran_at: "2026-09-30T07:00:00Z" };
    expect(attentionItems(input([stale])).map((i) => i.id)).toContain("monitor-stalled");
  });

  test("an expired profile becomes an error", () => {
    const items = attentionItems(
      input([
        row("signing", {
          certificates: [],
          profiles: [
            { name: "Old", bundleId: "com.biblegames.eden", expires: "2026-09-01T00:00:00Z" },
          ],
        }),
      ]),
    );
    expect(items[0]).toMatchObject({
      severity: "error",
      title: "The App Store profile of Bible Story Game has expired",
    });
  });
});

describe("upcomingItems", () => {
  test("lists each date inside its window, soonest first", () => {
    const expenses: Expense[] = [
      {
        id: "apple",
        name: "Apple Developer Program",
        amount: 99,
        currency: "EUR",
        frequency: "yearly",
        starts_on: "2025-10-20",
        ends_on: null,
        app_id: null,
        notes: null,
      },
    ];
    const items = upcomingItems(
      input(
        [
          row("signing", {
            certificates: [
              { id: "C", type: "DISTRIBUTION", name: "Joan Sabé", expires: "2026-11-15T09:00:00Z" },
            ],
            // The newest profile of a game is the one that counts.
            profiles: [
              { name: "Old", bundleId: "com.biblegames.eden", expires: "2026-10-10T00:00:00Z" },
              { name: "New", bundleId: "com.biblegames.eden", expires: "2027-05-28T00:00:00Z" },
            ],
          }),
          row("console", {
            tokenExpires: "2026-10-05T00:00:00Z",
            backup: null,
            disabled: [],
            pushedAt: "2026-09-30T09:00:00Z",
          }),
          row("android_target", { apps: { eden: 36 } }),
        ],
        { expenses },
      ),
    );
    expect(items.map((i) => [i.id, i.daysLeft])).toEqual([
      ["github-token", 5],
      ["expense:apple:2026-10-20", 20],
      ["certificate:C", 46],
    ]);
  });

  test("a game below the next Android target shows up four months ahead", () => {
    const later = new Date("2027-06-01T00:00:00Z");
    const items = upcomingItems({
      ...input([row("android_target", { apps: { eden: 36 } })]),
      now: later,
    });
    expect(items[0]).toMatchObject({
      id: "target:eden:37",
      title: "Bible Story Game must target Android API 37",
      date: "2027-08-31",
    });
  });
});

describe("the Apple Developer Program reminder", () => {
  const expense = (name: string, extra: Partial<Expense> = {}): Expense => ({
    id: name,
    name,
    amount: 99,
    currency: "EUR",
    frequency: "yearly",
    starts_on: "2025-10-20",
    ends_on: null,
    app_id: null,
    notes: null,
    ...extra,
  });

  test("asks until a yearly expense looks like it", () => {
    expect(needsAppleMembershipExpense([], now)).toBe(true);
    expect(needsAppleMembershipExpense([expense("Claude", { frequency: "monthly" })], now)).toBe(
      true,
    );
    expect(needsAppleMembershipExpense([expense("Apple Developer Program")], now)).toBe(false);
    expect(needsAppleMembershipExpense([expense("Apple", { ends_on: "2026-01-01" })], now)).toBe(
      true,
    );
  });
});

describe("profit, players and games", () => {
  const income = (
    period: string,
    netEur: number,
    estimated = false,
    source: IncomeRow["source"] = "app_store",
  ): IncomeRow => ({
    source,
    period,
    appKey: "com.biblegames.eden",
    appName: "Eden",
    productId: "app",
    productName: "Paid download",
    kind: "paid_app",
    units: 1,
    refunds: 0,
    netEur,
    estimated,
  });
  const payment = (date: string, eur: number | null): ExpensePayment => ({
    expenseId: "e",
    appId: null,
    date,
    eur,
  });
  const apple: Expense = {
    id: "e",
    name: "Apple Developer Program",
    amount: 99,
    currency: "EUR",
    frequency: "yearly",
    starts_on: "2025-11-15",
    ends_on: null,
    app_id: null,
    notes: null,
  };

  test("profit is Revenue's last 12 months, to the cent", () => {
    // now is 2026-09-30, so the 12 months run from Oct 2025 to today.
    const incomeRows = [
      income("2026-09", 40),
      income("2026-09", 5, true, "google_play"),
      income("2025-10", 10),
      // Before the 12 months, and App Store whole-year history: Revenue leaves both out.
      income("2025-09", 1000),
      income("2025", 500),
    ];
    const payments = [payment("2025-11-15", 99), payment("2025-09-20", 30)];
    const p = profitGlance({
      now,
      incomeRows,
      incomeProblems: [],
      incomeCheckedAt: "2026-09-30T09:00:00Z",
      expenses: [apple],
      payments,
    });
    const revenue = periodProfit(incomeRows, payments, "12m", now);
    expect(p).toMatchObject({ preset: "12m", since: "2025-10", estimated: true });
    expect([p.income, p.spent, p.profit]).toEqual([
      revenue.income.netEur,
      revenue.spent,
      revenue.profit,
    ]);
    expect([p.income, p.spent, p.profit]).toEqual([55, 99, -44]);
  });

  test("profit says what may skew it", () => {
    const p = profitGlance({
      now,
      incomeRows: [],
      incomeProblems: [{ source: "google_play" }, { source: "google_play" }],
      incomeCheckedAt: null,
      expenses: [],
      payments: [payment("2026-09-01", null)],
    });
    expect(p).toMatchObject({
      incomplete: ["google_play"],
      noExpenses: true,
      unconvertedCosts: true,
      unread: true,
      estimated: false,
    });
  });

  test("player reviews of the week, and Android crashes by game", () => {
    const g = glance(
      input([
        row("reviews_app_store", {
          apps: {
            eden: {
              known: [],
              recent: [
                digest("a", { stars: 4 }),
                digest("b", { stars: 2, date: "2026-09-10T00:00:00Z" }),
              ],
            },
          },
        }),
        row("play_vitals", {
          apps: {
            tls: { ...vitalsFrom({}, null), crashes: 2, anrs: 1, users: 1 },
            eden: vitalsFrom({}, null),
          },
        }),
      ]),
    );
    expect(g.reviews).toEqual({ week: 1, average: 4, waiting: 2 });
    expect(g.androidCrashes).toEqual({ crashes: 2, anrs: 1, games: ["The Lost Sheep"] });
    expect(glance(input([])).androidCrashes).toBeNull();
  });

  test("games: only what is under way or happened this week, never a problem twice", () => {
    const run = (status: string, conclusion: string | null, created: string) => ({
      id: 1,
      status,
      conclusion,
      created,
      url: "",
      title: "",
    });
    const more: MonitorApp[] = [
      ...apps,
      { id: "quiet", name: "A Quiet Game", ios: "q", android: null, steam: null, repo: null },
      { id: "nope", name: "Rejected Game", ios: "r", android: null, steam: null, repo: null },
    ];
    const games = gameHighlights(
      input(
        [
          row("app_store", {
            apps: {
              eden: { ascId: "1", unresolved: false, versions: [version("READY_FOR_SALE")] },
              tls: { ascId: "2", unresolved: false, versions: [version("WAITING_FOR_REVIEW")] },
              quiet: {
                ascId: "3",
                unresolved: false,
                versions: [version("PREPARE_FOR_SUBMISSION")],
              },
              // In review again, but the submission was rejected: Needs attention has it.
              nope: { ascId: "4", unresolved: true, versions: [version("IN_REVIEW")] },
            },
          }),
          row("deploys", {
            apps: {
              eden: run("completed", "success", "2026-09-28T10:00:00Z"),
              // A failure is a Needs attention item, an old success is old news.
              tls: run("completed", "failure", "2026-09-29T10:00:00Z"),
              quiet: run("completed", "success", "2026-09-01T10:00:00Z"),
            },
          }),
          row("reviews_google_play", {
            apps: { eden: { known: [], recent: [digest("x", { stars: 5 })] } },
          }),
        ],
        { apps: more },
      ),
    );
    expect(games.map((g) => [g.id, g.events.map((e) => e.kind)])).toEqual([
      // Something under way comes first.
      ["tls", ["apple_approval"]],
      ["eden", ["deployed", "player_reviews"]],
    ]);
    expect(games[0].events[0]).toEqual({
      kind: "apple_approval",
      version: "1.0.75",
      state: "WAITING_FOR_REVIEW",
    });
    expect(games[1].events[1]).toEqual({ kind: "player_reviews", count: 1, average: 5 });
  });

  test("a deploy still running counts for a day, then it's stale", () => {
    const deploys = (created: string) =>
      gameHighlights(
        input([
          row("deploys", {
            apps: {
              eden: { id: 1, status: "in_progress", conclusion: null, created, url: "", title: "" },
            },
          }),
        ]),
      );
    expect(deploys("2026-09-30T09:00:00Z")[0].events).toEqual([
      { kind: "deploying", since: "2026-09-30T09:00:00Z" },
    ]);
    expect(deploys("2026-09-27T09:00:00Z")).toEqual([]);
  });
});

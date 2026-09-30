import { describe, expect, test } from "bun:test";
import {
  type AppStoreState,
  type MonitorApp,
  type ReviewsState,
  type VitalsState,
  appStoreEvents,
  appStoreStateFrom,
  backupEvents,
  crashEvents,
  dueChecks,
  failedRecently,
  isCrashing,
  latestRun,
  nextPlayTarget,
  parseTokenExpiry,
  reviewsUpdate,
  signingStateFrom,
  targetSdkOf,
  vitalsFrom,
} from "./monitor";
import type { StoreReview } from "./reviews";

const now = new Date("2026-09-30T10:00:00Z");

const apps: MonitorApp[] = [
  {
    id: "eden",
    name: "Bible Story Game: Sacred Quest",
    ios: "com.biblegames.eden",
    android: "com.biblegames.eden",
    steam: null,
    repo: { owner: "Bible-Games-Project", name: "eden-choice-chronicles" },
  },
  {
    id: "demo",
    name: "Didactic Jesus Game Demo (Android)",
    ios: "com.biblegamesproject.didacticjesusgame",
    android: "com.biblegamesproject.didacticjesusgame",
    steam: null,
    repo: { owner: "Bible-Games-Project", name: "didactic-jesus-game-demo" },
  },
];

describe("dueChecks", () => {
  test("never-run checks first, then the most overdue; recent ones wait", () => {
    const rows = [
      { key: "app_store", ran_at: "2026-09-30T09:40:00Z" }, // 20 min ago, every 15
      { key: "deploys", ran_at: "2026-09-30T09:50:00Z" }, // 10 min ago, every 30
      { key: "signing", ran_at: "2026-09-29T08:00:00Z" }, // 26 h ago, every 24 h
    ];
    const due = dueChecks(rows, now);
    expect(due).not.toContain("deploys");
    expect(due).toContain("app_store");
    expect(due).toContain("signing");
    // Never run: the most overdue of all.
    expect(due.indexOf("reviews_steam")).toBeLessThan(due.indexOf("app_store"));
  });

  test("a check that ran a few seconds short of its interval still runs", () => {
    const due = dueChecks([{ key: "app_store", ran_at: "2026-09-30T09:45:30Z" }], now);
    expect(due).toContain("app_store");
  });

  test("Check now runs everything that hasn't run since it was pressed", () => {
    const rows = [
      { key: "deploys", ran_at: "2026-09-30T09:59:00Z" },
      { key: "app_store", ran_at: "2026-09-30T10:00:05Z" },
    ];
    const due = dueChecks(rows, now, new Date("2026-09-30T10:00:00Z"));
    expect(due).toContain("deploys");
    expect(due).not.toContain("app_store");
  });
});

// GET /v1/apps?include=appStoreVersions, 2026-09-30, trimmed. The demo's bundle ID is a
// prefix of the full game's: Apple's filter would match it, the exact match must not.
const appsPage = {
  data: [
    {
      type: "apps",
      id: "6775889176",
      attributes: { bundleId: "com.biblegames.eden" },
      relationships: {
        appStoreVersions: {
          data: [
            { type: "appStoreVersions", id: "v-old" },
            { type: "appStoreVersions", id: "v-new" },
          ],
        },
      },
    },
    {
      type: "apps",
      id: "6740145520",
      attributes: { bundleId: "com.biblegamesproject.didacticjesusgame.pro" },
      relationships: { appStoreVersions: { data: [{ type: "appStoreVersions", id: "v-pro" }] } },
    },
  ],
  included: [
    {
      type: "appStoreVersions",
      id: "v-old",
      attributes: {
        versionString: "0.1",
        appVersionState: "READY_FOR_DISTRIBUTION",
        appStoreState: "READY_FOR_SALE",
        platform: "IOS",
        createdDate: "2026-06-02T10:00:00-07:00",
      },
    },
    {
      type: "appStoreVersions",
      id: "v-new",
      attributes: {
        versionString: "1.0.74",
        appVersionState: "WAITING_FOR_REVIEW",
        platform: "IOS",
        createdDate: "2026-09-23T10:00:00-07:00",
      },
    },
    {
      type: "appStoreVersions",
      id: "v-pro",
      attributes: { versionString: "1.0.5", appVersionState: "READY_FOR_DISTRIBUTION" },
    },
  ],
};

describe("App Store states", () => {
  test("maps apps by exact bundle ID and sorts versions newest first", () => {
    const state = appStoreStateFrom(appsPage, null, apps);
    expect(Object.keys(state.apps)).toEqual(["eden"]);
    expect(state.apps.eden.ascId).toBe("6775889176");
    expect(state.apps.eden.versions.map((v) => v.version)).toEqual(["1.0.74", "0.1"]);
    expect(state.apps.eden.unresolved).toBe(false);
  });

  test("a submission with unresolved issues marks the app", () => {
    const submissions = {
      data: [
        {
          attributes: { state: "UNRESOLVED_ISSUES" },
          relationships: { app: { data: { type: "apps", id: "6775889176" } } },
        },
      ],
    };
    expect(appStoreStateFrom(appsPage, submissions, apps).apps.eden.unresolved).toBe(true);
  });

  const withState = (state: string, unresolved = false): AppStoreState => ({
    apps: {
      eden: {
        ascId: "1",
        unresolved,
        versions: [{ id: "v", version: "1.0.75", state, platform: "IOS", created: null }],
      },
    },
  });

  test("announces each step of a review", () => {
    expect(appStoreEvents(withState("WAITING_FOR_REVIEW"), withState("IN_REVIEW"))).toEqual([
      { kind: "in_review", appId: "eden", version: "1.0.75" },
    ]);
    expect(appStoreEvents(withState("IN_REVIEW"), withState("READY_FOR_DISTRIBUTION"))).toEqual([
      { kind: "approved", appId: "eden", version: "1.0.75", live: true },
    ]);
    expect(appStoreEvents(withState("IN_REVIEW"), withState("PENDING_APPLE_RELEASE"))).toEqual([
      { kind: "approved", appId: "eden", version: "1.0.75", live: false },
    ]);
    expect(appStoreEvents(withState("PENDING_APPLE_RELEASE"), withState("READY_FOR_SALE"))).toEqual(
      [{ kind: "live", appId: "eden", version: "1.0.75" }],
    );
    expect(appStoreEvents(withState("IN_REVIEW"), withState("PENDING_DEVELOPER_RELEASE"))).toEqual([
      { kind: "waiting_release", appId: "eden", version: "1.0.75" },
    ]);
    expect(appStoreEvents(withState("IN_REVIEW"), withState("REJECTED"))).toEqual([
      { kind: "rejected", appId: "eden", version: "1.0.75" },
    ]);
  });

  test("a rejection seen only on the submission is announced once", () => {
    const events = appStoreEvents(
      withState("PREPARE_FOR_SUBMISSION"),
      withState("PREPARE_FOR_SUBMISSION", true),
    );
    expect(events).toEqual([{ kind: "rejected", appId: "eden", version: "1.0.75" }]);
    expect(appStoreEvents(withState("REJECTED", true), withState("REJECTED", true))).toEqual([]);
  });

  test("the first result and unchanged states announce nothing", () => {
    expect(appStoreEvents(null, withState("IN_REVIEW"))).toEqual([]);
    expect(appStoreEvents(withState("IN_REVIEW"), withState("IN_REVIEW"))).toEqual([]);
  });
});

const review = (id: string, date: string, extra: Partial<StoreReview> = {}): StoreReview => ({
  store: "app_store",
  id,
  stars: 5,
  recommended: null,
  title: "Great",
  text: "Loved it",
  author: "Ana",
  country: "Spain",
  language: null,
  date,
  edited: false,
  version: null,
  device: null,
  hoursPlayed: null,
  reply: null,
  url: null,
  canReply: true,
  ...extra,
});

describe("reviewsUpdate", () => {
  test("a game read for the first time only records its reviews", () => {
    const { state, events } = reviewsUpdate(
      "app_store",
      null,
      null,
      { eden: [review("a", "2026-09-29T10:00:00Z"), review("b", "2025-01-01T10:00:00Z")] },
      now,
    );
    expect(events).toEqual([]);
    expect(state.apps.eden.known.sort()).toEqual(["a", "b"]);
    // Only the last 60 days are kept in full.
    expect(state.apps.eden.recent.map((r) => r.id)).toEqual(["a"]);
  });

  test("announces reviews written since the last run, not old ones scrolling into view", () => {
    const prev: ReviewsState = { apps: { eden: { known: ["a"], recent: [] } } };
    const { events, state } = reviewsUpdate(
      "app_store",
      prev,
      "2026-09-30T09:00:00Z",
      {
        eden: [
          review("new", "2026-09-30T09:30:00Z", { stars: 2 }),
          review("a", "2026-09-29T10:00:00Z"),
          review("old", "2026-08-01T10:00:00Z"),
        ],
      },
      now,
    );
    expect(events.map((e) => e.review.id)).toEqual(["new"]);
    expect(events[0].review.stars).toBe(2);
    expect(state.apps.eden.known).toContain("old");
  });

  test("games not read this time keep their last state", () => {
    const prev: ReviewsState = { apps: { demo: { known: ["x"], recent: [] } } };
    const { state } = reviewsUpdate("app_store", prev, null, { eden: [] }, now);
    expect(state.apps.demo.known).toEqual(["x"]);
  });

  test("a written review with no reply is waiting; a bare rating isn't", () => {
    const { state } = reviewsUpdate(
      "google_play",
      null,
      null,
      {
        eden: [
          review("t", "2026-09-29T10:00:00Z"),
          review("r", "2026-09-29T10:00:00Z", { reply: { text: "Thanks", date: null } }),
          review("s", "2026-09-29T10:00:00Z", { title: "", text: "" }),
        ],
      },
      now,
    );
    const waiting = Object.fromEntries(state.apps.eden.recent.map((r) => [r.id, r.waiting]));
    expect(waiting).toEqual({ t: true, r: false, s: false });
  });
});

describe("deploys", () => {
  // GET /repos/…/actions/workflows/deploy.yml/runs?per_page=1, trimmed.
  const page = {
    workflow_runs: [
      {
        id: 36553001503,
        name: "Deploy",
        display_title: "Deploy",
        status: "completed",
        conclusion: "failure",
        created_at: "2026-09-29T10:02:02Z",
        html_url: "https://github.com/Bible-Games-Project/x/actions/runs/36553001503",
      },
    ],
  };

  test("reads the newest run", () => {
    expect(latestRun(page)).toEqual({
      id: 36553001503,
      status: "completed",
      conclusion: "failure",
      created: "2026-09-29T10:02:02Z",
      url: "https://github.com/Bible-Games-Project/x/actions/runs/36553001503",
      title: "Deploy",
    });
    expect(latestRun({ workflow_runs: [] })).toBeNull();
    expect(latestRun(null)).toBeNull();
  });

  test("a failure counts for two weeks; a cancelled run never does", () => {
    const run = latestRun(page)!;
    expect(failedRecently(run, now)).toBe(true);
    expect(failedRecently(run, new Date("2026-10-20T00:00:00Z"))).toBe(false);
    expect(failedRecently({ ...run, conclusion: "cancelled" }, now)).toBe(false);
    expect(failedRecently({ ...run, status: "in_progress", conclusion: null }, now)).toBe(false);
  });
});

describe("vitals", () => {
  const day = (d: number, type: "CRASH" | "ANR", reports: number, users: number) => ({
    startTime: { year: 2026, month: 9, day: d, timeZone: { id: "America/Los_Angeles" } },
    dimensions: [{ dimension: "reportType", stringValue: type }],
    metrics: [
      { metric: "errorReportCount", decimalValue: { value: String(reports) } },
      { metric: "distinctUsers", decimalValue: { value: String(users) } },
    ],
  });

  test("adds up the last 7 days Google has and the 7 before", () => {
    const counts = {
      rows: [
        day(28, "CRASH", 4, 2),
        day(28, "ANR", 1, 1),
        day(25, "CRASH", 2, 1),
        day(20, "CRASH", 1, 1),
        day(14, "CRASH", 9, 9),
        ...[27, 26, 24, 23, 22, 21, 19, 18, 17, 16, 15].map((d) => day(d, "CRASH", 0, 0)),
      ],
    };
    const issues = {
      errorIssues: [
        {
          type: "CRASH",
          cause: "java.lang.NullPointerException",
          location: "com.x.Main",
          errorReportCount: "5",
          issueUri: "https://play.google.com/console/developers/1/app/2/vitals/crashes/3/details",
        },
        {
          type: "APPLICATION_NOT_RESPONDING",
          cause: "Input dispatching timed out",
          errorReportCount: "1",
        },
      ],
    };
    const v = vitalsFrom(counts, issues);
    expect(v).toMatchObject({
      crashes: 6,
      anrs: 1,
      users: 4,
      crashesBefore: 1,
      anrsBefore: 0,
      until: "2026-09-28",
    });
    expect(v.top?.cause).toBe("java.lang.NullPointerException");
    expect(isCrashing(v)).toBe(true);
  });

  test("no rows means no errors at all (Google leaves them out)", () => {
    const v = vitalsFrom({}, null);
    expect(v).toMatchObject({ crashes: 0, anrs: 0, users: 0, until: null, top: null });
    expect(isCrashing(v)).toBe(false);
  });

  test("one player's crash isn't a problem worth a message", () => {
    expect(isCrashing({ ...vitalsFrom({}, null), crashes: 3, users: 1 })).toBe(false);
  });

  test("announces a game once, when it starts crashing", () => {
    const calm = vitalsFrom({}, null);
    const bad = { ...calm, crashes: 5, users: 3 };
    const prev: VitalsState = { apps: { eden: calm } };
    expect(crashEvents(prev, { apps: { eden: bad } })).toEqual([{ appId: "eden", vitals: bad }]);
    expect(crashEvents({ apps: { eden: bad } }, { apps: { eden: bad } })).toEqual([]);
    expect(crashEvents(null, { apps: { eden: bad } })).toEqual([]);
  });
});

describe("signing", () => {
  test("keeps distribution certificates and App Store profiles", () => {
    const certificates = {
      data: [
        {
          id: "3N2PD77X8M",
          attributes: {
            certificateType: "DEVELOPMENT",
            displayName: "Joan Sabé",
            expirationDate: "2027-09-22T04:29:45.000+00:00",
          },
        },
        {
          id: "ZMWT346862",
          attributes: {
            certificateType: "DISTRIBUTION",
            displayName: "Joan Sabé",
            expirationDate: "2027-05-28T09:43:21.000+00:00",
          },
        },
      ],
    };
    const profiles = {
      data: [
        {
          attributes: {
            name: "Eden Choice Chronicles",
            profileType: "IOS_APP_STORE",
            expirationDate: "2027-05-28T09:43:21.000+00:00",
          },
          relationships: { bundleId: { data: { type: "bundleIds", id: "B1" } } },
        },
      ],
      included: [
        { type: "bundleIds", id: "B1", attributes: { identifier: "com.biblegames.eden" } },
      ],
    };
    expect(signingStateFrom(certificates, profiles)).toEqual({
      certificates: [
        {
          id: "ZMWT346862",
          type: "DISTRIBUTION",
          name: "Joan Sabé",
          expires: "2027-05-28T09:43:21.000+00:00",
        },
      ],
      profiles: [
        {
          name: "Eden Choice Chronicles",
          bundleId: "com.biblegames.eden",
          expires: "2027-05-28T09:43:21.000+00:00",
        },
      ],
    });
  });
});

describe("the console's own jobs", () => {
  test("reads GitHub's token expiry header", () => {
    expect(parseTokenExpiry("2026-12-01 00:00:00 UTC")).toBe("2026-12-01T00:00:00.000Z");
    expect(parseTokenExpiry("2026-12-01 10:00:00 +0100")).toBe("2026-12-01T09:00:00.000Z");
    expect(parseTokenExpiry(null)).toBeNull();
    expect(parseTokenExpiry("soon")).toBeNull();
  });

  test("announces a failed backup once", () => {
    const run = {
      id: 2,
      status: "completed",
      conclusion: "failure",
      created: "2026-09-30T02:43:00Z",
      url: "u",
      title: "Supabase backup",
    };
    const base = { tokenExpires: null, disabled: [], pushedAt: null };
    const prev = { ...base, backup: { ...run, id: 1, conclusion: "success" } };
    expect(backupEvents(prev, { ...base, backup: run })).toEqual([{ run }]);
    expect(backupEvents({ ...base, backup: run }, { ...base, backup: run })).toEqual([]);
    expect(backupEvents(null, { ...base, backup: run })).toEqual([]);
  });
});

describe("Google Play's target API", () => {
  test("reads a Capacitor project's target", () => {
    const gradle = `ext {\n    minSdkVersion = 24\n    compileSdkVersion = 36\n    targetSdkVersion = 36\n}`;
    expect(targetSdkOf(gradle)).toBe(36);
    expect(targetSdkOf("ext {}")).toBeNull();
  });

  test("finds the next requirement a game doesn't meet", () => {
    expect(nextPlayTarget(36)).toEqual({ api: 37, deadline: "2027-08-31" });
    expect(nextPlayTarget(35)).toEqual({ api: 36, deadline: "2026-08-31" });
    expect(nextPlayTarget(40)).toBeNull();
  });
});

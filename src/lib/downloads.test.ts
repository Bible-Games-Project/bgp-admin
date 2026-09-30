import { describe, expect, test } from "bun:test";
import {
  type DownloadRow,
  type DownloadsGame,
  appStoreDownloadRows,
  downloadBuckets,
  gameDownloads,
  installsFile,
  playInstallRows,
  selectDownloadRows,
  storedDownloadRows,
} from "./downloads";
import type { IncomeRow } from "./income";
import type { AscCatalog } from "./income-reports";

const now = new Date("2026-09-30T10:00:00Z");

// SALES / SUMMARY / MONTHLY 2026-08 (vendor 93242306), columns trimmed to the ones read.
// Its totals that month: Eden 70 first downloads (1F) and 4 redownloads (3F), Didactic
// Jesus 4 sales and 10 redownloads, The Lost Sheep 3, and 2 in-app "Lifetime" purchases.
const report = [
  "SKU\tTitle\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tApple Identifier\tParent Identifier",
  "eden\tBible Unlocked: Sacred Stories\t1F\t60\t0\t6775889176\t",
  "eden\tBible Unlocked: Sacred Stories\t1F\t10\t0\t6775889176\t",
  "eden\tBible Unlocked: Sacred Stories\t3F\t4\t0\t6775889176\t",
  "djg\tDidactic Jesus Game - Bible\t1F\t4\t2.06\t6740145520\t",
  "djg\tDidactic Jesus Game - Bible\t3F\t10\t0\t6740145520\t",
  "tls\tThe Lost Sheep - Bible Game\t1F\t3\t1.75\t6740145333\t",
  "lifetime\tLifetime\tIA1\t2\t3.4\t6780000000\teden",
  "djg\tDidactic Jesus Game - Bible\t1F\t-1\t-2.06\t6740145520\t",
].join("\n");

const catalog: AscCatalog = new Map([
  ["eden", { name: "Bible Unlocked", bundleId: "com.biblegames.eden" }],
  ["djg", { name: "Didactic Jesus Game", bundleId: "com.biblegamesproject.didacticjesusgame.pro" }],
  ["6740145333", { name: "The Lost Sheep", bundleId: "com.JoanSabe.TheLostSheep" }],
]);

describe("App Store downloads", () => {
  test("counts first downloads only, per app, refunds aside", () => {
    const rows = appStoreDownloadRows(report, "2026-08", catalog);
    expect(rows.map((r) => [r.appKey, r.downloads])).toEqual([
      ["com.biblegames.eden", 70],
      ["com.biblegamesproject.didacticjesusgame.pro", 4],
      ["com.JoanSabe.TheLostSheep", 3],
    ]);
    expect(rows[0]).toMatchObject({ source: "app_store", period: "2026-08", activeDevices: null });
  });
});

describe("Google Play installs", () => {
  test("reads an overview file's name", () => {
    expect(
      installsFile(
        "stats/installs/installs_com.biblegamesproject.didacticjesusgame_202609_overview.csv",
      ),
    ).toEqual({ packageName: "com.biblegamesproject.didacticjesusgame", month: "2026-09" });
    expect(installsFile("stats/installs/installs_com.x_202609_country.csv")).toBeNull();
  });

  test("adds up daily user installs and keeps the last day's devices", () => {
    // stats/installs/installs_com.biblegamesproject.didacticjesusgame_202609_overview.csv
    const csv = [
      "Date,Package name,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs,Install events,Update events,Uninstall events",
      "2026-09-01,com.biblegamesproject.didacticjesusgame,2,0,0,0,3,3,487,2,0,3",
      "2026-09-03,com.biblegamesproject.didacticjesusgame,4,0,0,0,6,0,484,5,0,1",
      "2026-09-02,com.biblegamesproject.didacticjesusgame,2,0,0,0,3,1,491,2,0,1",
    ].join("\n");
    expect(playInstallRows(csv, "com.biblegamesproject.didacticjesusgame", "2026-09")).toEqual([
      {
        source: "google_play",
        period: "2026-09",
        appKey: "com.biblegamesproject.didacticjesusgame",
        appName: "com.biblegamesproject.didacticjesusgame",
        downloads: 12,
        activeDevices: 484,
      },
    ]);
    expect(playInstallRows("Date,Package name\n", "x", "2026-09")).toEqual([]);
  });
});

const row = (
  source: DownloadRow["source"],
  period: string,
  appKey: string,
  downloads: number,
  activeDevices: number | null = null,
): DownloadRow => ({ source, period, appKey, appName: appKey, downloads, activeDevices });

describe("stored downloads", () => {
  test("a closed App Store month replaces its days", () => {
    const rows = storedDownloadRows([
      {
        source: "app_store",
        report: "day:2026-08-30",
        period: "2026-08",
        version: null,
        rows: [row("app_store", "2026-08", "a", 5)],
      },
      {
        source: "app_store",
        report: "month:2026-08",
        period: "2026-08",
        version: null,
        rows: [row("app_store", "2026-08", "a", 70)],
      },
      {
        source: "app_store",
        report: "day:2026-09-01",
        period: "2026-09",
        version: null,
        rows: [row("app_store", "2026-09", "a", 2)],
      },
      {
        source: "app_store",
        report: "day:2026-09-02",
        period: "2026-09",
        version: null,
        rows: [row("app_store", "2026-09", "a", 3)],
      },
    ]);
    expect(rows.map((r) => [r.period, r.downloads])).toEqual([
      ["2026-08", 70],
      ["2026-09", 5],
    ]);
  });

  test("all time uses the App Store's whole years, months otherwise", () => {
    const rows = [
      row("app_store", "2025", "a", 100),
      row("app_store", "2025-12", "a", 10),
      row("app_store", "2026-01", "a", 7),
      row("google_play", "2025-12", "b", 3),
    ];
    expect(selectDownloadRows(rows, "all", now).map((r) => r.period)).toEqual([
      "2025",
      "2026-01",
      "2025-12",
    ]);
    expect(selectDownloadRows(rows, "year", now).map((r) => r.period)).toEqual(["2026-01"]);
    const buckets = downloadBuckets(selectDownloadRows(rows, "all", now), "all", now);
    expect(buckets).toEqual([
      { bucket: "2025", app_store: 100, google_play: 3 },
      { bucket: "2026", app_store: 7, google_play: 0 },
    ]);
  });
});

describe("gameDownloads", () => {
  const games: DownloadsGame[] = [
    { id: "demo", name: "DJG Demo", keys: { ios: null, android: "djg.demo" }, fullGameId: "full" },
    {
      id: "full",
      name: "DJG Full",
      keys: { ios: "djg.ios", android: "djg.pro" },
      fullGameId: null,
    },
    { id: "eden", name: "Eden", keys: { ios: "eden", android: "eden" }, fullGameId: null },
    { id: "new", name: "New game", keys: { ios: "new", android: "new" }, fullGameId: null },
  ];
  const income = (
    source: IncomeRow["source"],
    appKey: string,
    kind: IncomeRow["kind"],
    units: number,
  ): IncomeRow => ({
    source,
    period: "2026-09",
    appKey,
    appName: appKey,
    productId: kind === "paid_app" ? "app" : "p",
    productName: "",
    kind,
    units,
    refunds: 0,
    netEur: units,
    estimated: false,
  });

  test("works out downloads, devices and who paid", () => {
    const result = gameDownloads(
      games,
      [
        row("google_play", "2026-08", "djg.demo", 40, 480),
        row("google_play", "2026-09", "djg.demo", 60, 490),
        row("google_play", "2026-09", "djg.pro", 5),
        row("app_store", "2026-09", "djg.ios", 4),
        row("app_store", "2026-09", "eden", 70),
      ],
      [
        income("google_play", "djg.pro", "paid_app", 5),
        // Sold on the App Store, where the demo isn't: not the demo's doing.
        income("app_store", "djg.ios", "paid_app", 4),
        income("app_store", "eden", "in_app", 2),
      ],
    );
    const by = Object.fromEntries(result.map((g) => [g.id, g]));
    expect(by.demo).toMatchObject({ google_play: 100, total: 100, activeDevices: 490 });
    expect(by.demo.conversion).toEqual({
      kind: "demo",
      fullGame: "DJG Full",
      sales: 5,
      rate: 0.05,
    });
    expect(by.full.conversion).toEqual({ kind: "paid" });
    expect(by.eden.conversion).toEqual({ kind: "in_app", purchases: 2, rate: 2 / 70 });
    expect(by.new).toMatchObject({ total: 0, conversion: { kind: "none" } });
    // Most downloaded first.
    expect(result.map((g) => g.id)).toEqual(["demo", "eden", "full", "new"]);
  });
});

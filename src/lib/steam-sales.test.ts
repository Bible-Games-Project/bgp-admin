import { describe, expect, test } from "bun:test";
import { addCosts } from "./expenses";
import { byApp, chartBuckets } from "./income";
import { eurConverter } from "./income-reports";
import { storedIncome, supersededReports } from "./income-sync";
import {
  STEAM_DEVELOPER_SHARE,
  SteamFileError,
  type SteamApp,
  type SteamSaleLine,
  matchSteamApp,
  parseAmount,
  parseDay,
  parseSteamReportKey,
  parseSteamSales,
  steamAppKey,
  steamCoverage,
  steamReportKey,
  steamReports,
  unknownSteamGame,
} from "./steam-sales";

// The columns Valve listed for the Sales & Activations CSV ("Changes to Sales &
// Activations CSV", Steamworks Development, 2017-10-03), in its order.
const HEADER =
  "Date,Bundle(ID#),Bundle Name,Product(ID#),Product Name,Type,Game,Platform,Country Code,Country,Region,Gross Units Sold,Chargeback/Returns,Net Units Sold,Base Price,Sale Price,Currency,Gross Steam Sales (USD),Chargeback/Returns (USD),VAT/Tax (USD),Net Steam Sales (USD),Tag";

const line = (cells: Record<string, string | number>) =>
  HEADER.split(",")
    .map((h) => {
      const v = String(cells[h] ?? "");
      return v.includes(",") ? `"${v}"` : v;
    })
    .join(",");

const lostSheep = {
  "Product(ID#)": 824731,
  "Product Name": "The Lost Sheep",
  Type: "Package",
  Game: "The Lost Sheep",
  Platform: "Windows",
  Currency: "EUR",
};

const FILE = [
  "Sales Data for Date Range: 2026-08-01 to 2026-08-31",
  "",
  HEADER,
  line({
    ...lostSheep,
    Date: "2026-08-11",
    "Country Code": "ES",
    "Gross Units Sold": 3,
    "Net Units Sold": 3,
    "Gross Steam Sales (USD)": 17.43,
    "VAT/Tax (USD)": -3.03,
    "Net Steam Sales (USD)": 14.4,
  }),
  line({
    ...lostSheep,
    Date: "2026-08-11",
    "Country Code": "US",
    Platform: "Mac",
    Currency: "USD",
    "Gross Units Sold": 2,
    "Chargeback/Returns": -1,
    "Net Units Sold": 1,
    "Gross Steam Sales (USD)": 9.98,
    "Chargeback/Returns (USD)": -4.99,
    "Net Steam Sales (USD)": 4.99,
  }),
  // A Steam key activated: no money, nothing sold.
  line({ ...lostSheep, Date: "2026-08-12", "Country Code": "ES" }),
  line({
    Date: "2026-08-20",
    "Bundle(ID#)": 41000,
    "Bundle Name": "Bible Games Bundle",
    "Product(ID#)": 743123,
    "Product Name": "Didactic Jesus Game",
    Type: "Package",
    Game: "Didactic Jesus Game",
    "Country Code": "BR",
    "Gross Units Sold": 1,
    "Net Units Sold": 1,
    "Gross Steam Sales (USD)": "1,000.00",
    "Net Steam Sales (USD)": "1,000.00",
  }),
  "Total,,,,,,,,,,,6,-1,5,,,,1027.41,-4.99,-3.03,1019.39,",
  "",
].join("\r\n");

const apps: SteamApp[] = [
  { steamAppId: 2298350, name: "The Lost Sheep" },
  { steamAppId: 2138140, name: "Didactic Jesus Game (Steam)" },
  { steamAppId: 4244150, name: "True Christ" },
];

// One euro buys 1.25 dollars all through August 2026.
const toEur = eurConverter({
  daily: { "2026-08-03": { USD: 1.25 }, "2026-08-04": { USD: 1.25 } },
  latest: {},
});

const gameOf = (l: SteamSaleLine) => {
  const app = matchSteamApp(l, apps);
  return app ? { appKey: steamAppKey(app.steamAppId), appName: app.name } : unknownSteamGame(l);
};

describe("parseSteamSales", () => {
  test("reads Valve's columns under a title line, skipping activations and totals", () => {
    const file = parseSteamSales(FILE, "SalesData.csv");
    expect(file.firstDay).toBe("2026-08-01");
    expect(file.lastDay).toBe("2026-08-31");
    expect(file.lines).toEqual([
      {
        day: "2026-08-11",
        game: "The Lost Sheep",
        productId: "824731",
        productName: "The Lost Sheep",
        type: "Package",
        netUnits: 3,
        returnedUnits: 0,
        netUsd: 14.4,
      },
      {
        day: "2026-08-11",
        game: "The Lost Sheep",
        productId: "824731",
        productName: "The Lost Sheep",
        type: "Package",
        netUnits: 1,
        returnedUnits: 1,
        netUsd: 4.99,
      },
      {
        day: "2026-08-20",
        game: "Didactic Jesus Game",
        productId: "743123",
        productName: "Didactic Jesus Game",
        type: "Package",
        netUnits: 1,
        returnedUnits: 0,
        netUsd: 1000,
      },
    ]);
  });

  test("takes the dates from the file name, else from the first and last sale", () => {
    const body = FILE.split("\r\n").slice(2).join("\n");
    expect(parseSteamSales(body, "SalesData_2026-07-15_to_2026-09-02.csv")).toMatchObject({
      firstDay: "2026-07-15",
      lastDay: "2026-09-02",
    });
    expect(parseSteamSales(body, "sales.csv")).toMatchObject({
      firstDay: "2026-08-11",
      lastDay: "2026-08-20",
    });
  });

  test("only two dates joined as a range count as the file's dates", () => {
    const body = FILE.split("\r\n").slice(2).join("\n");
    const titled = (title: string) => parseSteamSales(`${title}\n${body}`, "sales.csv");
    expect(titled("Generated 2026-11-09. Sales 2026-08-01 to 2026-08-31")).toMatchObject({
      firstDay: "2026-08-01",
      lastDay: "2026-08-31",
    });
    expect(titled("Generated 2026-11-09, 2026-08-01")).toMatchObject({
      firstDay: "2026-08-11",
      lastDay: "2026-08-20",
    });
  });

  test("a file for days with no sales still says which days it covers", () => {
    const file = parseSteamSales(`${HEADER}\n`, "SalesData_2026-10-01_to_2026-10-31.csv");
    expect(file).toEqual({ lines: [], firstDay: "2026-10-01", lastDay: "2026-10-31" });
    expect(() => parseSteamSales(`${HEADER}\n`, "sales.csv")).toThrow(SteamFileError);
  });

  test("works out net sales when the file has only the gross and deductions", () => {
    const header =
      "Date;Game;Gross Units Sold;Chargebacks/Returns;Gross Steam Sales (USD);Chargebacks/Returns (USD);VAT/Tax (USD)";
    // Saved again by a spreadsheet app in Spanish: semicolons and decimal commas.
    const file = parseSteamSales(
      `${header}\n2026-08-02;The Lost Sheep;3;-1;1.017,50;-5,00;-2,50\n`,
    );
    expect(file.lines[0]).toMatchObject({ netUnits: 2, returnedUnits: 1, netUsd: 1010 });
  });

  test("refuses other files and dates it can't be sure of", () => {
    expect(() => parseSteamSales("Date,Units,Developer Proceeds\n2026-08-01,1,2.1\n")).toThrow(
      /isn't Steam's sales file/,
    );
    expect(() =>
      parseSteamSales("Date;Game;Net Steam Sales (USD)\n03/04/2026;The Lost Sheep;4,99\n"),
    ).toThrow(/dates have to look like 2026-03-15/);
    expect(() =>
      parseSteamSales("Date,Game,Net Steam Sales (USD)\n2026-08-01,The Lost Sheep,n/a\n"),
    ).toThrow(/Line 2 .*isn't a number/);
  });

  test("reads Steam's own US dates", () => {
    const file = parseSteamSales("Date,Game,Net Steam Sales (USD)\n8/9/2026,The Lost Sheep,4.99\n");
    expect(file.lines[0].day).toBe("2026-08-09");
  });
});

describe("parseAmount and parseDay", () => {
  test("amounts", () => {
    expect(parseAmount("$1,234.50")).toBe(1234.5);
    expect(parseAmount("(3.20)")).toBe(-3.2);
    expect(parseAmount("-4.99")).toBe(-4.99);
    expect(parseAmount("1.234,50", true)).toBe(1234.5);
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("n/a")).toBeNaN();
  });

  test("days", () => {
    expect(parseDay("2026-02-28", ",")).toBe("2026-02-28");
    expect(parseDay("2026-02-30", ",")).toBeNull();
    expect(parseDay("12/31/2025", ",")).toBe("2025-12-31");
    expect(parseDay("31/12/2025", ",")).toBeNull();
    expect(parseDay("12/31/2025", ";")).toBeNull();
  });
});

describe("matchSteamApp", () => {
  const sale = (game: string, productName = "", productId = ""): SteamSaleLine => ({
    day: "2026-08-01",
    game,
    productId,
    productName,
    type: "Package",
    netUnits: 1,
    returnedUnits: 0,
    netUsd: 1,
  });

  test("by the App ID in the Game column, else by name", () => {
    expect(matchSteamApp(sale("Lost Sheep (2298350)"), apps)?.steamAppId).toBe(2298350);
    expect(matchSteamApp(sale("Didactic Jesus Game"), apps)?.steamAppId).toBe(2138140);
    expect(matchSteamApp(sale("", "TRUE CHRIST"), apps)?.steamAppId).toBe(4244150);
  });

  test("never takes a package ID for an App ID", () => {
    expect(matchSteamApp(sale("Exodus Survivors", "Exodus Survivors", "2298350"), apps)).toBeNull();
    expect(unknownSteamGame(sale("Exodus Survivors (4102420)"))).toEqual({
      appKey: "steam:Exodus Survivors",
      appName: "Exodus Survivors",
    });
  });
});

describe("steamReports", () => {
  const file = parseSteamSales(FILE);
  const { reports, unconverted } = steamReports(file, gameOf, toEur);

  test("one report per day and package, after Valve's share, in euros", () => {
    expect(unconverted).toEqual([]);
    expect(reports.map((r) => r.report)).toEqual([
      "day:2026-08-11 package:824731",
      "day:2026-08-20 package:743123",
    ]);
    const [aug11, aug20] = reports;
    expect(aug11).toMatchObject({ source: "steam", period: "2026-08", version: null });
    expect(aug11.rows).toHaveLength(1);
    expect(aug11.rows[0]).toMatchObject({
      source: "steam",
      period: "2026-08",
      appKey: "steam:2298350",
      appName: "The Lost Sheep",
      productId: "app",
      productName: "Paid download",
      kind: "paid_app",
      units: 4,
      refunds: 1,
      estimated: false,
    });
    expect(aug11.rows[0].netEur).toBeCloseTo(((14.4 + 4.99) * STEAM_DEVELOPER_SHARE) / 1.25, 6);
    expect(aug20.rows[0]).toMatchObject({ appKey: "steam:2138140", units: 1 });
    expect(aug20.rows[0].netEur).toBeCloseTo((1000 * 0.7) / 1.25, 6);
  });

  test("the same file twice gives the same days, so storing it again replaces them", () => {
    expect(steamReports(parseSteamSales(FILE), gameOf, toEur).reports).toEqual(reports);
  });

  test("dollars with no rate are reported, not counted as euros", () => {
    const none = eurConverter({ daily: {}, latest: {} });
    expect(steamReports(file, gameOf, none).unconverted).toEqual(["USD"]);
  });

  test("Revenue adds the days up into the month, next to the other stores", () => {
    const appStore = {
      source: "app_store" as const,
      report: "month:2026-08",
      period: "2026-08",
      version: null,
      unconverted: [],
      rows: [
        {
          source: "app_store" as const,
          period: "2026-08",
          appKey: "com.JoanSabe.TheLostSheep",
          appName: "The Lost Sheep",
          productId: "app",
          productName: "Paid download",
          kind: "paid_app" as const,
          units: 1,
          refunds: 0,
          netEur: 2,
          estimated: false,
        },
      ],
    };
    const all = [...reports, appStore];
    expect(supersededReports(all)).toEqual([]);
    const { rows, unconverted } = storedIncome(all);
    expect(unconverted).toEqual({ app_store: [], google_play: [], steam: [] });
    const steam = rows.filter((r) => r.source === "steam");
    expect(steam.map((r) => r.appKey).sort()).toEqual(["steam:2138140", "steam:2298350"]);

    const [august] = chartBuckets(rows, "month", new Date("2026-08-25T00:00:00Z"));
    const steamEur = steam.reduce((s, r) => s + r.netEur, 0);
    expect(august.steam).toBeCloseTo(steamEur, 6);
    expect(august.app_store).toBe(2);
    const [withCosts] = addCosts([august], [], false);
    expect(withCosts.profit).toBeCloseTo(2 + steamEur, 6);
    expect(byApp(rows).find((a) => a.appKey === "steam:2138140")?.steam).toBeCloseTo(560, 6);
  });
});

describe("report keys", () => {
  const sale = (productId: string, game = "The Lost Sheep"): SteamSaleLine => ({
    day: "2026-08-11",
    game,
    productId,
    productName: game,
    type: "Package",
    netUnits: 1,
    returnedUnits: 0,
    netUsd: 1,
  });

  test("come from the file alone: the package, else the game", () => {
    expect(steamReportKey(sale("824731"))).toBe("day:2026-08-11 package:824731");
    expect(steamReportKey(sale("", "The Lost Sheep"))).toBe("day:2026-08-11 game:thelostsheep");
    expect(steamReportKey(sale("", ""))).toBe("day:2026-08-11 all");
    expect(parseSteamReportKey("day:2026-08-11 package:824731")).toEqual({
      day: "2026-08-11",
      product: "package:824731",
    });
    expect(parseSteamReportKey("month:2026-08")).toBeNull();
  });

  test("the same sale gets the same key whichever game it was matched to", () => {
    const line = sale("824731");
    const keys = (game: { appKey: string; appName: string }) =>
      steamReports(
        { lines: [line], firstDay: line.day, lastDay: line.day },
        () => game,
        toEur,
      ).reports.map((r) => r.report);
    expect(keys({ appKey: "steam:2298350", appName: "The Lost Sheep" })).toEqual(
      keys({ appKey: "steam:The Lost Sheep", appName: "The Lost Sheep" }),
    );
  });
});

describe("steamCoverage", () => {
  const upload = (first_day: string, last_day: string, uploaded_at: string) => ({
    file_name: "SalesData.csv",
    first_day,
    last_day,
    uploaded_at,
  });

  test("nothing uploaded", () => {
    expect(steamCoverage([])).toBeNull();
  });

  test("overlapping files cover one stretch; a hole between them is a gap", () => {
    const first = upload("2022-12-01", "2026-09-30", "2026-10-01T10:00:00Z");
    const second = upload("2026-09-15", "2026-10-31", "2026-11-01T10:00:00Z");
    const third = upload("2026-11-05", "2026-11-08", "2026-11-09T10:00:00Z");
    expect(steamCoverage([second, first])).toEqual({
      latest: second,
      from: "2022-12-01",
      to: "2026-10-31",
      gaps: [],
    });
    expect(steamCoverage([first, second, third])).toEqual({
      latest: third,
      from: "2022-12-01",
      to: "2026-11-08",
      gaps: [{ from: "2026-11-01", to: "2026-11-04" }],
    });
  });
});

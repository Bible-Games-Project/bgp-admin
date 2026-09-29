import { describe, expect, test } from "bun:test";
import { type IncomeRow, byApp, chartBuckets, mergeRows, presetMonths, selectRows } from "./income";
import {
  type AscCatalog,
  appStoreRows,
  eurConverter,
  findZipCsv,
  googlePlayEarningsRows,
  googlePlaySalesRows,
  parseTable,
  pickEarningsFiles,
  reportMonth,
  splitPlayTitle,
} from "./income-reports";

const usdAt = (rate: number) =>
  eurConverter({ daily: { "2026-08-15": { USD: rate } }, latest: {} });

describe("parseTable", () => {
  test("keeps commas inside quoted fields and skips blank lines", () => {
    const rows = parseTable('A,Transaction Date,B\r\nx,"Aug 18, 2026",""\r\n\r\n', ",");
    expect(rows).toEqual([{ A: "x", "Transaction Date": "Aug 18, 2026", B: "" }]);
  });

  test("reads Apple's tab-separated reports, quotes included", () => {
    expect(parseTable('Title\tUnits\nNoah "Ark"\t2\n', "\t")).toEqual([
      { Title: 'Noah "Ark"', Units: "2" },
    ]);
  });
});

describe("eurConverter", () => {
  test("averages the ECB rate over the period", () => {
    const toEur = eurConverter({
      daily: { "2026-08-03": { USD: 1 }, "2026-08-20": { USD: 3 }, "2026-09-01": { USD: 9 } },
      latest: {},
    });
    expect(toEur(4, "USD", "2026-08")).toBe(2);
    expect(toEur(9, "USD", "2026")).toBeCloseTo(9 / (13 / 3));
  });

  test("falls back to today's rate for currencies the ECB lacks", () => {
    const toEur = eurConverter({ daily: { "2026-08-03": { USD: 1 } }, latest: { cop: 4000 } });
    expect(toEur(8000, "COP", "2026-08")).toBe(2);
    expect(toEur(5, "XYZ", "2026-08")).toBeNull();
    expect(toEur(5, "EUR", "2026-08")).toBe(5);
  });
});

describe("appStoreRows", () => {
  const catalog: AscCatalog = new Map([
    ["eden-choice-chronicles-001", { name: "Bible Unlocked", bundleId: "com.biblegames.eden" }],
    ["TheLostSheep001", { name: "The Lost Sheep", bundleId: "com.JoanSabe.TheLostSheep" }],
  ]);
  const report = [
    "SKU\tTitle\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tCurrency of Proceeds\tApple Identifier\tParent Identifier",
    "eden-choice-chronicles-001\tBible Unlocked\t1F\t40\t0.00\tUSD\t6775889176\t ",
    "TheLostSheep001\tThe Lost Sheep - Bible Game\t1F\t2\t2.10\tUSD\t6740145333\t ",
    "TheLostSheep001\tThe Lost Sheep - Bible Game\t1F\t-1\t2.10\tUSD\t6740145333\t ",
    "premium_access\tLifetime\tIA1\t1\t2.33\tEUR\t6776000000\teden-choice-chronicles-001",
  ].join("\n");

  test("counts only sales that earned money, refunds as negative units", () => {
    const { rows, unconverted } = appStoreRows(report, "2026-08", catalog, usdAt(2));
    expect(unconverted).toEqual([]);
    expect(rows).toEqual([
      {
        source: "app_store",
        period: "2026-08",
        appKey: "com.JoanSabe.TheLostSheep",
        appName: "The Lost Sheep",
        productId: "app",
        productName: "Paid download",
        kind: "paid_app",
        estimated: false,
        units: 1,
        refunds: 1,
        netEur: 1.05,
      },
      {
        source: "app_store",
        period: "2026-08",
        appKey: "com.biblegames.eden",
        appName: "Bible Unlocked",
        productId: "premium_access",
        productName: "Lifetime",
        kind: "in_app",
        estimated: false,
        units: 1,
        refunds: 0,
        netEur: 2.33,
      },
    ]);
  });

  test("names currencies it could not convert", () => {
    const { unconverted } = appStoreRows(report, "2026-08", catalog, () => null);
    expect(unconverted).toEqual(["USD", "EUR"]);
  });
});

describe("Google Play", () => {
  test("reportMonth reads both kinds of file name", () => {
    expect(reportMonth("sales/salesreport_202609.zip")).toBe("2026-09");
    expect(reportMonth("earnings/earnings_202511_18821660-1.zip")).toBe("2025-11");
  });

  test("pickEarningsFiles keeps only the current payments profile when both list a month", () => {
    const files = pickEarningsFiles([
      "earnings/earnings_202510_14524613-9.zip",
      "earnings/earnings_202511_14524613-1.zip",
      "earnings/earnings_202511_18821660-1.zip",
      "earnings/earnings_202512_18821660-2.zip",
    ]);
    expect([...files]).toEqual([
      ["2025-10", ["earnings/earnings_202510_14524613-9.zip"]],
      ["2025-11", ["earnings/earnings_202511_18821660-1.zip"]],
      ["2025-12", ["earnings/earnings_202512_18821660-2.zip"]],
    ]);
  });

  test("splitPlayTitle separates an in-app product from its app", () => {
    expect(splitPlayTitle("Unlock Full Game (Bible Unlocked: Sacred Stories)")).toEqual({
      product: "Unlock Full Game",
      app: "Bible Unlocked: Sacred Stories",
    });
  });

  const header =
    "Description,Transaction Date,Transaction Type,Product Title,Package ID,Product Type,Sku Id,Merchant Currency,Amount (Merchant Currency)";

  test("earnings add up everything Google pays, per product", () => {
    const csv = [
      header,
      'GPA.1,"Apr 27, 2026",Charge,Didactic Jesus Game (Full),com.biblegamesproject.pro,Paid app,,EUR,2.97',
      'GPA.1,"Apr 27, 2026",Google fee,Didactic Jesus Game (Full),com.biblegamesproject.pro,Paid app,,EUR,-0.45',
      'GPA.1,"Apr 28, 2026",Charge refund,Didactic Jesus Game (Full),com.biblegamesproject.pro,Paid app,,EUR,-2.97',
      'GPA.1,"Apr 28, 2026",Google fee refund,Didactic Jesus Game (Full),com.biblegamesproject.pro,Paid app,,EUR,0.45',
      'GPA.2,"Apr 29, 2026",Charge,Unlock Full Game (Bible Unlocked: Sacred Stories),com.biblegames.eden,One-time product,premium_access,EUR,3.46',
      'GPA.2,"Apr 29, 2026",Google fee,Unlock Full Game (Bible Unlocked: Sacred Stories),com.biblegames.eden,One-time product,premium_access,EUR,-0.52',
      ',"Apr 30, 2026",Tax,,,,,EUR,-0.27',
    ].join("\n");
    const { rows } = googlePlayEarningsRows(
      csv,
      "2026-04",
      eurConverter({ daily: {}, latest: {} }),
    );
    const brief = rows.map((r) => [
      r.appName,
      r.productName,
      r.kind,
      r.units,
      r.refunds,
      +r.netEur.toFixed(2) || 0,
    ]);
    expect(brief).toEqual([
      ["Didactic Jesus Game (Full)", "Paid download", "paid_app", 0, 1, 0],
      ["Bible Unlocked: Sacred Stories", "Unlock Full Game", "in_app", 1, 0, 2.94],
      ["Google Play account", "Tax", "other", 0, 0, -0.27],
    ]);
  });

  test("estimated sales take Google's 15% fee off the price before tax", () => {
    const csv = [
      "Order Number,Financial Status,Product Title,Package ID,Product Type,SKU ID,Currency of Sale,Item Price,First USD 1M Eligible",
      "GPA.3,Charged,Didactic Jesus Game (Full),com.biblegamesproject.pro,Paid app,,USD,3.49,Yes",
      "GPA.4,Charged,Didactic Jesus Game (Full),com.biblegamesproject.pro,Paid app,,USD,3.49,Yes",
      "GPA.4,Refund,Didactic Jesus Game (Full),com.biblegamesproject.pro,Paid app,,USD,3.49,Yes",
    ].join("\n");
    const [row] = googlePlaySalesRows(csv, "2026-08", usdAt(1)).rows;
    expect(row.estimated).toBe(true);
    expect(row.units).toBe(1);
    expect(row.refunds).toBe(1);
    expect(row.netEur).toBeCloseTo(3.49 * 0.85);
  });
});

describe("findZipCsv", () => {
  test("finds the CSV through the central directory", () => {
    const zip = storedZip("PlayApps_202608.csv", "a,b\n1,2\n");
    const entry = findZipCsv(zip)!;
    expect(entry.method).toBe(0);
    expect(new TextDecoder().decode(entry.data)).toBe("a,b\n1,2\n");
  });
});

const row = (over: Partial<IncomeRow>): IncomeRow => ({
  source: "app_store",
  period: "2026-08",
  appKey: "com.biblegames.eden",
  appName: "Bible Unlocked",
  productId: "app",
  productName: "Paid download",
  kind: "paid_app",
  units: 1,
  refunds: 0,
  netEur: 1,
  estimated: false,
  ...over,
});

describe("selecting and summing rows", () => {
  const now = new Date("2026-09-29T10:00:00Z");
  const rows = [
    row({ period: "2025", netEur: 70 }),
    row({ period: "2025-10", netEur: 5 }),
    row({ period: "2026-08", netEur: 10 }),
    row({ source: "google_play", period: "2025-11", netEur: 9 }),
    row({ source: "google_play", period: "2026-09", netEur: 2, estimated: true }),
  ];

  test("presets cover the right months", () => {
    expect(presetMonths("month", now)).toEqual(["2026-09"]);
    expect(presetMonths("12m", now)?.[0]).toBe("2025-10");
    expect(presetMonths("year", now)).toHaveLength(9);
  });

  test("all time uses Apple's whole-year rows instead of that year's months", () => {
    const all = selectRows(rows, "all", now);
    expect(all.map((r) => r.netEur)).toEqual([70, 10, 9, 2]);
  });

  test("month presets never use whole-year rows", () => {
    expect(selectRows(rows, "12m", now).map((r) => r.netEur)).toEqual([5, 10, 9, 2]);
  });

  test("chartBuckets fills months without sales", () => {
    const buckets = chartBuckets(selectRows(rows, "year", now), "year", now);
    expect(buckets).toHaveLength(9);
    expect(buckets[7]).toEqual({
      bucket: "2026-08",
      app_store: 10,
      google_play: 0,
      estimated: false,
    });
    expect(buckets[8].estimated).toBe(true);
  });

  test("byApp adds both stores and puts account-level items last", () => {
    const apps = byApp([
      row({ appKey: "", appName: "Google Play account", source: "google_play", netEur: -0.3 }),
      row({ netEur: 2 }),
      row({ source: "google_play", netEur: 3 }),
    ]);
    expect(apps.map((a) => [a.appKey, a.app_store, a.google_play, a.netEur])).toEqual([
      ["com.biblegames.eden", 2, 3, 5],
      ["", 0, -0.3, -0.3],
    ]);
  });

  test("mergeRows adds up the same product read day by day", () => {
    const merged = mergeRows([row({ units: 1, netEur: 2 }), row({ units: 2, netEur: 4 })]);
    expect(merged).toEqual([row({ units: 3, netEur: 6 })]);
  });
});

/** A one-file zip with no compression, laid out as Google's report zips are. */
function storedZip(name: string, content: string): Uint8Array {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(name);
  const data = enc.encode(content);
  const local = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const zip = new Uint8Array(local.length + data.length + central.length + end.length);
  zip.set(local, 0);
  zip.set(data, local.length);
  zip.set(central, local.length + data.length);
  zip.set(end, local.length + data.length + central.length);
  return zip;
}

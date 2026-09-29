import { describe, expect, test } from "bun:test";
import { bbcodeToText, describeSteamItem, steamIconUrl } from "./steam.server";

// Trimmed from IStoreBrowseService/GetItems for The Lost Sheep (2298350) and True
// Christ (4244150) on 2026-09-29. The Lost Sheep's store capsules predate Steam's
// 2024 size change (no "_2x" files); True Christ's don't.
const lostSheep = {
  appid: 2298350,
  success: 1,
  name: "The Lost Sheep",
  basic_info: { short_description: "A beautiful, 3rd-person exploration game." },
  assets: {
    asset_url_format: "steam/apps/2298350/${FILENAME}?t=1755004882",
    main_capsule: "capsule_616x353.jpg",
    small_capsule: "capsule_231x87.jpg",
    header: "header.jpg",
    hero_capsule: "hero_capsule.jpg",
    library_capsule: "library_600x900.jpg",
    library_capsule_2x: "library_600x900_2x.jpg",
    library_hero: "library_hero.jpg",
    library_hero_2x: "library_hero_2x.jpg",
    community_icon: "1b3811078e476537576905072e9293c9f69dc404",
  },
  release: { steam_release_date: 1754921572 },
  platforms: { windows: true, mac: true },
  best_purchase_option: { formatted_final_price: "4,99€" },
  reviews: { summary_filtered: { review_count: 4, percent_positive: 75 } },
  screenshots: {
    all_ages_screenshots: [
      { filename: "steam/apps/2298350/ss_b.jpg?t=1755004882", ordinal: 2 },
      { filename: "steam/apps/2298350/ss_a.jpg?t=1755004882", ordinal: 1 },
    ],
    mature_content_screenshots: [{ filename: "steam/apps/2298350/ss_c.jpg?t=1755004882", ordinal: 3 }],
  },
  trailers: { highlights: [{ trailer_name: "Trailer Oficial" }] },
  supported_languages: [
    { elanguage: 0, supported: true, full_audio: true, subtitles: true },
    { elanguage: 5, supported: true, full_audio: true, subtitles: true },
  ],
  full_description_bbcode: "[p][b]The Lost Sheep[/b] is a game.[/p][list][*]Explore[*]Pray[/list]",
};

const trueChrist = {
  appid: 4244150,
  success: 1,
  name: "True Christ",
  is_coming_soon: true,
  basic_info: { short_description: "Experience the life of Jesus." },
  assets: {
    asset_url_format: "steam/apps/4244150/${FILENAME}?t=1765445030",
    header: "09b6/header.jpg",
    header_2x: "09b6/header_2x.jpg",
    main_capsule: "b9d5/capsule_616x353.jpg",
    main_capsule_2x: "b9d5/capsule_616x353_2x.jpg",
  },
  release: { is_coming_soon: true },
  platforms: { windows: true, mac: true },
  reviews: { summary_filtered: { review_count: 0, percent_positive: 0 } },
  supported_languages: [
    { elanguage: 0, supported: true, full_audio: true, subtitles: true },
    { elanguage: 22, supported: false, full_audio: false, subtitles: true },
    { elanguage: 99, supported: true },
  ],
};

describe("describeSteamItem", () => {
  const page = describeSteamItem(lostSheep, lostSheep, "english");

  test("flags the store images still at the pre-2024 size", () => {
    const outdated = page.capsules.filter((c) => c.outdated).map((c) => c.label);
    expect(outdated).toEqual(["Header capsule", "Small capsule", "Main capsule", "Vertical capsule"]);
    expect(page.capsules.find((c) => c.label === "Library hero")?.outdated).toBe(false);
  });

  test("builds image URLs from Steam's asset format", () => {
    expect(page.capsules[0].url).toBe(
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2298350/header.jpg?t=1755004882",
    );
  });

  test("orders screenshots and uses Steam's small thumbnails", () => {
    expect(page.screenshots.map((s) => s.full.split("/").pop())).toEqual([
      "ss_a.jpg?t=1755004882",
      "ss_b.jpg?t=1755004882",
      "ss_c.jpg?t=1755004882",
    ]);
    expect(page.screenshots[0].thumb).toEndWith("ss_a.600x338.jpg?t=1755004882");
  });

  test("reads price, platforms, reviews, languages and trailers", () => {
    expect(page.price).toBe("4,99€");
    expect(page.platforms).toEqual(["Windows", "macOS"]);
    expect(page.reviews).toEqual({ count: 4, percentPositive: 75 });
    expect(page.languages.map((l) => l.label)).toEqual(["English", "Spanish (Spain)"]);
    expect(page.trailers).toEqual(["Trailer Oficial"]);
    expect(page.releaseDate).toStartWith("2025-08-11");
  });

  test("knows when a language only has the English fallback", () => {
    expect(describeSteamItem(lostSheep, lostSheep, "spanish").translated).toBe(false);
    const spanish = { ...lostSheep, basic_info: { short_description: "Un juego de exploración." } };
    expect(describeSteamItem(lostSheep, spanish, "spanish").translated).toBe(true);
  });

  test("a coming-soon game with new-size images", () => {
    const tc = describeSteamItem(trueChrist, trueChrist, "english");
    expect(tc.comingSoon).toBe(true);
    expect(tc.price).toBeNull();
    expect(tc.capsules.some((c) => c.outdated)).toBe(false);
    // Images it never uploaded are not "outdated", just missing.
    expect(tc.capsules.find((c) => c.label === "Vertical capsule")).toMatchObject({ url: null, outdated: false });
    // Unknown language numbers are skipped rather than shown as blanks.
    expect(tc.languages.map((l) => l.api)).toEqual(["english", "brazilian"]);
  });
});

test("bbcodeToText keeps paragraphs and list items", () => {
  expect(bbcodeToText(lostSheep.full_description_bbcode)).toBe("The Lost Sheep is a game.\n\n• Explore\n• Pray");
});

test("steamIconUrl points at the community icon", () => {
  expect(steamIconUrl(lostSheep)).toBe(
    "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/2298350/1b3811078e476537576905072e9293c9f69dc404.jpg",
  );
});

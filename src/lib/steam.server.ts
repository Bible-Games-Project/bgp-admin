/**
 * Steam's public store data, read with IStoreBrowseService/GetItems. It needs no
 * key and answers from Cloudflare Workers (checked 2026-09-29). Steam has no API
 * to change a store page: that is only done on the Steamworks website.
 */

const GET_ITEMS = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1";
const STORE_ASSETS = "https://shared.akamai.steamstatic.com/store_item_assets/";
const COMMUNITY_ICONS = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/";

/** Steam's ELanguage numbers, the name its API expects, and a readable label. */
export const STEAM_LANGUAGES: Record<number, { api: string; label: string }> = {
  0: { api: "english", label: "English" },
  1: { api: "german", label: "German" },
  2: { api: "french", label: "French" },
  3: { api: "italian", label: "Italian" },
  4: { api: "koreana", label: "Korean" },
  5: { api: "spanish", label: "Spanish (Spain)" },
  6: { api: "schinese", label: "Simplified Chinese" },
  7: { api: "tchinese", label: "Traditional Chinese" },
  8: { api: "russian", label: "Russian" },
  9: { api: "thai", label: "Thai" },
  10: { api: "japanese", label: "Japanese" },
  11: { api: "portuguese", label: "Portuguese (Portugal)" },
  12: { api: "polish", label: "Polish" },
  13: { api: "danish", label: "Danish" },
  14: { api: "dutch", label: "Dutch" },
  15: { api: "finnish", label: "Finnish" },
  16: { api: "norwegian", label: "Norwegian" },
  17: { api: "swedish", label: "Swedish" },
  18: { api: "hungarian", label: "Hungarian" },
  19: { api: "czech", label: "Czech" },
  20: { api: "romanian", label: "Romanian" },
  21: { api: "turkish", label: "Turkish" },
  22: { api: "brazilian", label: "Portuguese (Brazil)" },
  23: { api: "bulgarian", label: "Bulgarian" },
  24: { api: "greek", label: "Greek" },
  25: { api: "arabic", label: "Arabic" },
  26: { api: "ukrainian", label: "Ukrainian" },
  27: { api: "latam", label: "Spanish (Latin America)" },
  28: { api: "vietnamese", label: "Vietnamese" },
  29: { api: "indonesian", label: "Indonesian" },
};

export const STEAM_LANGUAGE_NAMES = Object.values(STEAM_LANGUAGES).map((l) => l.api);

/** Found and public. Any other `success` value (15, for one) means Steam has no such page. */
const FOUND = 1;

export async function fetchSteamItem(appId: number, language = "english"): Promise<any | null> {
  const input = {
    ids: [{ appid: appId }],
    // Prices are shown for Spain, where the publisher is.
    context: { language, country_code: "ES" },
    data_request: {
      include_assets: true,
      include_release: true,
      include_platforms: true,
      include_all_purchase_options: true,
      include_screenshots: true,
      include_trailers: true,
      include_reviews: true,
      include_basic_info: true,
      include_supported_languages: true,
      include_full_description: true,
    },
  };
  const res = await fetch(`${GET_ITEMS}?input_json=${encodeURIComponent(JSON.stringify(input))}`, {
    headers: { "User-Agent": "bgp-admin" },
  });
  if (!res.ok) throw new Error(`Steam answered ${res.status}. Try again in a minute.`);
  const json: any = await res.json();
  const item = json?.response?.store_items?.[0];
  return item?.success === FOUND ? item : null;
}

/** Full URL of one of the item's named assets ("header", "main_capsule_2x", …). */
export function steamAssetUrl(item: any, name: string): string | null {
  const file = item?.assets?.[name];
  const format: string | undefined = item?.assets?.asset_url_format;
  if (!file || !format) return null;
  return STORE_ASSETS + format.replace("${FILENAME}", file);
}

export function steamScreenshotUrl(filename: string, thumbnail = false): string {
  const full = STORE_ASSETS + filename;
  return thumbnail ? full.replace(/\.jpg(\?|$)/, ".600x338.jpg$1") : full;
}

/** The small square icon Steam shows in the library and community pages (32×32). */
export function steamIconUrl(item: any): string | null {
  const hash = item?.assets?.community_icon;
  return hash ? `${COMMUNITY_ICONS}${item.appid}/${hash}.jpg` : null;
}

/**
 * The store images Steam asks for today. In August 2024 Steam doubled the store
 * capsules and it has refused the old sizes for new uploads since November 2024.
 * An image uploaded before that has no "_2x" version, which is how an outdated
 * one is spotted.
 */
const CAPSULES = [
  { key: "header", label: "Header capsule", size: "920 × 430" },
  { key: "small_capsule", label: "Small capsule", size: "462 × 174" },
  { key: "main_capsule", label: "Main capsule", size: "1232 × 706" },
  { key: "hero_capsule", label: "Vertical capsule", size: "748 × 896" },
  { key: "library_capsule", label: "Library capsule", size: "600 × 900" },
  { key: "library_hero", label: "Library hero", size: "3840 × 1240" },
] as const;

export type SteamCapsule = {
  label: string;
  size: string;
  url: string | null;
  /** Uploaded at the pre-2024 size: the next upload has to be the size above. */
  outdated: boolean;
};

export type SteamLanguage = {
  api: string;
  label: string;
  interface: boolean;
  audio: boolean;
  subtitles: boolean;
};

export type SteamPage = {
  name: string;
  comingSoon: boolean;
  releaseDate: string | null;
  price: string | null;
  platforms: string[];
  reviews: { count: number; percentPositive: number } | null;
  languages: SteamLanguage[];
  /** The language the texts are in. */
  language: string;
  /** False when Steam fell back to English because the page has no text in `language`. */
  translated: boolean;
  shortDescription: string;
  fullDescription: string;
  capsules: SteamCapsule[];
  screenshots: { thumb: string; full: string }[];
  trailers: string[];
};

/** Steam's store descriptions are BBCode; this keeps the paragraphs and lists as plain text. */
export function bbcodeToText(bbcode: string): string {
  return bbcode
    .replace(/\[\*\]/g, "\n• ")
    .replace(/\[\/(p|h1|h2|h3|list|olist)\]/gi, "\n\n")
    .replace(/\[img[^\]]*\][^[]*\[\/img\]/gi, "[image]")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * `item` is the page read in English (everything but the texts is shown in the
 * console's language); `localized` is the same page read in `language`.
 */
export function describeSteamItem(item: any, localized: any, language: string): SteamPage {
  const english = item.basic_info?.short_description ?? "";
  const shortDescription = localized.basic_info?.short_description ?? "";
  const releaseUnix = item.release?.steam_release_date;
  const reviews = item.reviews?.summary_filtered;
  const screenshots = [
    ...(item.screenshots?.all_ages_screenshots ?? []),
    ...(item.screenshots?.mature_content_screenshots ?? []),
  ].sort((a: any, b: any) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const trailers = [...(item.trailers?.highlights ?? []), ...(item.trailers?.other_trailers ?? [])];

  return {
    name: item.name ?? "",
    comingSoon: Boolean(item.is_coming_soon ?? item.release?.is_coming_soon),
    releaseDate: releaseUnix ? new Date(releaseUnix * 1000).toISOString() : null,
    price: item.best_purchase_option?.formatted_final_price ?? null,
    platforms: [
      item.platforms?.windows && "Windows",
      item.platforms?.mac && "macOS",
      item.platforms?.steamos_linux && "Linux",
    ].filter(Boolean) as string[],
    reviews: reviews
      ? { count: reviews.review_count ?? 0, percentPositive: reviews.percent_positive ?? 0 }
      : null,
    languages: (item.supported_languages ?? [])
      .filter((l: any) => STEAM_LANGUAGES[l.elanguage])
      .map((l: any) => ({
        api: STEAM_LANGUAGES[l.elanguage].api,
        label: STEAM_LANGUAGES[l.elanguage].label,
        interface: Boolean(l.supported),
        audio: Boolean(l.full_audio),
        subtitles: Boolean(l.subtitles),
      })),
    language,
    translated: language === "english" || shortDescription !== english,
    shortDescription,
    fullDescription: bbcodeToText(localized.full_description_bbcode ?? ""),
    capsules: CAPSULES.map((c) => ({
      label: c.label,
      size: c.size,
      url: steamAssetUrl(item, c.key),
      outdated: Boolean(item.assets?.[c.key]) && !item.assets?.[`${c.key}_2x`],
    })),
    screenshots: screenshots.map((s: any) => ({
      thumb: steamScreenshotUrl(s.filename, true),
      full: steamScreenshotUrl(s.filename),
    })),
    trailers: trailers.map((t: any) => t.trailer_name as string).filter(Boolean),
  };
}

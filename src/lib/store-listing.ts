// Shared by the Store tab and its server functions: field limits, the languages each
// store accepts, and small pure helpers. No server-only imports here.

export const ASC_TEXT_FIELDS = [
  "name",
  "subtitle",
  "promotionalText",
  "description",
  "keywords",
  "supportUrl",
  "marketingUrl",
  "privacyPolicyUrl",
] as const;
export type AscTextField = (typeof ASC_TEXT_FIELDS)[number];
export type AscFields = Record<AscTextField, string>;

// Name, subtitle and privacy policy live on the app info; the rest on the version.
export const ASC_INFO_FIELDS: readonly AscTextField[] = ["name", "subtitle", "privacyPolicyUrl"];

export const PLAY_TEXT_FIELDS = ["title", "shortDescription", "fullDescription", "video"] as const;
export type PlayTextField = (typeof PLAY_TEXT_FIELDS)[number];
export type PlayFields = Record<PlayTextField, string>;

export const PLAY_DETAIL_FIELDS = ["contactEmail", "contactWebsite"] as const;
export type PlayDetailField = (typeof PLAY_DETAIL_FIELDS)[number];
export type PlayDetails = Record<PlayDetailField, string>;

/** Character limits each store enforces. URLs are capped at Apple's 255. */
export const ASC_LIMITS: Record<AscTextField, number> = {
  name: 30,
  subtitle: 30,
  promotionalText: 170,
  description: 4000,
  keywords: 100,
  supportUrl: 255,
  marketingUrl: 255,
  privacyPolicyUrl: 255,
};

export const PLAY_LIMITS: Record<PlayTextField, number> = {
  title: 30,
  shortDescription: 80,
  fullDescription: 4000,
  video: 255,
};

// Stores count characters, not UTF-16 code units, so an emoji is one.
export function charCount(value: string): number {
  return [...value].length;
}

/** The fields whose value differs, with the edited value. */
export function changedFields<T extends Record<string, string>>(
  original: T,
  edited: T,
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(edited) as (keyof T)[]) {
    if ((original[key] ?? "") !== (edited[key] ?? "")) out[key] = edited[key];
  }
  return out;
}

/** Fields over their store's limit, by name. */
export function overLimit<K extends string>(
  values: Record<K, string>,
  limits: Record<K, number>,
): K[] {
  return (Object.keys(limits) as K[]).filter((k) => charCount(values[k] ?? "") > limits[k]);
}

// Languages App Store Connect accepts for a listing.
export const ASC_LOCALES = [
  "ar-SA",
  "ca",
  "cs",
  "da",
  "de-DE",
  "el",
  "en-AU",
  "en-CA",
  "en-GB",
  "en-US",
  "es-ES",
  "es-MX",
  "fi",
  "fr-CA",
  "fr-FR",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "ms",
  "nl-NL",
  "no",
  "pl",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sk",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh-Hans",
  "zh-Hant",
] as const;

// Languages Google Play accepts for a store listing.
export const PLAY_LANGUAGES = [
  "af",
  "am",
  "ar",
  "az-AZ",
  "be",
  "bg",
  "bn-BD",
  "ca",
  "cs-CZ",
  "da-DK",
  "de-DE",
  "el-GR",
  "en-AU",
  "en-CA",
  "en-GB",
  "en-IN",
  "en-SG",
  "en-US",
  "en-ZA",
  "es-419",
  "es-ES",
  "es-US",
  "et",
  "eu-ES",
  "fa",
  "fi-FI",
  "fil",
  "fr-CA",
  "fr-FR",
  "gl-ES",
  "gu",
  "hi-IN",
  "hr",
  "hu-HU",
  "hy-AM",
  "id",
  "is-IS",
  "it-IT",
  "iw-IL",
  "ja-JP",
  "ka-GE",
  "kk",
  "km-KH",
  "kn-IN",
  "ko-KR",
  "ky-KG",
  "lo-LA",
  "lt",
  "lv",
  "mk-MK",
  "ml-IN",
  "mn-MN",
  "mr-IN",
  "ms",
  "ms-MY",
  "my-MM",
  "ne-NP",
  "nl-NL",
  "no-NO",
  "pa",
  "pl-PL",
  "pt-BR",
  "pt-PT",
  "rm",
  "ro",
  "ru-RU",
  "si-LK",
  "sk",
  "sl",
  "sq",
  "sr",
  "sv-SE",
  "sw",
  "ta-IN",
  "te-IN",
  "th",
  "tr-TR",
  "uk",
  "ur",
  "vi",
  "zh-CN",
  "zh-HK",
  "zh-TW",
  "zu",
] as const;

/** "English (US)" for "en-US"; the code itself if the runtime has no name for it. */
export function localeLabel(code: string): string {
  // Play still uses the retired "iw" for Hebrew.
  const canonical = code.replace(/^iw\b/, "he");
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language", languageDisplay: "standard" });
    return names.of(canonical) ?? code;
  } catch {
    return code;
  }
}

export function sortByLabel(codes: readonly string[]): string[] {
  return [...codes].sort((a, b) => localeLabel(a).localeCompare(localeLabel(b)));
}

/**
 * The version number to open for editing: one patch above the live version, which Apple
 * accepts as higher. deploy-ios.yml renames the editable version to the real
 * Major.Minor.RunNumber at release time, so this number is only a placeholder.
 */
export function nextVersionString(live: string | null | undefined): string {
  if (!live) return "1.0";
  const parts = live.split(".").map((p) => Number.parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.slice(0, 3).join(".");
}

/** Apple serves screenshots from a template URL; this fills in a thumbnail size. */
export function ascThumbnailUrl(
  asset: { templateUrl?: string; width?: number; height?: number } | null | undefined,
  width = 300,
): string | null {
  if (!asset?.templateUrl) return null;
  const height =
    asset.width && asset.height ? Math.round((width * asset.height) / asset.width) : width * 2;
  return asset.templateUrl
    .replace("{w}", String(width))
    .replace("{h}", String(height))
    .replace("{f}", "png");
}

// App Store screenshot sets by device, most important first. Anything Apple returns that
// is not listed here still shows, under its raw name, after these.
const ASC_DISPLAY_TYPES: [string, string][] = [
  ["APP_IPHONE_67", 'iPhone 6.9"'],
  ["APP_IPHONE_65", 'iPhone 6.5"'],
  ["APP_IPHONE_61", 'iPhone 6.1"'],
  ["APP_IPHONE_58", 'iPhone 5.8"'],
  ["APP_IPHONE_55", 'iPhone 5.5"'],
  ["APP_IPHONE_47", 'iPhone 4.7"'],
  ["APP_IPHONE_40", 'iPhone 4"'],
  ["APP_IPAD_PRO_3GEN_129", 'iPad 13"'],
  ["APP_IPAD_PRO_129", 'iPad Pro 12.9" (2nd gen)'],
  ["APP_IPAD_PRO_3GEN_11", 'iPad 11"'],
  ["APP_IPAD_105", 'iPad 10.5"'],
  ["APP_IPAD_97", 'iPad 9.7"'],
];

export function ascDisplayTypeLabel(type: string): string {
  return ASC_DISPLAY_TYPES.find(([t]) => t === type)?.[1] ?? type;
}

export function ascDisplayTypeRank(type: string): number {
  const i = ASC_DISPLAY_TYPES.findIndex(([t]) => t === type);
  return i === -1 ? ASC_DISPLAY_TYPES.length : i;
}

export const PLAY_IMAGE_TYPES: [string, string][] = [
  ["icon", "App icon"],
  ["featureGraphic", "Feature graphic"],
  ["phoneScreenshots", "Phone screenshots"],
  ["sevenInchScreenshots", '7" tablet screenshots'],
  ["tenInchScreenshots", '10" tablet screenshots'],
];

export type StoreImage = {
  id: string;
  /** Null while the store is still processing an upload. */
  url: string | null;
  /** Apple processes uploads after the fact; a failed one says why. */
  state?: "processing" | "failed";
  error?: string;
};

export type ScreenshotGroup = {
  key: string;
  label: string;
  images: StoreImage[];
};

/**
 * App Store screenshot slots that can be uploaded to, with the portrait sizes Apple
 * accepts (landscape is the same, swapped). The 6.9" iPhone set is the one Apple
 * requires; it scales it down for smaller iPhones. The iPad set is only required when
 * the app runs on iPad. 6.5" is kept for apps that already have screenshots there.
 */
export const ASC_UPLOAD_SLOTS: { type: string; sizes: [number, number][]; always: boolean }[] = [
  {
    type: "APP_IPHONE_67",
    sizes: [
      [1320, 2868],
      [1290, 2796],
      [1260, 2736],
    ],
    always: true,
  },
  {
    type: "APP_IPHONE_65",
    sizes: [
      [1284, 2778],
      [1242, 2688],
    ],
    always: false,
  },
  {
    type: "APP_IPAD_PRO_3GEN_129",
    sizes: [
      [2064, 2752],
      [2048, 2732],
    ],
    always: true,
  },
];

export const ASC_MAX_SCREENSHOTS = 10;

/** Why Apple would refuse this image for the slot, or null when it fits. */
export function ascSizeProblem(type: string, width: number, height: number): string | null {
  const slot = ASC_UPLOAD_SLOTS.find((s) => s.type === type);
  if (!slot) return "Screenshots can't be uploaded to this slot from here.";
  const fits = slot.sizes.some(
    ([w, h]) => (width === w && height === h) || (width === h && height === w),
  );
  if (fits) return null;
  const accepted = slot.sizes.map(([w, h]) => `${w}×${h}`).join(", ");
  return `${width}×${height} doesn't fit ${ascDisplayTypeLabel(type)}. Apple accepts ${accepted} (or the same turned sideways).`;
}

export const PLAY_IMAGE_RULES: Record<
  string,
  { max: number; min?: number; exact?: [number, number]; png?: boolean }
> = {
  icon: { max: 1, min: 1, exact: [512, 512], png: true },
  featureGraphic: { max: 1, min: 1, exact: [1024, 500] },
  phoneScreenshots: { max: 8, min: 2 },
  sevenInchScreenshots: { max: 8 },
  tenInchScreenshots: { max: 8 },
};

/** Why Google Play would refuse this image for the slot, or null when it fits. */
export function playSizeProblem(type: string, width: number, height: number): string | null {
  const rule = PLAY_IMAGE_RULES[type];
  if (!rule) return "Images can't be uploaded to this slot from here.";
  if (rule.exact) {
    const [w, h] = rule.exact;
    return width === w && height === h
      ? null
      : `${width}×${height} doesn't fit. Google Play needs exactly ${w}×${h}.`;
  }
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < 320) return `${width}×${height} is too small. Each side must be at least 320 px.`;
  if (long > 3840) return `${width}×${height} is too big. No side may exceed 3840 px.`;
  if (long > short * 2) {
    return `${width}×${height} is too tall. Google Play refuses screenshots more than twice as long as they are wide.`;
  }
  return null;
}

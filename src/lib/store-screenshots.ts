// "Make screenshots with Claude" on the Store tab: the person uploads real captures of
// the game and says, in their own words, the style they want. Claude can't draw, so it
// answers with a design (background, colours, font, phone frame, decorations) and one
// caption per capture in the listing's language. The browser composes the store images
// from that at the slot's exact size (store-screenshots.render.ts); the person reviews
// them, can edit the captions, and adds them with the usual upload. Like the translation,
// it runs on the build server as a short turn with no repository, in the person's
// 'translate' chat (store-translate.functions.ts), with this file's instructions.
// Pure rules here; the server side is store-screenshots.functions.ts.
import { localeLabel } from "@/lib/store-listing";

export type ScreenshotStore = "ios" | "play";

export const SCREENSHOT_FONTS = ["rounded", "bold", "serif", "playful"] as const;
export type ScreenshotFont = (typeof SCREENSHOT_FONTS)[number];
export const SCREENSHOT_FRAMES = ["phone-dark", "phone-light", "none"] as const;
export type ScreenshotFrame = (typeof SCREENSHOT_FRAMES)[number];
export const SCREENSHOT_DECOR = ["none", "bubbles", "stars", "rays"] as const;
export type ScreenshotDecor = (typeof SCREENSHOT_DECOR)[number];

export type ScreenshotDesign = {
  /** Background gradient, top to bottom (or one colour twice for a flat one). */
  background: [string, string];
  textColor: string;
  accentColor: string;
  font: ScreenshotFont;
  captionPosition: "top" | "bottom";
  frame: ScreenshotFrame;
  decor: ScreenshotDecor;
  /** One per capture, in the order they were given. */
  captions: string[];
};

/** Most stores show about this much of a caption on a phone; longer ones get cut down. */
export const CAPTION_MAX = 60;
/** At most this many captures per request (the stores take 8 or 10 per slot). */
export const MAX_CAPTURES = 10;

export const DEFAULT_DESIGN: Omit<ScreenshotDesign, "captions"> = {
  background: ["#4F8DF7", "#1B3A8C"],
  textColor: "#FFFFFF",
  accentColor: "#FFD54A",
  font: "rounded",
  captionPosition: "top",
  frame: "phone-dark",
  decor: "bubbles",
};

/** The size each slot's images are made at: one Apple or Google accepts, portrait. */
export const SCREENSHOT_SIZES: Record<string, [number, number]> = {
  APP_IPHONE_67: [1290, 2796],
  APP_IPHONE_65: [1284, 2778],
  APP_IPAD_PRO_3GEN_129: [2048, 2732],
  phoneScreenshots: [1080, 1920],
  sevenInchScreenshots: [1200, 1920],
  tenInchScreenshots: [1600, 2560],
};

/** The slot's size, turned sideways when the captures are landscape (both stores take it). */
export function canvasSize(slot: string, landscape: boolean): [number, number] | null {
  const size = SCREENSHOT_SIZES[slot];
  if (!size) return null;
  return landscape ? [size[1], size[0]] : size;
}

export function screenshotsSystemPrompt(): string {
  return [
    "You design app store screenshots for Bible Games Project, a studio that makes Christian games for children and families.",
    "This is not a chat: there is nobody to talk to. Don't use any tool. Answer only with the JSON object asked for, in a ```json block, and nothing else.",
    "You can't see the captures: you get what the person says about each one, if anything, and the store listing. The console composes the images from your design: the capture inside a phone frame, over the background, with your caption above or below it.",
    "Follow the style the person asks for as closely as the design options allow. Pick colours that go together and keep the caption easy to read on the background.",
    `Captions sell the game in a few words a parent or child understands at a glance: short (ideally under 30 characters, never over ${CAPTION_MAX}), no hashtags, no prices, no claims about other apps. Never translate the app's name. Bible names and places use their usual form in the language asked for.`,
  ].join("\n");
}

export type ScreenshotRequest = {
  store: ScreenshotStore;
  appName: string;
  locale: string;
  style: string;
  /** What each capture shows, in order ("" when the person said nothing). */
  notes: string[];
  /** The listing's description in that language, to know what the game is about. */
  about: string;
  /** The design shown now, when the person asks for changes to it. */
  previous?: ScreenshotDesign | null;
};

const ABOUT_MAX = 1500;

/** The message for one design: the request and the options, with the JSON shape to answer. */
export function screenshotsPrompt(req: ScreenshotRequest): string {
  const captures = req.notes.map((note, i) => ({ capture: i + 1, shows: note.trim() || null }));
  const about = req.about.trim().slice(0, ABOUT_MAX);
  const example: ScreenshotDesign = {
    ...DEFAULT_DESIGN,
    captions: req.notes.map((_, i) => `Caption ${i + 1}`),
  };
  return [
    `Design ${req.notes.length} ${req.store === "ios" ? "App Store" : "Google Play"} screenshot${req.notes.length === 1 ? "" : "s"} for the game "${req.appName}". Write the captions in ${localeLabel(req.locale)} (${req.locale}).`,
    "",
    req.previous
      ? "What the person wants changed, in their words:"
      : "The style the person asked for, in their words:",
    `> ${req.style.trim().replace(/\n/g, "\n> ") || "(nothing: pick one that suits the game)"}`,
    "",
    about ? `What the listing says about the game:\n> ${about.replace(/\n/g, "\n> ")}\n` : "",
    "The captures, in order:",
    "```json",
    JSON.stringify(captures, null, 2),
    "```",
    "",
    req.previous
      ? `The design shown now (change only what the person's words ask to change; keep the rest):\n\`\`\`json\n${JSON.stringify(req.previous, null, 2)}\n\`\`\`\n`
      : "",
    "The options:",
    "- background: two colours (#RRGGBB) for a top-to-bottom gradient; the same one twice for a flat colour.",
    "- textColor, accentColor (#RRGGBB): the caption, and the decorations and a highlight behind the caption.",
    `- font: ${SCREENSHOT_FONTS.join(", ")}.`,
    "- captionPosition: top or bottom.",
    `- frame: ${SCREENSHOT_FRAMES.join(", ")} (none shows the capture with rounded corners and a shadow).`,
    `- decor: ${SCREENSHOT_DECOR.join(", ")}.`,
    `- captions: exactly ${req.notes.length}, one per capture, in order.`,
    "",
    "Answer with one JSON object like this one, inside a ```json block:",
    "```json",
    JSON.stringify(example, null, 2),
    "```",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const colour = (value: unknown, fallback: string) =>
  typeof value === "string" && HEX.test(value.trim()) ? value.trim().toUpperCase() : fallback;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === "string" && (options as readonly string[]).includes(value.trim().toLowerCase())
    ? (value.trim().toLowerCase() as T)
    : fallback;

/** A caption cut to fit, at a word if it can. */
export function clampCaption(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if ([...clean].length <= CAPTION_MAX) return clean;
  const cut = [...clean].slice(0, CAPTION_MAX).join("");
  const space = cut.lastIndexOf(" ");
  return (space > CAPTION_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}

export type ParsedDesign = { ok: true; design: ScreenshotDesign } | { ok: false; error: string };

/**
 * Claude's reply → a design the browser can draw. Takes the last ```json block (or the
 * outermost braces); anything missing or not one of the options falls back to the
 * default, and the captions are padded or cut to one per capture.
 */
export function parseScreenshotDesign(
  reply: string | null | undefined,
  count: number,
): ParsedDesign {
  const text = reply ?? "";
  const blocks = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = blocks.length
    ? blocks.reverse()
    : text.includes("{")
      ? [text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)]
      : [];
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.trim());
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const p = parsed as Record<string, unknown>;
    if (!Array.isArray(p.captions)) continue;
    const bg = Array.isArray(p.background) ? p.background : [p.background, p.background];
    const background: [string, string] = [
      colour(bg[0], DEFAULT_DESIGN.background[0]),
      colour(bg[1] ?? bg[0], colour(bg[0], DEFAULT_DESIGN.background[1])),
    ];
    const captions = Array.from({ length: count }, (_, i) =>
      typeof p.captions === "object" && typeof (p.captions as unknown[])[i] === "string"
        ? clampCaption((p.captions as string[])[i])
        : "",
    );
    return {
      ok: true,
      design: {
        background,
        textColor: colour(p.textColor, DEFAULT_DESIGN.textColor),
        accentColor: colour(p.accentColor, DEFAULT_DESIGN.accentColor),
        font: oneOf(p.font, SCREENSHOT_FONTS, DEFAULT_DESIGN.font),
        captionPosition: oneOf(p.captionPosition, ["top", "bottom"] as const, "top"),
        frame: oneOf(p.frame, SCREENSHOT_FRAMES, DEFAULT_DESIGN.frame),
        decor: oneOf(p.decor, SCREENSHOT_DECOR, DEFAULT_DESIGN.decor),
        captions,
      },
    };
  }
  return { ok: false, error: "Claude's answer didn't have the design in it. Try again." };
}

export type Rect = { x: number; y: number; w: number; h: number };

export type ScreenshotLayout = {
  /** Where the caption's lines are centred. */
  caption: Rect;
  /** The phone's body (equal to `screen` when there is no frame). */
  device: Rect;
  /** Where the capture is drawn, keeping its proportions. */
  screen: Rect;
  /** Corner radius of the device and of the screen. */
  deviceRadius: number;
  screenRadius: number;
};

/**
 * Where everything goes on a `width`×`height` image for a capture of `imageW`×`imageH`:
 * the caption takes a band at the top or bottom, and the capture (in its frame) is as
 * big as fits in the rest, centred, keeping its proportions.
 */
export function screenshotLayout(
  width: number,
  height: number,
  imageW: number,
  imageH: number,
  design: Pick<ScreenshotDesign, "captionPosition" | "frame">,
): ScreenshotLayout {
  const short = Math.min(width, height);
  const margin = Math.round(short * 0.06);
  const captionH = Math.round(height * (height >= width ? 0.2 : 0.22));
  const caption: Rect = {
    x: margin,
    y: design.captionPosition === "top" ? margin : height - margin - captionH,
    w: width - margin * 2,
    h: captionH,
  };
  const area: Rect = {
    x: margin,
    y: design.captionPosition === "top" ? margin + captionH + margin / 2 : margin,
    w: width - margin * 2,
    h: height - captionH - margin * 2.5,
  };
  const framed = design.frame !== "none";
  const bezel = framed ? Math.round(short * 0.025) : 0;
  const ratio = imageW > 0 && imageH > 0 ? imageW / imageH : 9 / 19.5;
  // The biggest screen whose frame fits in the area.
  let sw = area.w - bezel * 2;
  let sh = sw / ratio;
  if (sh > area.h - bezel * 2) {
    sh = area.h - bezel * 2;
    sw = sh * ratio;
  }
  const device: Rect = {
    x: Math.round(area.x + (area.w - (sw + bezel * 2)) / 2),
    y: Math.round(design.captionPosition === "top" ? area.y : area.y + area.h - (sh + bezel * 2)),
    w: Math.round(sw + bezel * 2),
    h: Math.round(sh + bezel * 2),
  };
  const screen: Rect = {
    x: device.x + bezel,
    y: device.y + bezel,
    w: Math.round(sw),
    h: Math.round(sh),
  };
  const screenRadius = Math.round(Math.min(sw, sh) * (framed ? 0.07 : 0.05));
  return {
    caption,
    device,
    screen,
    deviceRadius: framed ? screenRadius + bezel : screenRadius,
    screenRadius,
  };
}

/** Whether a turn's context marks it as a screenshot design (for "waiting behind …"). */
export function isScreenshotsContext(context: unknown): boolean {
  return (
    !!context &&
    typeof context === "object" &&
    (context as { purpose?: unknown }).purpose === "screenshots"
  );
}

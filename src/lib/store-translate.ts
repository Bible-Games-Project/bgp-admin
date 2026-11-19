// "Translate with Claude" on the Store tab: when a language is added (or later), Claude
// translates the listing's texts from the primary language, except the app's name, which
// stays as it is to keep the brand. It runs on the build server like Ruben's messages (a
// short turn with no repository), in a chat of kind 'translate', one per person. The
// person reviews the result in the fields and saves it as usual: nothing reaches a store
// from here. Pure rules here; the server side is store-translate.functions.ts.
import { charCount, localeLabel } from "@/lib/store-listing";

export type TranslateStore = "ios" | "play";

/** Translating needs no deep reasoning; a lighter effort keeps it quick and cheap. */
export const TRANSLATE_EFFORT = "medium";

/** The texts Claude translates on each store. Names and links are never sent. */
export const TRANSLATED_FIELDS: Record<TranslateStore, readonly string[]> = {
  ios: ["subtitle", "promotionalText", "description", "keywords"],
  play: ["shortDescription", "fullDescription"],
};

const FIELD_NOTES: Record<string, string> = {
  subtitle: "One short line shown under the app's name.",
  promotionalText: "A short line shown above the description.",
  description: "The full description. Keep its paragraphs, line breaks and lists.",
  keywords:
    "App Store search terms, separated by commas with no spaces. Players never see them. Pick the words people searching in this language would type (localise, don't just translate) and don't repeat words from the app's name.",
  shortDescription: "The first line people read on Google Play.",
  fullDescription: "The full description. Keep its paragraphs, line breaks and lists.",
};

export type TranslationRequest = {
  store: TranslateStore;
  appName: string;
  from: string;
  to: string;
  fields: Record<string, string>;
  limits: Record<string, number>;
};

/** The fields worth sending: the store's translated ones that have text. */
export function fieldsToTranslate(
  store: TranslateStore,
  source: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TRANSLATED_FIELDS[store]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) out[key] = value;
  }
  return out;
}

export function translateSystemPrompt(): string {
  return [
    "You translate app store listings for Bible Games Project, a studio that makes Christian games for children and families.",
    "This is not a chat: there is nobody to talk to. Don't use any tool. Answer only with the JSON object asked for, in a ```json block, and nothing else.",
    "Write natural, warm store copy a native speaker would write, not a word-for-word translation. Keep the meaning, tone, emoji, line breaks and list markers.",
    "Never translate the app's name or other brand names: keep them exactly as written. Bible names and places use their usual form in the target language.",
    "Every value must fit its character limit (characters, not bytes; an emoji is one). If a translation would be longer, shorten it until it fits.",
  ].join("\n");
}

/** The message for one translation: the source texts with their limits, as JSON. */
export function translationPrompt(req: TranslationRequest): string {
  const fields = Object.entries(req.fields).map(([key, text]) => ({
    key,
    limit: req.limits[key],
    note: FIELD_NOTES[key],
    text,
  }));
  return [
    `Translate this ${req.store === "ios" ? "App Store" : "Google Play"} listing of the app "${req.appName}" from ${localeLabel(req.from)} (${req.from}) into ${localeLabel(req.to)} (${req.to}).`,
    `Keep "${req.appName}" untranslated wherever it appears.`,
    "",
    "```json",
    JSON.stringify(fields, null, 2),
    "```",
    "",
    `Answer with one JSON object mapping each key to its ${localeLabel(req.to)} text, e.g. {"${fields[0]?.key ?? "description"}": "…"}, inside a \`\`\`json block.`,
  ].join("\n");
}

export type ParsedTranslation =
  | { ok: true; fields: Record<string, string>; overLimit: string[] }
  | { ok: false; error: string };

/**
 * Claude's reply → the translated fields. Takes the last ```json block (or the outermost
 * braces), keeps only the keys that were asked for, and says which ones are over their
 * limit (the page shows those in red and won't save them until they are shortened).
 */
export function parseTranslation(
  reply: string | null | undefined,
  requested: readonly string[],
  limits: Record<string, number>,
): ParsedTranslation {
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
    const fields: Record<string, string> = {};
    for (const key of requested) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) fields[key] = value.trim();
    }
    if (!Object.keys(fields).length) continue;
    const overLimit = Object.keys(fields).filter(
      (key) => limits[key] !== undefined && charCount(fields[key]) > limits[key],
    );
    return { ok: true, fields, overLimit };
  }
  return { ok: false, error: "Claude's answer didn't have the translation in it. Try again." };
}

/** Whether a turn's context marks it as a store translation (for "waiting behind …"). */
export function isTranslationContext(context: unknown): boolean {
  return (
    !!context &&
    typeof context === "object" &&
    (context as { purpose?: unknown }).purpose === "translate"
  );
}

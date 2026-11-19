import { describe, expect, test } from "bun:test";
import { ASC_LIMITS, PLAY_LIMITS } from "./store-listing";
import {
  fieldsToTranslate,
  isTranslationContext,
  parseTranslation,
  translateSystemPrompt,
  translationPrompt,
} from "./store-translate";

describe("store translation", () => {
  test("sends only the translatable texts that have content, never the name or links", () => {
    expect(
      fieldsToTranslate("ios", {
        name: "Exodus Survivors",
        subtitle: "Escape from Egypt",
        promotionalText: "  ",
        description: "Lead the people…",
        keywords: "bible,moses",
        supportUrl: "https://example.com",
      }),
    ).toEqual({
      subtitle: "Escape from Egypt",
      description: "Lead the people…",
      keywords: "bible,moses",
    });
    expect(
      fieldsToTranslate("play", {
        title: "Exodus Survivors",
        shortDescription: "Escape",
        fullDescription: "Long",
        video: "https://youtube.com/x",
      }),
    ).toEqual({ shortDescription: "Escape", fullDescription: "Long" });
  });

  test("the prompt names both languages, keeps the app name and carries the limits", () => {
    const prompt = translationPrompt({
      store: "ios",
      appName: "Exodus Survivors",
      from: "en-US",
      to: "ca",
      fields: { subtitle: "Escape from Egypt" },
      limits: ASC_LIMITS,
    });
    expect(prompt).toContain("(en-US)");
    expect(prompt).toContain("(ca)");
    expect(prompt).toContain('Keep "Exodus Survivors" untranslated');
    expect(prompt).toContain('"limit": 30');
    expect(translateSystemPrompt()).toContain("Don't use any tool");
  });

  test("reads the last json block and keeps only the requested keys", () => {
    const reply = [
      "Here it is:",
      "```json",
      '{"subtitle": "draft"}',
      "```",
      "```json",
      '{"subtitle": " Fugida d\'Egipte ", "description": "Guia el poble…", "name": "Nope"}',
      "```",
    ].join("\n");
    expect(parseTranslation(reply, ["subtitle", "description"], ASC_LIMITS)).toEqual({
      ok: true,
      fields: { subtitle: "Fugida d'Egipte", description: "Guia el poble…" },
      overLimit: [],
    });
  });

  test("takes bare JSON and flags texts over the store's limit", () => {
    const long = "x".repeat(81);
    expect(
      parseTranslation(`{"shortDescription": "${long}"}`, ["shortDescription"], PLAY_LIMITS),
    ).toEqual({ ok: true, fields: { shortDescription: long }, overLimit: ["shortDescription"] });
  });

  test("an answer without the translation is an error", () => {
    expect(parseTranslation("Sorry, I can't.", ["subtitle"], ASC_LIMITS).ok).toBe(false);
    expect(parseTranslation('```json\n{"other": "x"}\n```', ["subtitle"], ASC_LIMITS).ok).toBe(
      false,
    );
    expect(parseTranslation(null, ["subtitle"], ASC_LIMITS).ok).toBe(false);
  });

  test("recognises a translation turn's context", () => {
    expect(isTranslationContext({ purpose: "translate" })).toBe(true);
    expect(isTranslationContext({ path: "/apps" })).toBe(false);
    expect(isTranslationContext(null)).toBe(false);
  });
});

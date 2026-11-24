import { describe, expect, test } from "bun:test";
import { ascSizeProblem, playSizeProblem } from "./store-listing";
import {
  CAPTION_MAX,
  DEFAULT_DESIGN,
  SCREENSHOT_SIZES,
  canvasSize,
  clampCaption,
  captionPieces,
  designFor,
  isRightToLeft,
  isScreenshotsContext,
  parseScreenshotDesign,
  parseScreenshotDesignAll,
  screenshotLayout,
  screenshotRoom,
  screenshotsAllPrompt,
  screenshotsPrompt,
  screenshotsSystemPrompt,
} from "./store-screenshots";

describe("store screenshots with Claude", () => {
  test("every slot's size is one the store accepts, upright and sideways", () => {
    for (const [slot, [w, h]] of Object.entries(SCREENSHOT_SIZES)) {
      const problem = slot.startsWith("APP_") ? ascSizeProblem : playSizeProblem;
      expect(problem(slot, w, h)).toBeNull();
      expect(problem(slot, h, w)).toBeNull();
    }
    expect(canvasSize("APP_IPHONE_67", true)).toEqual([2796, 1290]);
    expect(canvasSize("icon", false)).toBeNull();
  });

  test("the prompt carries the style, the notes, the language and the app name", () => {
    const prompt = screenshotsPrompt({
      store: "ios",
      appName: "Exodus Survivors",
      locale: "ca",
      style: "sky blue, big yellow letters",
      notes: ["the Red Sea opens", ""],
      about: "Lead the people out of Egypt.",
    });
    expect(prompt).toContain('"Exodus Survivors"');
    expect(prompt).toContain("sky blue, big yellow letters");
    expect(prompt).toContain("the Red Sea opens");
    expect(prompt).toContain("Lead the people out of Egypt.");
    expect(prompt).toContain("(ca)");
    expect(prompt).toContain("exactly 2");
    expect(prompt).not.toContain("The design shown now");
    expect(screenshotsSystemPrompt()).toContain("Don't use any tool");
  });

  test("asking for changes sends the design shown now", () => {
    const prompt = screenshotsPrompt({
      store: "play",
      appName: "X",
      locale: "es-ES",
      style: "text at the bottom",
      notes: [""],
      about: "",
      previous: { ...DEFAULT_DESIGN, captions: ["Hola"] },
    });
    expect(prompt).toContain("What the person wants changed");
    expect(prompt).toContain("The design shown now");
    expect(prompt).toContain('"Hola"');
  });

  test("reads Claude's design and falls back on anything it can't use", () => {
    const reply = [
      "Here it is:",
      "```json",
      JSON.stringify({
        background: ["#87ceeb", "nope"],
        textColor: "#ffffff",
        accentColor: "yellow",
        font: "Playful",
        captionPosition: "bottom",
        frame: "tablet",
        decor: "stars",
        captions: ["Open the sea!", "x".repeat(200), 42],
      }),
      "```",
    ].join("\n");
    const parsed = parseScreenshotDesign(reply, 4);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const d = parsed.design;
    expect(d.background).toEqual(["#87CEEB", "#87CEEB"]);
    expect(d.textColor).toBe("#FFFFFF");
    expect(d.accentColor).toBe(DEFAULT_DESIGN.accentColor);
    expect(d.font).toBe("playful");
    expect(d.captionPosition).toBe("bottom");
    expect(d.frame).toBe(DEFAULT_DESIGN.frame);
    expect(d.decor).toBe("stars");
    expect(d.captions).toHaveLength(4);
    expect(d.captions[0]).toBe("Open the sea!");
    expect([...d.captions[1]].length).toBeLessThanOrEqual(CAPTION_MAX + 1);
    expect(d.captions[2]).toBe("");
    expect(d.captions[3]).toBe("");
  });

  test("an answer without a design is an error", () => {
    expect(parseScreenshotDesign("Sorry, I can't.", 2).ok).toBe(false);
    expect(parseScreenshotDesign('```json\n{"font":"bold"}\n```', 2).ok).toBe(false);
    expect(parseScreenshotDesign(null, 1).ok).toBe(false);
  });

  test("long captions are cut at a word", () => {
    const cut = clampCaption(
      "Guide the people of Israel through the desert and across the Red Sea",
    );
    expect([...cut].length).toBeLessThanOrEqual(CAPTION_MAX + 1);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toContain("  ");
    expect(clampCaption("  Short  one ")).toBe("Short one");
  });

  test("the capture fits inside the image, keeps its shape and leaves room for the caption", () => {
    for (const position of ["top", "bottom"] as const) {
      for (const frame of ["phone-dark", "none"] as const) {
        for (const [iw, ih] of [
          [1170, 2532],
          [2532, 1170],
        ]) {
          const [w, h] = canvasSize("APP_IPHONE_67", iw > ih)!;
          const l = screenshotLayout(w, h, iw, ih, { captionPosition: position, frame });
          expect(l.device.x).toBeGreaterThanOrEqual(0);
          expect(l.device.y).toBeGreaterThanOrEqual(0);
          expect(l.device.x + l.device.w).toBeLessThanOrEqual(w);
          expect(l.device.y + l.device.h).toBeLessThanOrEqual(h);
          expect(Math.abs(l.screen.w / l.screen.h - iw / ih)).toBeLessThan(0.01);
          // The caption band and the device don't overlap.
          if (position === "top")
            expect(l.device.y).toBeGreaterThanOrEqual(l.caption.y + l.caption.h);
          else expect(l.device.y + l.device.h).toBeLessThanOrEqual(l.caption.y);
        }
      }
    }
  });

  test("knows its own turns", () => {
    expect(isScreenshotsContext({ purpose: "screenshots" })).toBe(true);
    expect(isScreenshotsContext({ purpose: "translate" })).toBe(false);
    expect(isScreenshotsContext(null)).toBe(false);
  });

  describe("every language at once", () => {
    const locales = ["en-US", "es-ES", "ca"];

    test("the prompt lists every language, main one first, and asks for captions per code", () => {
      const prompt = screenshotsAllPrompt({
        store: "ios",
        appName: "Exodus Survivors",
        locales,
        style: "sky blue",
        notes: ["the Red Sea opens", ""],
        about: "Lead the people out of Egypt.",
      });
      expect(prompt).toContain('"Exodus Survivors"');
      expect(prompt).toContain("- es-ES:");
      expect(prompt).toContain("- ca:");
      expect(prompt).toContain("(en-US) first");
      expect(prompt).toContain("each with exactly 2 captions");
      expect(prompt).toContain("with all 3 languages");
      expect(prompt).toContain("the Red Sea opens");
      expect(prompt).not.toContain("The design shown now");
    });

    test("asking for changes sends every language's captions", () => {
      const prompt = screenshotsAllPrompt({
        store: "play",
        appName: "X",
        locales: ["en-US", "ca"],
        style: "text at the bottom",
        notes: [""],
        about: "",
        previous: { ...DEFAULT_DESIGN, captions: { "en-US": ["Hi"], ca: ["Hola"] } },
      });
      expect(prompt).toContain("change it in every language");
      expect(prompt).toContain('"Hola"');
    });

    test("a reply gives the look and the captions per language, padded and matched loosely", () => {
      const reply = [
        "Here it is:",
        "```json",
        JSON.stringify({
          background: ["#112233", "#445566"],
          font: "PLAYFUL",
          frame: "none",
          captions: {
            "en-us": ["Cross the sea", "Find manna"],
            es_ES: ["Cruza el mar"],
            ca: ["Creua el mar", "Troba el mannà"],
          },
        }),
        "```",
      ].join("\n");
      const r = parseScreenshotDesignAll(reply, 2, locales);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.design.background).toEqual(["#112233", "#445566"]);
      expect(r.design.font).toBe("playful");
      expect(r.design.frame).toBe("none");
      expect(r.design.captions["en-US"]).toEqual(["Cross the sea", "Find manna"]);
      expect(r.design.captions["es-ES"]).toEqual(["Cruza el mar", ""]);
      expect(r.missing).toEqual(["es-ES"]);
      expect(designFor(r.design, "ca")).toEqual({
        ...r.design,
        captions: ["Creua el mar", "Troba el mannà"],
      });
    });

    test("a reply without captions per language is refused", () => {
      expect(parseScreenshotDesignAll('```json\n{"captions":["a"]}\n```', 1, locales).ok).toBe(
        false,
      );
      expect(parseScreenshotDesignAll('{"captions":{"de-DE":["a"]}}', 1, locales).ok).toBe(false);
      expect(parseScreenshotDesignAll("no", 1, locales).ok).toBe(false);
    });

    test("room in a slot: what fits next to the ones there, or all when replacing", () => {
      expect(screenshotRoom(10, 0, 5, false)).toBe(5);
      expect(screenshotRoom(10, 7, 5, false)).toBe(3);
      expect(screenshotRoom(10, 10, 5, false)).toBe(0);
      expect(screenshotRoom(8, 8, 10, true)).toBe(8);
    });
  });

  test("captions break at spaces, or between characters in Chinese and Japanese", () => {
    const join = (t: string) => captionPieces(t).map((p) => p.join + p.text);
    expect(join("Cross  the sea")).toEqual(["Cross", " the", " sea"]);
    expect(join("ノアの箱舟！")).toEqual(["ノ", "ア", "の", "箱", "舟！"]);
    expect(join("Gospi Kids で遊ぼう")).toEqual(["Gospi", " Kids", " で", "遊", "ぼ", "う"]);
    expect(isRightToLeft("أبحر مع سفينة نوح!")).toBe(true);
    expect(isRightToLeft("¡Navega!")).toBe(false);
  });
});

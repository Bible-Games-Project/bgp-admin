import { describe, expect, test } from "bun:test";
import {
  ASC_LIMITS,
  ASC_LOCALES,
  PLAY_LANGUAGES,
  ascSizeProblem,
  ascThumbnailUrl,
  changedFields,
  charCount,
  localeLabel,
  nextVersionString,
  overLimit,
  playSizeProblem,
} from "./store-listing";
import { describeAppleError } from "./asc.server";

describe("charCount", () => {
  test("counts an emoji as one character, as the stores do", () => {
    expect(charCount("Noah 🐑")).toBe(6);
  });
});

describe("changedFields", () => {
  test("returns only the fields whose value differs", () => {
    expect(changedFields({ a: "1", b: "2" }, { a: "1", b: "3" })).toEqual({ b: "3" });
  });

  test("returns nothing when the draft matches", () => {
    expect(changedFields({ a: "x" }, { a: "x" })).toEqual({});
  });
});

describe("overLimit", () => {
  test("names the fields past their limit", () => {
    const values = Object.fromEntries(Object.keys(ASC_LIMITS).map((k) => [k, ""])) as Record<
      keyof typeof ASC_LIMITS,
      string
    >;
    values.name = "x".repeat(31);
    values.subtitle = "x".repeat(30);
    expect(overLimit(values, ASC_LIMITS)).toEqual(["name"]);
  });
});

describe("nextVersionString", () => {
  test("bumps the patch of the live version", () => {
    expect(nextVersionString("1.2.45")).toBe("1.2.46");
  });

  test("adds a patch to a two-part version", () => {
    expect(nextVersionString("1.2")).toBe("1.2.1");
  });

  test("starts at 1.0 without a live version", () => {
    expect(nextVersionString(null)).toBe("1.0");
  });
});

describe("ascThumbnailUrl", () => {
  test("fills Apple's template with a proportional size", () => {
    expect(
      ascThumbnailUrl({
        templateUrl: "https://is1.mzstatic.com/image/{w}x{h}bb.{f}",
        width: 1290,
        height: 2796,
      }),
    ).toBe("https://is1.mzstatic.com/image/300x650bb.png");
  });

  test("is null while the upload is still processing", () => {
    expect(ascThumbnailUrl(null)).toBeNull();
  });
});

describe("localeLabel", () => {
  test("names a regional code", () => {
    // The exact wording ("United States" or "US") depends on the runtime's ICU data.
    expect(localeLabel("en-US")).toMatch(/^English \((United States|US)\)$/);
  });

  test("maps Play's retired Hebrew code", () => {
    expect(localeLabel("iw-IL")).toStartWith("Hebrew");
  });

  test("every catalog code gets a name, not the raw code", () => {
    for (const code of [...ASC_LOCALES, ...PLAY_LANGUAGES]) {
      expect(localeLabel(code)).not.toBe(code);
    }
  });
});

describe("describeAppleError", () => {
  test("spells out associated errors", () => {
    const body = JSON.stringify({
      errors: [
        {
          title: "The request entity is not valid.",
          detail: "An attribute value is invalid.",
          meta: {
            associatedErrors: {
              "/v1/appInfoLocalizations/abc": [
                { title: "Name is already in use", detail: "Choose another name." },
              ],
            },
          },
        },
      ],
    });
    expect(describeAppleError(body)).toBe(
      "The request entity is not valid. — An attribute value is invalid.\n• Name is already in use — Choose another name.",
    );
  });

  test("falls back to the raw text when it is not JSON", () => {
    expect(describeAppleError("Bad Gateway")).toBe("Bad Gateway");
  });
});

describe("ascSizeProblem", () => {
  test("accepts Apple's 6.9-inch sizes, portrait and landscape", () => {
    expect(ascSizeProblem("APP_IPHONE_67", 1290, 2796)).toBeNull();
    expect(ascSizeProblem("APP_IPHONE_67", 2868, 1320)).toBeNull();
  });

  test("says which sizes fit when one doesn't", () => {
    const problem = ascSizeProblem("APP_IPHONE_67", 1080, 1920);
    expect(problem).toContain("1080×1920");
    expect(problem).toContain("1320×2868");
  });

  test("refuses slots it can't upload to", () => {
    expect(ascSizeProblem("APP_WATCH_ULTRA", 410, 502)).not.toBeNull();
  });
});

describe("playSizeProblem", () => {
  test("needs the icon at exactly 512×512", () => {
    expect(playSizeProblem("icon", 512, 512)).toBeNull();
    expect(playSizeProblem("icon", 1024, 1024)).toContain("512×512");
  });

  test("accepts a 9:16 phone screenshot", () => {
    expect(playSizeProblem("phoneScreenshots", 1080, 1920)).toBeNull();
  });

  test("refuses a screenshot more than twice as tall as it is wide", () => {
    expect(playSizeProblem("phoneScreenshots", 1080, 2400)).toContain("too tall");
  });

  test("refuses sides under 320 or over 3840 px", () => {
    expect(playSizeProblem("phoneScreenshots", 300, 500)).toContain("too small");
    expect(playSizeProblem("tenInchScreenshots", 2000, 4000)).toContain("too big");
  });
});

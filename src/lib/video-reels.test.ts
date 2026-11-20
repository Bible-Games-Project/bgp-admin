import { describe, expect, test } from "bun:test";
import {
  REELS_BLOCK_DOCS,
  REELS_BRIEF_PURPOSE,
  briefIsDue,
  buildBriefPrompt,
  isReelsBrief,
  videoUrl,
  mondayOf,
  nextWeekOf,
  parseReelPlan,
  reelDays,
  weeklyBriefPrompt,
} from "./video-reels";
import { videoSystemPrompt } from "./videos";

const reel = (day: string, extra: Record<string, unknown> = {}) => ({
  day,
  title: `Reel ${day}`,
  hook: "Moses lifts his staff",
  script: "0–2 s: hook\n2–20 s: gameplay",
  voiceover: "Can you cross the sea?",
  caption: "Play now",
  hashtags: ["#bible", "games"],
  ...extra,
});
const block = (value: unknown) =>
  `Here is next week.\n\n\`\`\`reels\n${JSON.stringify(value)}\n\`\`\``;

describe("weekly reels", () => {
  test("weeks start on Monday, and the brief plans the next one", () => {
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // Sunday
    expect(mondayOf("2026-11-16")).toBe("2026-11-16");
    expect(mondayOf(new Date("2026-11-19T23:30:00Z"))).toBe("2026-11-16");
    // Sunday night, when the Cron Trigger runs
    expect(nextWeekOf(new Date("2026-11-22T20:00:00Z"))).toBe("2026-11-23");
    expect(nextWeekOf(new Date("2026-11-19T10:00:00Z"))).toBe("2026-11-23");
  });

  test("one reel every other day", () => {
    expect(reelDays("2026-11-23")).toEqual([
      "2026-11-23",
      "2026-11-25",
      "2026-11-27",
      "2026-11-29",
    ]);
  });

  test("the brief names the days and carries the format, or falls back to the conversation's", () => {
    const withFormat = weeklyBriefPrompt("2026-11-23", "  15 seconds, Catalan voice  ");
    expect(withFormat).toContain("Monday 23 November");
    expect(withFormat).toContain("Sunday 29 November");
    expect(withFormat).toContain("Our reel format:\n15 seconds, Catalan voice");
    expect(weeklyBriefPrompt("2026-11-23", "")).toContain("haven't set a reel format");
  });

  test("a reels block becomes the plan", () => {
    const plan = parseReelPlan(block([reel("2026-11-23"), reel("2026-11-25")]));
    expect(plan).toHaveLength(2);
    expect(plan![0]).toEqual({
      publishOn: "2026-11-23",
      title: "Reel 2026-11-23",
      hook: "Moses lifts his staff",
      script: "0–2 s: hook\n2–20 s: gameplay",
      voiceover: "Can you cross the sea?",
      caption: "Play now",
      hashtags: ["#bible", "#games"],
      video: "",
    });
    // An object with a reels list, hashtags as one string
    expect(
      parseReelPlan(block({ reels: [reel("2026-11-27", { hashtags: "#a b" })] }))![0].hashtags,
    ).toEqual(["#a", "#b"]);
  });

  test("no block, broken JSON, or reels without a day or title: no plan", () => {
    expect(parseReelPlan(null)).toBeNull();
    expect(parseReelPlan("Just talking about reels.")).toBeNull();
    expect(parseReelPlan("```reels\n[{]\n```")).toBeNull();
    expect(
      parseReelPlan(block([reel("next monday"), reel("2026-11-23", { title: " " })])),
    ).toBeNull();
    expect(parseReelPlan(block([reel("2026-11-23"), { day: "2026-11-25" }]))).toHaveLength(1);
  });

  test("never more than a week of reels", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      reel(`2026-11-${String(10 + i).padStart(2, "0")}`),
    );
    expect(parseReelPlan(block(many))).toHaveLength(7);
  });

  test("the brief is due only when weekly reels are on and next week has no plan", () => {
    expect(briefIsDue(null, 0)).toBe(false);
    expect(briefIsDue({ weekly_reels: false }, 0)).toBe(false);
    expect(briefIsDue({ weekly_reels: true }, 0)).toBe(true);
    expect(briefIsDue({ weekly_reels: true }, 4)).toBe(false);
  });

  test("Claude is told how to hand over a plan", () => {
    expect(videoSystemPrompt()).toContain(REELS_BLOCK_DOCS);
    expect(videoSystemPrompt()).toContain("weekly brief");
  });
});

describe("weekly reels in the Build chat", () => {
  test("the brief asks for finished videos in the repo, posted nowhere, and a reels block", () => {
    const prompt = buildBriefPrompt(
      "2026-11-23",
      " 15 s, Catalan voice ",
      "https://bgp-exodus.pages.dev",
    );
    expect(prompt).toContain("Monday 23 November");
    expect(prompt).toContain("Our reel format:\n15 s, Catalan voice");
    expect(prompt).toContain("public/shorts/");
    expect(prompt).toContain("Don't post or schedule anything");
    expect(prompt).toContain("https://bgp-exodus.pages.dev");
    expect(prompt).toContain("language `reels`");
    expect(prompt).toContain('"video"');
    expect(prompt).not.toContain("\n\n\n");
    expect(buildBriefPrompt("2026-11-23", "", null)).toContain("already follows for its shorts");
  });

  test("only the brief's own Build messages keep reels", () => {
    expect(isReelsBrief({ purpose: REELS_BRIEF_PURPOSE, weekOf: "2026-11-23" })).toBe(true);
    expect(isReelsBrief({ purpose: "screenshots" })).toBe(false);
    expect(isReelsBrief(null)).toBe(false);
    expect(isReelsBrief("reels")).toBe(false);
  });

  test("a reel's video is put on the game's preview", () => {
    const preview = "https://bgp-bible-rpg.pages.dev";
    expect(videoUrl("shorts/eden-naming.mp4", preview)).toBe(`${preview}/shorts/eden-naming.mp4`);
    expect(videoUrl("public/shorts/eden naming.mp4", preview)).toBe(
      `${preview}/shorts/eden%20naming.mp4`,
    );
    expect(videoUrl("/shorts/a.mp4", `${preview}/`)).toBe(`${preview}/shorts/a.mp4`);
    expect(videoUrl(`${preview}/shorts/a.mp4`, null)).toBe(`${preview}/shorts/a.mp4`);
    expect(videoUrl("http://example.com/a.mp4", preview)).toBeNull();
    expect(videoUrl("javascript:alert(1)", preview)).toBeNull();
    expect(videoUrl("../secrets.mp4", preview)).toBeNull();
    expect(videoUrl("shorts/a.mp4", null)).toBeNull();
    expect(videoUrl("  ", preview)).toBeNull();
  });

  test("the reels block keeps each reel's video", () => {
    const reels = parseReelPlan(
      block([reel("2026-11-23", { video: "shorts/a.mp4" }), reel("2026-11-25")]),
    );
    expect(reels?.map((r) => r.video)).toEqual(["shorts/a.mp4", ""]);
  });
});

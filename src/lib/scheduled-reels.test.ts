import { describe, expect, test } from "bun:test";
import {
  networkName,
  numbersLabel,
  pickedReelsMessage,
  postTimeLabel,
  readChannel,
  scheduledPostDays,
  scheduledReels,
} from "./scheduled-reels";

const channel = {
  account: "team@example.com",
  profile: "Brand_1_RPG",
  timezone: "Europe/Madrid",
};
const entry = (
  id: string,
  at: string,
  platforms: string[],
  extra: Record<string, unknown> = {},
) => ({
  id,
  at,
  title: `Did you know ${id}? #Shorts`,
  platforms,
  job: "x",
  account: "team@example.com",
  profile: "Brand_1_RPG",
  ...extra,
});
const now = new Date("2026-11-20T20:00:00Z");
const preview = "https://bgp-bible-rpg.pages.dev/";

describe("scheduled reels", () => {
  test("lists the upcoming posts in order, with their video on the preview", () => {
    const r = scheduledReels(
      [
        entry("eden-rib", "2026-11-24T17:00:00.000Z", ["youtube", "instagram"], {
          title: "Did you know Eve was made from Adam's rib? 🦴 | Bible Story #Shorts",
        }),
        entry("eden-naming", "2026-11-22T17:00:00.000Z", ["youtube", "tiktok"]),
      ],
      channel,
      preview,
      now,
    );
    expect(r.upcoming.map((p) => p.id)).toEqual(["eden-naming", "eden-rib"]);
    expect(r.upcoming[1].title).toBe("Did you know Eve was made from Adam's rib? 🦴");
    expect(r.upcoming[0]).toEqual({
      id: "eden-naming",
      number: null,
      title: "Did you know eden-naming?",
      at: "2026-11-22T17:00:00.000Z",
      platforms: ["youtube", "tiktok"],
      profile: "Brand_1_RPG",
      videoUrl: "https://bgp-bible-rpg.pages.dev/shorts/eden-naming.mp4",
      thumbnailUrl: "https://bgp-bible-rpg.pages.dev/shorts/eden-naming.jpg",
    });
    expect(r.past).toEqual([]);
    expect(r.timeZone).toBe("Europe/Madrid");
    expect(r.profile).toBe("Brand_1_RPG");
  });

  test("leaves out cancelled posts and those of another account", () => {
    const r = scheduledReels(
      [
        entry("eden-naming", "2027-11-01T17:00:00.000Z", ["youtube"], {
          account: "old@example.com",
          cancelled: "2026-11-20: cancelled at Upload-Post",
        }),
        entry("eden-rib", "2027-11-02T17:00:00.000Z", ["youtube"], { account: "old@example.com" }),
        entry("cain", "2026-11-30T17:00:00.000Z", ["youtube"], { cancelled: true }),
        entry("eden-naming", "2026-11-22T17:00:00.000Z", ["youtube"]),
      ],
      channel,
      preview,
      now,
    );
    expect(r.upcoming.map((p) => `${p.id} ${p.at}`)).toEqual([
      "eden-naming 2026-11-22T17:00:00.000Z",
    ]);
  });

  test("shows one short at one time as one post with all its networks", () => {
    const r = scheduledReels(
      [
        entry("eden-naming", "2026-11-22T17:00:00.000Z", ["youtube"]),
        entry("eden-naming", "2026-11-22T17:00:00Z", ["instagram", "youtube"]),
      ],
      channel,
      preview,
      now,
    );
    expect(r.upcoming).toHaveLength(1);
    expect(r.upcoming[0].platforms).toEqual(["youtube", "instagram"]);
  });

  test("keeps every past post, newest first", () => {
    const r = scheduledReels(
      [
        entry("old", "2026-10-01T17:00:00Z", ["youtube"]),
        entry("a", "2026-11-18T17:00:00Z", ["youtube"]),
        entry("b", "2026-11-20T17:00:00Z", ["youtube"]),
      ],
      channel,
      preview,
      now,
    );
    expect(r.past.map((p) => p.id)).toEqual(["b", "a", "old"]);
    expect(r.upcoming).toEqual([]);
  });

  test("lists the shorts made but not scheduled, once each", () => {
    const r = scheduledReels(
      [
        entry("eden-naming", "2026-11-22T17:00:00Z", ["youtube"]),
        entry("eden-rib", "2026-11-24T17:00:00Z", ["youtube"], { cancelled: true }),
      ],
      channel,
      preview,
      now,
      [
        { id: "eden-naming", title: "Did you know Adam named the animals? 🦁" },
        { id: "eden-rib", title: "Did you know Eve was made from Adam's rib? 🦴" },
        { id: "eden-rib", title: "again" },
        { id: "../x" },
        null,
        { id: "cain-mark" },
      ],
    );
    // Newest (last in shorts.json) first; each keeps its number.
    expect(r.unscheduled).toEqual([
      {
        id: "cain-mark",
        number: 3,
        title: "cain-mark",
        videoUrl: "https://bgp-bible-rpg.pages.dev/shorts/cain-mark.mp4",
        thumbnailUrl: "https://bgp-bible-rpg.pages.dev/shorts/cain-mark.jpg",
      },
      {
        id: "eden-rib",
        number: 2,
        title: "Did you know Eve was made from Adam's rib? 🦴",
        videoUrl: "https://bgp-bible-rpg.pages.dev/shorts/eden-rib.mp4",
        thumbnailUrl: "https://bgp-bible-rpg.pages.dev/shorts/eden-rib.jpg",
      },
    ]);
    // The scheduled one keeps its number too.
    expect(r.upcoming.map((p) => `${p.id} #${p.number}`)).toEqual(["eden-naming #1"]);
    expect(scheduledReels([], channel, null, now).unscheduled).toEqual([]);
  });

  test("copes with no preview, no channel and junk", () => {
    const r = scheduledReels(
      [
        null,
        "x",
        { id: "../etc", at: "2026-11-22T17:00:00Z" },
        { id: "ok", at: "not a date" },
        {
          id: "fine",
          at: "2026-11-22T17:00:00Z",
          platforms: "youtube",
          account: "any@example.com",
        },
      ],
      null,
      null,
      now,
    );
    expect(r.upcoming).toEqual([
      {
        id: "fine",
        number: null,
        title: "fine",
        at: "2026-11-22T17:00:00.000Z",
        platforms: ["youtube"],
        profile: null,
        videoUrl: null,
        thumbnailUrl: null,
      },
    ]);
    expect(scheduledReels({ not: "a list" }, channel, preview, now).upcoming).toEqual([]);
  });

  test("tells the Build chat exactly which reels were picked", () => {
    expect(
      pickedReelsMessage(
        [
          {
            number: 4,
            id: "cain-offering",
            title: "Did you know why God accepted Abel's offering?",
          },
          {
            number: 3,
            id: "eden-figleaves",
            title: "Did you know the first clothes were fig leaves?",
          },
        ],
        "  El 3 i el 4 em molen ",
      ),
    ).toBe(
      [
        "El 3 i el 4 em molen",
        "",
        "Reels I picked in the Testing tab of the Videos page (3 and 4; the number is the reel's place in tools/shorts/shorts.json):",
        "- #3 eden-figleaves: Did you know the first clothes were fig leaves?",
        "- #4 cain-offering: Did you know why God accepted Abel's offering?",
      ].join("\n"),
    );
    expect(pickedReelsMessage([{ number: 7, id: "x", title: "X" }], "").split("\n")[0]).toBe(
      "I like this one.",
    );
    expect(numbersLabel([1, 2, 5])).toBe("1, 2 and 5");
  });

  test("falls back to Madrid for an unknown time zone", () => {
    expect(readChannel({ timezone: "Mars/Olympus" }).timeZone).toBe("Europe/Madrid");
    expect(readChannel({ timezone: "America/New_York" }).timeZone).toBe("America/New_York");
  });

  test("labels", () => {
    expect(postTimeLabel("2026-11-22T17:00:00.000Z", "Europe/Madrid")).toBe(
      "Sunday 22 November, 18:00",
    );
    expect(networkName("tiktok")).toBe("TikTok");
    expect(networkName("mastodon")).toBe("Mastodon");
  });
});

describe("days that already have a reel", () => {
  test("reads both logs, without cancelled posts or another account's, each day once", () => {
    const days = scheduledPostDays(
      [
        entry("eden-rib", "2026-11-24T17:00:00.000Z", ["youtube"]),
        entry("eden-rib", "2026-11-24T17:00:00.000Z", ["instagram"]),
        entry("old", "2026-11-25T17:00:00.000Z", ["youtube"], { account: "old@example.com" }),
        entry("gone", "2026-11-26T17:00:00.000Z", ["youtube"], { cancelled: true }),
      ],
      channel,
      {
        target: { profile: "Brand_2_BibleFun" },
        posts: [
          { date: "2026-11-23T20:00:00Z", id: "06-shining-face", job: "a" },
          { date: "2026-11-24T20:00:00Z", id: "22-golden-calf", job: "b" },
          { date: "not a date", id: "x" },
        ],
      },
    );
    expect(days).toEqual(["2026-11-23", "2026-11-24"]);
  });

  test("no logs, no days", () => {
    expect(scheduledPostDays(undefined, undefined, undefined)).toEqual([]);
    expect(scheduledPostDays({}, null, { posts: "x" })).toEqual([]);
  });
});

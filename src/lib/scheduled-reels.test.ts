import { describe, expect, test } from "bun:test";
import { networkName, postTimeLabel, readChannel, scheduledReels } from "./scheduled-reels";

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

  test("keeps the last two weeks' past posts, newest first", () => {
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
    expect(r.past.map((p) => p.id)).toEqual(["b", "a"]);
    expect(r.upcoming).toEqual([]);
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

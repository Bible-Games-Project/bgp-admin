import { describe, expect, test } from "bun:test";
import {
  cleanJob,
  curveAverage,
  metricsLine,
  networkMetrics,
  reelMetrics,
  reelsToRefresh,
  requestIdOf,
  shortNumber,
  totalViews,
  uploadPostKeyFrom,
} from "./reel-metrics";
import { scheduledReels } from "./scheduled-reels";

// Upload-Post's post-analytics answer for a real Eden to Heaven reel (2026-11-23), trimmed.
const tiktokCurve = [1, 0.52, 0.29, 0.2, 0.15, 0.12, 0.1, 0.09, 0.08, 0.07, 0.06].map(
  (percentage, second) => ({ percentage, second: `${second}` }),
);
const answer = {
  success: true,
  post: { request_id: "6c7daa6b85964fdf9414880eb071edf1", profile_username: "Brand_1_RPG" },
  platforms: {
    youtube: {
      success: true,
      post_url: "https://www.youtube.com/watch?v=vTI3RZ8X-_4",
      post_metrics: { views: 1059, likes: 59, comments: 1, favorites: 0, warnings: ["…"] },
    },
    facebook: {
      success: true,
      post_url: "https://www.facebook.com/reel/1564888712335271",
      post_metrics: { likes: 1, comments: 0, views: 249 },
    },
    tiktok: {
      success: true,
      post_url: "https://www.tiktok.com/@biblegamesproject/video/7711041906431626528",
      post_metrics: {
        views: 361,
        likes: 26,
        comments: 2,
        shares: 0,
        favorites: 1,
        new_followers: 1,
        full_video_watched_rate: 0.02,
        average_time_watched: 2.84,
        retention: tiktokCurve,
        avg_watch_seconds: 2.84,
        completion_rate: 2.0,
      },
    },
    instagram: {
      success: true,
      post_url: "https://www.instagram.com/reel/DgDS0k4CIkW/",
      post_metrics: {
        likes: 2,
        comments: 0,
        views: 59,
        saves: 0,
        shares: 0,
        avg_watch_seconds: 4.521,
      },
    },
    pinterest: {
      success: true,
      post_url: "https://www.biblegamesproject.com/",
      post_metrics: { impressions: 0, saves: 0, video_views: 0, video_95_percent_views: 0 },
    },
  },
};

describe("reel metrics", () => {
  test("TikTok gives everything Joan asked for", () => {
    const m = reelMetrics(answer).tiktok;
    expect(m.views).toBe(361);
    expect(m.shares).toBe(0);
    expect(m.newFollowers).toBe(1);
    expect(m.completionPercent).toBe(2);
    expect(m.avgWatchSeconds).toBe(2.8);
    // the curve is fractions: its average is how much is watched
    expect(m.watchedPercent).toBe(24.4);
  });

  test("the video's length from TikTok gives Instagram its percentage watched", () => {
    const all = reelMetrics(answer);
    // 2.84 s is 24.4 % of ~11.6 s, so 4.5 s is ~39 %
    expect(all.instagram.watchedPercent).toBeGreaterThan(38);
    expect(all.instagram.watchedPercent).toBeLessThan(40);
    expect(all.youtube.watchedPercent).toBeNull();
  });

  test("networks that don't say a number leave it empty, not zero", () => {
    const all = reelMetrics(answer);
    expect(all.youtube.shares).toBeNull();
    expect(all.youtube.saves).toBe(0);
    expect(all.facebook.newFollowers).toBeNull();
    expect(all.pinterest.views).toBe(0);
    expect(all.pinterest.completionPercent).toBeNull(); // no views, no rate
    expect(all.youtube.url).toBe("https://www.youtube.com/watch?v=vTI3RZ8X-_4");
  });

  test("Pinterest's completion comes from its 95 % views", () => {
    const m = networkMetrics({ post_metrics: { video_views: 40, video_95_percent_views: 10 } });
    expect(m.completionPercent).toBe(25);
  });

  test("a network's error is kept, and a missing answer gives nothing", () => {
    const m = networkMetrics({ success: true, post_metrics_error: "token expired" });
    expect(m.error).toBe("token expired");
    expect(m.views).toBeNull();
    expect(reelMetrics(null)).toEqual({});
    expect(reelMetrics({ platforms: { "bad name!": {} } })).toEqual({});
  });

  test("a retention curve in percentages is read as it is", () => {
    expect(curveAverage([{ percentage: 100 }, { percentage: 50 }])).toBe(75);
    expect(curveAverage([{ percentage: 1 }, { percentage: 0.5 }])).toBe(75);
    expect(curveAverage([{ percentage: 1 }])).toBeNull();
    expect(curveAverage("no")).toBeNull();
  });

  test("totals and lines for the page", () => {
    const all = reelMetrics(answer);
    expect(totalViews(all)).toBe(1059 + 249 + 361 + 59 + 0);
    expect(metricsLine(all.youtube)).toBe("1.1k views · 59 likes · 1 comment");
    expect(metricsLine(all.tiktok)).toBe(
      "361 views · 26 likes · 2 comments · 0 shares · 24% watched · 2% to the end · +1 new followers",
    );
    expect(shortNumber(999)).toBe("999");
    expect(shortNumber(1000)).toBe("1k");
    expect(shortNumber(12_345)).toBe("12k");
    expect(shortNumber(1_250_000)).toBe("1.3M");
  });

  test("the request id of a scheduled post comes from its job's history", () => {
    const history = {
      history: [
        { job_id: "other", request_id: "r0" },
        { job_id: "ce69ad0d978a4c25a82f1ab30c1b053e", request_id: "6c7d", platform: "youtube" },
      ],
    };
    expect(requestIdOf(history, "ce69ad0d978a4c25a82f1ab30c1b053e")).toBe("6c7d");
    expect(requestIdOf(history, "missing")).toBeNull();
    expect(requestIdOf({}, "x")).toBeNull();
  });

  test("job ids are checked before they go in a web address", () => {
    expect(cleanJob("ce69ad0d978a4c25a82f1ab30c1b053e")).toBe("ce69ad0d978a4c25a82f1ab30c1b053e");
    expect(cleanJob("../x")).toBe("");
    expect(cleanJob(12)).toBe("");
  });

  test("which reels to read: never read first, once a day, once a week after a month", () => {
    const now = new Date("2026-11-23T12:00:00Z");
    const posts = [
      { jobs: ["new"], at: "2026-11-23T11:30:00Z" }, // out half an hour ago: not yet
      { jobs: ["today"], at: "2026-11-22T17:00:00Z" },
      { jobs: ["yesterday"], at: "2026-11-20T17:00:00Z" },
      { jobs: ["old"], at: "2026-10-01T17:00:00Z" },
      { jobs: ["future"], at: "2026-11-30T17:00:00Z" },
    ];
    const known = [
      { job: "today", fetchedAt: "2026-11-23T06:00:00Z" }, // 6 h ago: fresh
      { job: "yesterday", fetchedAt: "2026-11-22T10:00:00Z" }, // 26 h ago: due
      { job: "old", fetchedAt: "2026-11-20T10:00:00Z" }, // old reel, 3 days ago: fresh
    ];
    expect(reelsToRefresh(posts, known, now, 10)).toEqual(["yesterday"]);
    expect(reelsToRefresh(posts, [], now, 10)).toEqual(["today", "yesterday", "old"]);
    expect(reelsToRefresh(posts, [], now, 2)).toHaveLength(2);
  });

  test("the pasted key is cleaned up", () => {
    expect(uploadPostKeyFrom("  eyJhbGciOiJIUzI1NiJ9.abcdefghijkl  ")).toEqual({
      key: "eyJhbGciOiJIUzI1NiJ9.abcdefghijkl",
    });
    expect(uploadPostKeyFrom('UPLOAD_POST_API_KEY="eyJhbGciOiJIUzI1NiJ9.abcdefghijkl"')).toEqual({
      key: "eyJhbGciOiJIUzI1NiJ9.abcdefghijkl",
    });
    expect(uploadPostKeyFrom("Apikey eyJhbGciOiJIUzI1NiJ9.abcdefghijkl")).toEqual({
      key: "eyJhbGciOiJIUzI1NiJ9.abcdefghijkl",
    });
    expect("problem" in uploadPostKeyFrom("short")).toBe(true);
    expect("problem" in uploadPostKeyFrom("two words that are long enough")).toBe(true);
  });

  test("the side bar's posts carry their Upload-Post jobs", () => {
    const published = [
      { id: "eden-naming", at: "2026-11-22T17:00:00Z", platforms: ["youtube"], job: "job1abc" },
      { id: "eden-naming", at: "2026-11-22T17:00:00Z", platforms: ["tiktok"], job: "job2abc" },
      { id: "eden-dust", at: "2026-11-23T17:00:00Z", platforms: ["youtube"] },
    ];
    const { past } = scheduledReels(published, {}, null, new Date("2026-11-24T00:00:00Z"));
    expect(past.find((p) => p.id === "eden-naming")?.jobs).toEqual(["job1abc", "job2abc"]);
    expect(past.find((p) => p.id === "eden-dust")?.jobs).toEqual([]);
  });
});

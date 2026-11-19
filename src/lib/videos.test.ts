import { describe, expect, test } from "bun:test";
import {
  VIDEOS_PATH,
  describeVideoContext,
  isVideoContext,
  videoContext,
  videoQueueLabel,
  videoSystemPrompt,
} from "./videos";

const APP = "0b6c2f3e-8a51-4c7e-9d2a-5f1e3b7c9a10";

describe("videos chat", () => {
  test("a Videos message's context names the page and the game", () => {
    expect(videoContext(APP, "Exodus Survivors")).toEqual({
      path: VIDEOS_PATH,
      appId: APP,
      appName: "Exodus Survivors",
    });
    expect(videoContext(APP)).toEqual({ path: VIDEOS_PATH, appId: APP });
  });

  test("tells Videos messages apart from Ruben's and the translations", () => {
    expect(isVideoContext(videoContext(APP, "Exodus"))).toBe(true);
    expect(isVideoContext({ path: VIDEOS_PATH })).toBe(false);
    expect(isVideoContext({ path: "/apps/x", appId: APP })).toBe(false);
    expect(isVideoContext({ translate: { store: "ios" } })).toBe(false);
    expect(isVideoContext(null)).toBe(false);
    expect(isVideoContext("videos")).toBe(false);
  });

  test("the queue says whose videos are ahead", () => {
    expect(videoQueueLabel(videoContext(APP, "Exodus"))).toBe("Exodus's videos");
    expect(videoQueueLabel(videoContext(APP))).toBe("a game's videos");
  });

  test("each message tells Claude which game it is about", () => {
    const line = describeVideoContext(videoContext(APP, "Exodus"));
    expect(line).toContain("Exodus");
    expect(line).toContain(APP);
  });

  test("the system prompt is honest about what Claude can't do yet and offers the actions", () => {
    const prompt = videoSystemPrompt();
    expect(prompt).toContain("can't record or edit video files");
    expect(prompt).toContain("build_chat");
    expect(prompt).toContain('"type":"open"');
  });
});

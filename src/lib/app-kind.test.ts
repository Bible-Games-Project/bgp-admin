import { describe, expect, test } from "bun:test";
import { appStoreIds, hasRepo, isOnAnyStore, requireRepo } from "./app-kind";

const webGame = {
  github_owner: "Bible-Games-Project",
  github_repo: "eden-choice-chronicles",
  bundle_id: "com.biblegamesproject.eden",
  android_package_name: null,
  steam_app_id: null,
};

describe("appStoreIds", () => {
  test("a web game ships to both stores under its bundle ID", () => {
    expect(appStoreIds(webGame)).toEqual({
      ios: "com.biblegamesproject.eden",
      android: "com.biblegamesproject.eden",
      steam: null,
    });
  });

  test("any app can be on Steam", () => {
    expect(appStoreIds({ ...webGame, steam_app_id: 2138140 }).steam).toBe(2138140);
  });

  test("a published game keeps a separate ID per store", () => {
    expect(
      appStoreIds({
        github_owner: null,
        github_repo: null,
        bundle_id: "com.biblegamesproject.didacticjesusgame.pro",
        android_package_name: "com.biblegamesproject.pro",
        steam_app_id: 2138140,
      }),
    ).toEqual({
      ios: "com.biblegamesproject.didacticjesusgame.pro",
      android: "com.biblegamesproject.pro",
      steam: 2138140,
    });
  });

  test("a published game only on the App Store is not looked up on Google Play", () => {
    expect(
      appStoreIds({ github_owner: null, github_repo: null, bundle_id: "com.JoanSabe.TheLostSheep" }),
    ).toEqual({ ios: "com.JoanSabe.TheLostSheep", android: null, steam: null });
  });

  test("a published game only on Steam has no mobile IDs", () => {
    const ids = appStoreIds({ github_owner: null, github_repo: null, steam_app_id: 4244150 });
    expect(ids).toEqual({ ios: null, android: null, steam: 4244150 });
    expect(isOnAnyStore(ids)).toBe(true);
  });

  test("blank IDs count as missing", () => {
    const ids = appStoreIds({ github_owner: null, github_repo: null, bundle_id: "  ", android_package_name: "" });
    expect(isOnAnyStore(ids)).toBe(false);
  });
});

describe("hasRepo", () => {
  test("needs both the owner and the repo name", () => {
    expect(hasRepo(webGame)).toBe(true);
    expect(hasRepo({ github_owner: "Bible-Games-Project", github_repo: null })).toBe(false);
    expect(hasRepo({ github_owner: null, github_repo: null })).toBe(false);
  });

  test("requireRepo refuses a published game with a message that says why", () => {
    expect(() => requireRepo({ github_owner: null, github_repo: null })).toThrow(/published outside the console/);
    expect(requireRepo(webGame)).toBe(webGame);
  });
});

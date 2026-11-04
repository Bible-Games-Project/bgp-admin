import { describe, expect, test } from "bun:test";
import {
  ACTION_DOCS,
  assistantSystemPrompt,
  cleanContext,
  describeContext,
  parseAction,
  splitReply,
} from "./assistant";

describe("page context", () => {
  test("keeps what a page may send and describes it", () => {
    const context = cleanContext({
      path: "/apps/11111111-1111-4111-8111-111111111111",
      title: "Bible RPG — bgp console",
      appId: "11111111-1111-4111-8111-111111111111",
      appName: "Bible RPG",
      tab: "store",
      ranActions: [{ label: "Run the checks", outcome: "the checks ran" }, { label: "" }],
      extra: "dropped",
    });
    expect(context).toEqual({
      path: "/apps/11111111-1111-4111-8111-111111111111",
      title: "Bible RPG — bgp console",
      appId: "11111111-1111-4111-8111-111111111111",
      appName: "Bible RPG",
      tab: "store",
      ranActions: [{ label: "Run the checks", outcome: "the checks ran" }],
    });
    const text = describeContext(context);
    expect(text).toContain("an app's page");
    expect(text).toContain("Bible RPG");
    expect(text).toContain("store tab");
    expect(text).toContain("Run the checks → the checks ran");
    expect(describeContext(cleanContext({ path: "/" }))).toBe(
      "The person is on Home (what needs attention, what's coming up, the month's profit) (/).",
    );
    expect(cleanContext(null)).toEqual({ path: "/" });
    expect(cleanContext({ appId: "not-an-id", path: "/x" })).toEqual({ path: "/x" });
  });
});

describe("actions", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  test("reads the ones the chat knows and drops the rest", () => {
    expect(parseAction(`{"type":"open","label":"Open Home","to":"/"}`)).toEqual({
      type: "open",
      label: "Open Home",
      to: "/",
    });
    expect(parseAction(`{"type":"open","label":"x","to":"https://evil"}`)).toBeNull();
    expect(
      parseAction(
        `{"type":"build_chat","label":"Fix it","appId":"${id}","message":"Fix the overlap"}`,
      ),
    ).toEqual({ type: "build_chat", label: "Fix it", appId: id, message: "Fix the overlap" });
    expect(
      parseAction(`{"type":"build_chat","label":"Fix it","appId":"nope","message":"x"}`),
    ).toBeNull();
    expect(
      parseAction(
        `{"type":"trigger_deploy","label":"Deploy iOS","appId":"${id}","workflowFile":"deploy-ios.yml","inputs":{"marketing_version":"1.2","bad key!":"x","n":1}}`,
      ),
    ).toEqual({
      type: "trigger_deploy",
      label: "Deploy iOS",
      appId: id,
      workflowFile: "deploy-ios.yml",
      inputs: { marketing_version: "1.2" },
    });
    expect(
      parseAction(`{"type":"trigger_deploy","label":"x","appId":"${id}","workflowFile":"../x"}`),
    ).toBeNull();
    expect(
      parseAction(`{"type":"setup_step","label":"x","appId":"${id}","step":"capacitor"}`),
    ).toMatchObject({
      step: "capacitor",
    });
    expect(
      parseAction(`{"type":"setup_step","label":"x","appId":"${id}","step":"delete"}`),
    ).toBeNull();
    expect(
      parseAction(
        `{"type":"save_expense","label":"Add it","name":"Apple","amount":99,"currency":"USD","frequency":"yearly","startsOn":"2026-11-01"}`,
      ),
    ).toMatchObject({ type: "save_expense", amount: 99, frequency: "yearly" });
    expect(
      parseAction(
        `{"type":"save_expense","label":"x","name":"a","amount":-1,"currency":"EUR","frequency":"once","startsOn":"2026-11-01"}`,
      ),
    ).toBeNull();
    expect(parseAction(`{"type":"run_checks"}`)).toBeNull();
    expect(parseAction(`{"type":"delete_everything","label":"x"}`)).toBeNull();
    expect(parseAction("not json")).toBeNull();
  });

  test("a reply splits into words and buttons, in order", () => {
    const reply = [
      "The iOS deploy of **Bible RPG** failed at the build step.",
      "",
      "```action",
      `{"type":"build_chat","label":"Ask the Build chat to fix the build","appId":"${id}","message":"The iOS build fails: fix it"}`,
      "```",
      "",
      "Or run it again as it is:",
      "```action",
      `{"type":"trigger_deploy","label":"Deploy iOS again","appId":"${id}","workflowFile":"deploy-ios.yml"}`,
      "```",
      "```action",
      `{"type":"nuke","label":"x"}`,
      "```",
    ].join("\n");
    const parts = splitReply(reply);
    expect(parts.map((p) => p.kind)).toEqual(["text", "action", "text", "action", "text"]);
    expect(parts[1]).toMatchObject({ action: { type: "build_chat" } });
    expect(parts[3]).toMatchObject({ action: { type: "trigger_deploy" } });
    expect(parts[4]).toMatchObject({ unknownAction: true });
    expect(splitReply("Just words.")).toEqual([{ kind: "text", text: "Just words." }]);
  });

  test("what Claude is told covers every action the chat knows", () => {
    for (const type of [
      "open",
      "build_chat",
      "run_checks",
      "refresh_income",
      "trigger_deploy",
      "release_version",
      "setup_step",
      "create_app",
      "save_expense",
    ])
      expect(ACTION_DOCS).toContain(`"type":"${type}"`);
    const prompt = assistantSystemPrompt();
    expect(prompt).toContain("You are Ruben");
    expect(prompt).toContain(ACTION_DOCS);
    expect(prompt).toContain("can't change anything yourself");
  });
});

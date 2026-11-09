import { describe, expect, test } from "bun:test";
import { moveApp, withListOrder } from "./app-order";

const apps = [{ id: "eden" }, { id: "trivia" }, { id: "admin" }, { id: "parables" }];
const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe("moveApp", () => {
  test("dragging a card down puts it where the other card was", () => {
    expect(ids(moveApp(apps, "eden", "admin"))).toEqual(["trivia", "admin", "eden", "parables"]);
  });

  test("dragging a card up pushes the others down", () => {
    expect(ids(moveApp(apps, "parables", "trivia"))).toEqual([
      "eden",
      "parables",
      "trivia",
      "admin",
    ]);
  });

  test("dropping a card on itself or outside the list changes nothing", () => {
    expect(moveApp(apps, "admin", "admin")).toBe(apps);
    expect(moveApp(apps, "admin", "gone")).toBe(apps);
    expect(moveApp(apps, "gone", "admin")).toBe(apps);
  });

  test("the original list is left as it was", () => {
    moveApp(apps, "eden", "parables");
    expect(ids(apps)).toEqual(["eden", "trivia", "admin", "parables"]);
  });
});

describe("withListOrder", () => {
  test("numbers the cards from 0 in the order they are shown", () => {
    expect(withListOrder(moveApp(apps, "parables", "eden"))).toEqual([
      { id: "parables", sort_order: 0 },
      { id: "eden", sort_order: 1 },
      { id: "trivia", sort_order: 2 },
      { id: "admin", sort_order: 3 },
    ]);
  });
});

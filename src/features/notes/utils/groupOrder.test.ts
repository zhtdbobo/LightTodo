import { describe, expect, it } from "vitest";
import type { Group } from "../types";
import { moveGroupToTarget } from "./groupOrder";

const groups: Group[] = [
  { id: "a", name: "A", displayOrder: 0, createdAt: 1, updatedAt: 1 },
  { id: "b", name: "B", displayOrder: 1, createdAt: 1, updatedAt: 1 },
  { id: "c", name: "C", displayOrder: 2, createdAt: 1, updatedAt: 1 },
];

describe("moveGroupToTarget", () => {
  it("moves a group downward to the target position", () => {
    expect(moveGroupToTarget(groups, "a", "c").map((group) => group.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("moves a group upward to the target position", () => {
    expect(moveGroupToTarget(groups, "c", "a").map((group) => group.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("does not change the list for an unknown target", () => {
    expect(moveGroupToTarget(groups, "a", "missing")).toBe(groups);
  });
});

import { describe, expect, it } from "vitest";

import { entriesAroundUser } from "$lib/utils/scoreboard";

const rows = (...ids: string[]) => ids.map((userId) => ({ userId }));

describe("entriesAroundUser", () => {
  it("returns the full list when no user id is given", () => {
    const all = rows("a", "b", "c");
    expect(entriesAroundUser(all, null, 5)).toBe(all);
  });

  it("returns the full list when the user is not on the board", () => {
    const all = rows("a", "b", "c");
    expect(entriesAroundUser(all, "z", 5)).toBe(all);
  });

  it("returns a window of ±radius centered on the user", () => {
    const all = rows("a", "b", "c", "d", "e", "f", "g");
    expect(entriesAroundUser(all, "d", 1).map((e) => e.userId)).toEqual(["c", "d", "e"]);
    expect(entriesAroundUser(all, "d", 2).map((e) => e.userId)).toEqual([
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });

  it("clamps the window at the top of the board", () => {
    const all = rows("a", "b", "c", "d", "e");
    expect(entriesAroundUser(all, "a", 2).map((e) => e.userId)).toEqual(["a", "b", "c"]);
  });

  it("clamps the window at the bottom of the board", () => {
    const all = rows("a", "b", "c", "d", "e");
    expect(entriesAroundUser(all, "e", 2).map((e) => e.userId)).toEqual(["c", "d", "e"]);
  });
});

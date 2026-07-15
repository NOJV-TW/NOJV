import { describe, expect, it } from "vitest";

import { nextMenuItemIndex } from "$lib/utils/menu-focus";

describe("nextMenuItemIndex", () => {
  it("wraps arrow navigation and enters from outside the menu", () => {
    expect(nextMenuItemIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextMenuItemIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextMenuItemIndex("ArrowUp", -1, 3)).toBe(2);
    expect(nextMenuItemIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("supports Home and End and handles an empty menu", () => {
    expect(nextMenuItemIndex("Home", 2, 3)).toBe(0);
    expect(nextMenuItemIndex("End", 0, 3)).toBe(2);
    expect(nextMenuItemIndex("ArrowDown", 0, 0)).toBeNull();
  });
});

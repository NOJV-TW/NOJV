import { describe, expect, it } from "vitest";

import { formatProblemDisplayName } from "../../../apps/web/src/lib/utils/format-problem-display-name";

describe("formatProblemDisplayName", () => {
  it("prepends the display id followed by a single space and the title", () => {
    expect(formatProblemDisplayName({ displayId: 42, title: "Binary Search" })).toBe(
      "#42 Binary Search",
    );
  });

  it("handles non-ASCII titles unchanged", () => {
    expect(formatProblemDisplayName({ displayId: 7, title: "二分搜尋" })).toBe(
      "#7 二分搜尋",
    );
  });

  it("preserves whitespace already inside the title", () => {
    expect(formatProblemDisplayName({ displayId: 1, title: "  spaced  " })).toBe(
      "#1   spaced  ",
    );
  });
});

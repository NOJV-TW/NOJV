import { describe, expect, it } from "vitest";

import { problemTabHref } from "$lib/components/features/problem/views/problem-tab-href";

describe("problemTabHref", () => {
  const currentUrl = new URL("https://nojv.tw/problems?tab=mine&q=graph&sort=desc");

  it.each([
    ["public", "/problems?q=graph&sort=desc"],
    ["mine", "/problems?tab=mine&q=graph&sort=desc"],
    ["all", "/problems?tab=all&q=graph&sort=desc"],
  ] as const)("builds the %s tab URL without dropping other filters", (tab, expected) => {
    expect(problemTabHref(currentUrl, tab)).toBe(expected);
  });
});

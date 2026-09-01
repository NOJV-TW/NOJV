import { describe, expect, it } from "vitest";

import { assessmentGroupIcon } from "../../../apps/web/src/lib/utils/assessment-group";

describe("assessment group heading icons", () => {
  it.each([
    ["live", "active"],
    ["running", "active"],
    ["open", "active"],
    ["upcoming", "upcoming"],
    ["closed", "ended"],
    ["ended", "ended"],
  ] as const)("maps %s to the %s icon", (status, expected) => {
    expect(assessmentGroupIcon(status)).toBe(expected);
  });
});

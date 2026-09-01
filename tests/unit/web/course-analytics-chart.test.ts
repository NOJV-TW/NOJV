import { describe, expect, it } from "vitest";

import { stablePieChartOptions } from "../../../apps/web/src/lib/utils/chart-options";

describe("course analytics verdict chart interaction", () => {
  it("keeps hover from animating or changing the chart layout", () => {
    expect(stablePieChartOptions.animation).toBe(false);
    expect(stablePieChartOptions.tooltip).toMatchObject({
      trigger: "item",
      appendToBody: true,
      extraCssText: "pointer-events:none;",
      transitionDuration: 0,
    });
    expect(stablePieChartOptions.series).toMatchObject([{ emphasis: { disabled: true } }]);
  });
});

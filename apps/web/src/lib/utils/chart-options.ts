import type { EChartsOption } from "echarts";

/**
 * Keep pie charts stable while the pointer moves across a slice.
 *
 * ECharts' default emphasis animation and tooltip transitions can change the
 * rendered box while a ResizeObserver is active, causing the chart to resize
 * repeatedly and appear to flicker.
 */
export const stablePieChartOptions = {
  animation: false,
  tooltip: {
    trigger: "item",
    formatter: "{b}: {c} ({d}%)",
    appendToBody: true,
    extraCssText: "pointer-events:none;",
    transitionDuration: 0,
  },
  series: [{ emphasis: { disabled: true } }],
} satisfies Pick<EChartsOption, "animation" | "tooltip" | "series">;

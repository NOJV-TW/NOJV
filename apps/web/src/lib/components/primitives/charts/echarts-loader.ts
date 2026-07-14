export async function loadECharts(): Promise<typeof import("echarts")> {
  return import("echarts");
}

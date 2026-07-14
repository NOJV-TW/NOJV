export interface ChartSummaryEntry {
  label: string;
  value: string | number;
}

export function formatChartSummary(entries: readonly ChartSummaryEntry[]): string {
  return entries.map(({ label, value }) => `${label}: ${String(value)}`).join("; ");
}

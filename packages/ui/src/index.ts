export const claudeNativeTheme = {
  accent: "#c4682d",
  accentSoft: "#ead6c7",
  border: "rgba(79, 52, 35, 0.14)",
  ink: "#1f1916",
  mutedInk: "#6d6157",
  panel: "rgba(255, 250, 244, 0.82)",
  panelStrong: "rgba(247, 239, 228, 0.92)",
  page: "#f7f1e8",
  pageAlt: "#efe5d8"
} as const;

export const shellClassNames = {
  badge:
    "inline-flex items-center rounded-full border border-[color:var(--color-border)] bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--color-muted)]",
  card: "rounded-[2rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] backdrop-blur-sm",
  cardStrong:
    "rounded-[2rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel-strong)] backdrop-blur-sm",
  eyebrow: "text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--color-muted)]",
  metricValue:
    "font-[family-name:var(--font-display)] text-4xl leading-none text-[color:var(--color-ink)]",
  sectionTitle:
    "font-[family-name:var(--font-display)] text-3xl leading-tight text-[color:var(--color-ink)]"
} as const;

export const motionTokens = {
  cardEnter: "animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both]",
  chartReveal: "animate-[fade-in_900ms_ease_both]"
} as const;

export function formatAcceptanceRate(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

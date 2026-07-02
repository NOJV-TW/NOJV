/**
 * Per-type identity accent (icon badge, edge stripe, hero wash). This is an
 * identity marker, not a status color — status meaning stays on StatusPill.
 */
const ACCENT = {
  assignment: "var(--type-assignment)",
  exam: "var(--type-exam)",
  contest: "var(--type-contest)",
} as const;

export function typeAccentVar(kind: keyof typeof ACCENT): string {
  return ACCENT[kind];
}

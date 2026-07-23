const ACCENT = {
  assignment: "var(--type-assignment)",
  exam: "var(--type-exam)",
  contest: "var(--type-contest)",
} as const;

export function typeAccentVar(kind: keyof typeof ACCENT): string {
  return ACCENT[kind];
}

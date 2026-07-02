import type { CourseworkKind } from "./StatusPill.svelte";

/**
 * Per-type identity accent (icon badge, edge stripe, hero wash). This is an
 * identity marker, not a status color — status meaning stays on StatusPill.
 */
export function typeAccentVar(kind: CourseworkKind): string {
  return `var(--type-${kind})`;
}

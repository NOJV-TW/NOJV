import type { Prisma } from "../../generated/prisma/client";

/**
 * Minimal problem shape for contest/assessment problem listings and
 * submission history. Include `id` + the human-facing title only.
 */
export const problemMiniSelect = {
  id: true,
  title: true
} satisfies Prisma.ProblemSelect;

/**
 * Problem content preview for assessment / course detail pages — adds
 * localized `statements` on top of the mini select. (`summary` was
 * removed from Problem in the 2026-04 schema redesign; localized
 * titles and body live in `ProblemStatementI18n`.)
 */
export const problemPreviewSelect = {
  id: true,
  title: true,
  statements: true
} satisfies Prisma.ProblemSelect;

import type { Prisma } from "../../generated/prisma/client";

/**
 * Minimal problem shape for contest/assessment problem listings and
 * submission history. Include `id` + the human-facing title only.
 */
export const problemMiniSelect = {
  id: true,
  defaultTitle: true
} satisfies Prisma.ProblemSelect;

/**
 * Problem content preview for assessment / course detail pages — adds
 * `summary` and localized `statements` on top of the mini select.
 */
export const problemPreviewSelect = {
  id: true,
  summary: true,
  statements: true
} satisfies Prisma.ProblemSelect;

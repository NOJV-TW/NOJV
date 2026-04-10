import type { Prisma } from "../../generated/prisma/client";

export const problemMiniSelect = {
  id: true,
  title: true
} satisfies Prisma.ProblemSelect;

export const problemPreviewSelect = {
  id: true,
  title: true,
  statements: true
} satisfies Prisma.ProblemSelect;

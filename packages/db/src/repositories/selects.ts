import type { Prisma } from "../../generated/prisma/client";

export const problemMiniSelect = {
  id: true,
  displayId: true,
  title: true,
} satisfies Prisma.ProblemSelect;

export const problemPreviewSelect = {
  id: true,
  displayId: true,
  title: true,
  statement: true,
} satisfies Prisma.ProblemSelect;

export const problemTeacherMiniSelect = {
  id: true,
  displayId: true,
  title: true,
  difficulty: true,
} satisfies Prisma.ProblemSelect;

export const courseMiniSelect = {
  id: true,
  title: true,
} satisfies Prisma.CourseSelect;

export const userMiniSelect = {
  id: true,
  name: true,
  username: true,
} satisfies Prisma.UserSelect;

export const userPublicSelect = {
  username: true,
  name: true,
} satisfies Prisma.UserSelect;

export const userScoreboardSelect = {
  displayUsername: true,
  username: true,
  name: true,
} satisfies Prisma.UserSelect;

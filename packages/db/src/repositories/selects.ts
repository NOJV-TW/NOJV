import type { Prisma } from "../../generated/prisma/client";

// Problem ref — id + title only; the go-to shape for list rows, nested selects, and link targets.
export const problemMiniSelect = {
  id: true,
  title: true
} satisfies Prisma.ProblemSelect;

// Problem preview — mini fields plus localised statements for preview surfaces.
export const problemPreviewSelect = {
  id: true,
  title: true,
  statements: true
} satisfies Prisma.ProblemSelect;

// Problem teacher mini — adds `difficulty` for teacher-facing problem lists on exam/assessment detail pages.
export const problemTeacherMiniSelect = {
  id: true,
  title: true,
  difficulty: true
} satisfies Prisma.ProblemSelect;

// Course ref — id + title; used wherever a linked course is shown on a list card or detail header.
export const courseMiniSelect = {
  id: true,
  title: true
} satisfies Prisma.CourseSelect;

// User mini — id + username + name for server-side joins that still need the user PK.
export const userMiniSelect = {
  id: true,
  name: true,
  username: true
} satisfies Prisma.UserSelect;

// User public — username + name for public-facing rows (editorial authors, course roster, recent errors).
export const userPublicSelect = {
  username: true,
  name: true
} satisfies Prisma.UserSelect;

// User scoreboard — adds `displayUsername` so scoreboards can render the public handle.
export const userScoreboardSelect = {
  displayUsername: true,
  username: true,
  name: true
} satisfies Prisma.UserSelect;

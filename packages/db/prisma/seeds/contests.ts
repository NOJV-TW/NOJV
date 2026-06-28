import type { PrismaClient } from "../../generated/prisma/client";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export async function seedContests(prisma: PrismaClient) {
  const now = Date.now();

  const springQualifier = await prisma.contest.upsert({
    create: {
      endsAt: new Date("2026-03-15T18:00:00+08:00"),
      frozenBoard: true,
      id: "spring-qualifier-2026",
      inviteCode: "spring2026",
      startsAt: new Date("2026-03-15T14:00:00+08:00"),
      summary: "Qualifier contest with a frozen board in the final hour.",
      title: "Spring Qualifier 2026",
      visibility: "published",
    },
    update: {},
    where: { id: "spring-qualifier-2026" },
  });

  const upcomingCup = await prisma.contest.upsert({
    create: {
      id: "contest_demo_upcoming",
      endsAt: new Date(now + 5 * DAY + 3 * HOUR),
      frozenBoard: false,
      startsAt: new Date(now + 5 * DAY),
      summary: "示範用即將舉行的比賽 — 開賽前題目應隱藏。",
      title: "Demo: Spring Cup 2026",
      visibility: "published",
    },
    update: {
      endsAt: new Date(now + 5 * DAY + 3 * HOUR),
      startsAt: new Date(now + 5 * DAY),
      visibility: "published",
    },
    where: { id: "contest_demo_upcoming" },
  });

  const liveRound = await prisma.contest.upsert({
    create: {
      id: "contest_demo_live",
      endsAt: new Date(now + 2 * HOUR),
      frozenBoard: false,
      startsAt: new Date(now - HOUR),
      summary: "示範用進行中的比賽 — LIVE 狀態。",
      title: "Demo: Weekly Round 12",
      visibility: "published",
    },
    update: {
      endsAt: new Date(now + 2 * HOUR),
      startsAt: new Date(now - HOUR),
      visibility: "published",
    },
    where: { id: "contest_demo_live" },
  });

  const contestProblemLinks = [
    {
      contestId: springQualifier.id,
      problemId: "problem_warmup-sum",
      ordinal: 1,
      points: 100,
    },
    {
      contestId: springQualifier.id,
      problemId: "problem_graph-docking",
      ordinal: 2,
      points: 200,
    },
    {
      contestId: upcomingCup.id,
      problemId: "problem_warmup-sum",
      ordinal: 1,
      points: 100,
    },
    {
      contestId: upcomingCup.id,
      problemId: "problem_graph-docking",
      ordinal: 2,
      points: 200,
    },
    {
      contestId: upcomingCup.id,
      problemId: "problem_fork-bomb-safeguard",
      ordinal: 3,
      points: 100,
    },
    {
      contestId: liveRound.id,
      problemId: "problem_warmup-sum",
      ordinal: 1,
      points: 100,
    },
    {
      contestId: liveRound.id,
      problemId: "problem_add-two-numbers",
      ordinal: 2,
      points: 100,
    },
  ];

  for (const link of contestProblemLinks) {
    await prisma.contestProblem.upsert({
      create: {
        contestId: link.contestId,
        ordinal: link.ordinal,
        points: link.points,
        problemId: link.problemId,
      },
      update: {
        ordinal: link.ordinal,
        points: link.points,
      },
      where: {
        contestId_problemId: {
          contestId: link.contestId,
          problemId: link.problemId,
        },
      },
    });
  }

  console.log(`  Contests: 3 upserted (spring-qualifier-2026 + demo upcoming + demo live)`);
}

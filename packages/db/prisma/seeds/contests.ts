import type { PrismaClient } from "../../generated/prisma/client";

export async function seedContests(prisma: PrismaClient) {
  const springQualifier = await prisma.contest.upsert({
    create: {
      endsAt: new Date("2026-03-15T18:00:00+08:00"),
      frozenBoard: true,
      id: "spring-qualifier-2026",
      inviteCode: "spring2026",
      startsAt: new Date("2026-03-15T14:00:00+08:00"),
      summary: "Qualifier contest with a frozen board in the final hour.",
      title: "Spring Qualifier 2026",
      visibility: "published"
    },
    update: {},
    where: { id: "spring-qualifier-2026" }
  });

  // Link problems to contests
  const contestProblemLinks = [
    {
      contestId: springQualifier.id,
      problemId: "problem_warmup-sum",
      ordinal: 1,
      points: 100
    },
    {
      contestId: springQualifier.id,
      problemId: "problem_graph-docking",
      ordinal: 2,
      points: 300
    }
  ];

  for (const link of contestProblemLinks) {
    await prisma.contestProblem.upsert({
      create: {
        contestId: link.contestId,
        ordinal: link.ordinal,
        points: link.points,
        problemId: link.problemId
      },
      update: {
        ordinal: link.ordinal,
        points: link.points
      },
      where: {
        contestId_problemId: {
          contestId: link.contestId,
          problemId: link.problemId
        }
      }
    });
  }

  console.log(`  Contests: spring-qualifier-2026 upserted with problem links`);
}

import type { PrismaClient } from "../../generated/prisma/client";

export async function seedContests(prisma: PrismaClient) {
  const springQualifier = await prisma.contest.upsert({
    create: {
      endsAt: new Date("2026-03-15T18:00:00+08:00"),
      frozenBoard: true,
      id: "contest_spring-qualifier-2026",
      inviteCode: "spring2026",
      slug: "spring-qualifier-2026",
      startsAt: new Date("2026-03-15T14:00:00+08:00"),
      summary: "Qualifier contest with a frozen board in the final hour.",
      title: "Spring Qualifier 2026",
      visibility: "published"
    },
    update: {},
    where: { slug: "spring-qualifier-2026" }
  });

  // Link problems to contests
  const contestProblemLinks = [
    { contestId: springQualifier.id, problemId: "warmup-sum", ordinal: 1, points: 100 },
    { contestId: springQualifier.id, problemId: "graph-docking", ordinal: 2, points: 300 }
  ];

  for (const link of contestProblemLinks) {
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: link.problemId }
    });

    await prisma.contestProblem.upsert({
      create: {
        contestId: link.contestId,
        ordinal: link.ordinal,
        points: link.points,
        problemId: problem.id
      },
      update: {
        ordinal: link.ordinal,
        points: link.points
      },
      where: {
        contestId_problemId: {
          contestId: link.contestId,
          problemId: problem.id
        }
      }
    });
  }

  console.log(`  Contests: spring-qualifier-2026 upserted with problem links`);
}

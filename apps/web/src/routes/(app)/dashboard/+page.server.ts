import { prisma } from "@nojv/db";
import { requireAuth } from "$lib/server/auth";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);

  // 1. Parallel: UserStats, recent submissions, AC'd problem IDs
  const [stats, recentSubmissions, acProblemIds] = await Promise.all([
    prisma.userStats.findUnique({
      where: { userId: actor.userId }
    }),
    prisma.submission.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      where: { userId: actor.userId, sampleOnly: false },
      select: {
        id: true,
        status: true,
        language: true,
        createdAt: true,
        problem: { select: { slug: true, defaultTitle: true } }
      }
    }),
    prisma.submission.findMany({
      where: { userId: actor.userId, status: "accepted", sampleOnly: false },
      select: { problemId: true },
      distinct: ["problemId"]
    })
  ]);

  const acIds = acProblemIds.map((s) => s.problemId);

  // 2. Parallel: AC'd problem tags + recommendations (tags query needed for recommendations)
  const acProblems =
    acIds.length > 0
      ? await prisma.problem.findMany({
          where: { id: { in: acIds } },
          select: { tags: true }
        })
      : [];
  const acTags = [...new Set(acProblems.flatMap((p) => p.tags))];

  const recommendations = await prisma.problem.findMany({
    where: {
      visibility: "public",
      ...(acIds.length > 0 ? { id: { notIn: acIds } } : {}),
      ...(acTags.length > 0 ? { tags: { hasSome: acTags } } : {})
    },
    select: {
      slug: true,
      defaultTitle: true,
      difficulty: true,
      tags: true
    },
    take: 20
  });

  // Randomly pick 3
  const shuffled = recommendations.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 3);

  return {
    stats: stats ?? {
      totalAc: 0,
      totalAttempts: 0,
      languageDist: {},
      difficultyDist: {},
      dailyActivity: []
    },
    recentSubmissions,
    recommendations: picked,
    username: actor.username ?? actor.displayName
  };
};

import { prisma } from "@nojv/db";
import { requireAuth } from "$lib/server/auth";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);

  // 1. Get UserStats (or defaults if not exist)
  const stats = await prisma.userStats.findUnique({
    where: { userId: actor.userId }
  });

  // 2. Recent 10 submissions with problem title
  const recentSubmissions = await prisma.submission.findMany({
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
  });

  // 3. Recommended problems (3 problems from tags user hasn't AC'd)
  const acProblemIds = await prisma.submission.findMany({
    where: { userId: actor.userId, status: "accepted", sampleOnly: false },
    select: { problemId: true },
    distinct: ["problemId"]
  });
  const acIds = acProblemIds.map((s) => s.problemId);

  // Get tags from AC'd problems
  const acProblems =
    acIds.length > 0
      ? await prisma.problem.findMany({
          where: { id: { in: acIds } },
          select: { tags: true }
        })
      : [];
  const acTags = [...new Set(acProblems.flatMap((p) => p.tags))];

  // Find problems with those tags (or any public problem if no tags) that user hasn't AC'd
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

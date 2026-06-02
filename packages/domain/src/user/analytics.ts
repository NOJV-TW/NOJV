import { problemRepo, submissionRepo } from "@nojv/db";

export interface SuggestedProblem {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
}

export async function getSuggestedProblems(
  userId: string,
  limit = 5,
): Promise<SuggestedProblem[]> {
  const acRows = await submissionRepo.findDistinctAcByUser(userId);
  if (acRows.length === 0) return [];

  const tagCount = new Map<string, number>();
  for (const row of acRows) {
    for (const tag of row.problem.tags) {
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    }
  }
  if (tagCount.size === 0) return [];

  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);

  const solvedIds = acRows.map((r) => r.problemId);

  const candidates = await problemRepo.findRecommendations({
    excludeIds: solvedIds,
    tags: topTags,
    take: Math.max(limit * 4, 20),
  });

  if (candidates.length === 0) return [];

  const difficultyOrder: Record<"easy" | "medium" | "hard", number> = {
    easy: 0,
    medium: 1,
    hard: 2,
  };

  const ranked = candidates
    .map((p) => {
      let overlap = 0;
      for (const tag of p.tags) {
        overlap += tagCount.get(tag) ?? 0;
      }
      return { id: p.id, title: p.title, difficulty: p.difficulty, tags: p.tags, overlap };
    })
    .filter((p) => p.overlap > 0)
    .sort(
      (a, b) =>
        b.overlap - a.overlap || difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty],
    )
    .slice(0, limit)
    .map<SuggestedProblem>(({ id, title, difficulty, tags }) => ({
      id,
      title,
      difficulty,
      tags,
    }));

  return ranked;
}

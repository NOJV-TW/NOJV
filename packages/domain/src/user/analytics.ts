import { problemRepo, submissionRepo, userDailyActivityRepo } from "@nojv/db";

export interface SuggestedProblem {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
}

/**
 * Truncate `now` to the start of its UTC day. We index `UserDailyActivity`
 * by UTC midnight so the streak query has to align to the same boundary.
 */
function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Count consecutive days ending today (or yesterday if today has no activity
 * yet) where the user had at least one accepted submission. If yesterday is
 * also empty the streak is broken and we return 0 — this matches LeetCode's
 * "today is a grace day" semantics so a user who hasn't solved anything
 * before noon doesn't see their streak vanish.
 */
export async function getStreakDays(userId: string, now: Date = new Date()): Promise<number> {
  const today = utcDayStart(now);
  const oneDayMs = 24 * 60 * 60 * 1000;
  // Look back at most 365 days — keeps the query bounded and matches the
  // longest streak any user could realistically maintain.
  const lookback = new Date(today.getTime() - 365 * oneDayMs);

  const rows = await userDailyActivityRepo.findRange(userId, lookback, today);
  if (rows.length === 0) return 0;

  const acByIso = new Map<string, number>();
  for (const row of rows) {
    acByIso.set(row.date.toISOString().slice(0, 10), row.acCount);
  }

  const todayIso = today.toISOString().slice(0, 10);
  const yesterday = new Date(today.getTime() - oneDayMs);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  // Pick the streak's anchor day. If today has any AC, count today.
  // Otherwise grace-day rule: count from yesterday if it has AC, else 0.
  let cursor: Date;
  if ((acByIso.get(todayIso) ?? 0) > 0) {
    cursor = today;
  } else if ((acByIso.get(yesterdayIso) ?? 0) > 0) {
    cursor = yesterday;
  } else {
    return 0;
  }

  let streak = 0;
  for (;;) {
    const iso = cursor.toISOString().slice(0, 10);
    if ((acByIso.get(iso) ?? 0) === 0) break;
    streak += 1;
    cursor = new Date(cursor.getTime() - oneDayMs);
  }
  return streak;
}

/**
 * Top N unsolved public problems whose tag set overlaps with the user's
 * most-frequently-AC'd tags. Ranking: tag-overlap-count DESC, then
 * difficulty ASC (easy → medium → hard) so beginners get the easiest
 * relevant practice first. Returns [] when the user has no AC tags.
 */
export async function getSuggestedProblems(
  userId: string,
  limit = 5,
): Promise<SuggestedProblem[]> {
  const acRows = await submissionRepo.findDistinctAcByUser(userId);
  if (acRows.length === 0) return [];

  // Most-frequently-AC'd tags, ranked by AC count.
  const tagCount = new Map<string, number>();
  for (const row of acRows) {
    for (const tag of row.problem.tags) {
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    }
  }
  if (tagCount.size === 0) return [];

  // Cap to the top 10 tags so the SQL `hasSome` clause stays narrow.
  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);

  const solvedIds = acRows.map((r) => r.problemId);

  // Pull a candidate pool wider than `limit` so we can rerank by tag overlap
  // before truncating. 4× limit is plenty without thrashing the DB.
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
      // Overlap weight = sum of the user's AC counts for each tag the
      // problem shares. A problem covering two of the user's strongest
      // tags outranks one that only matches a tail tag.
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

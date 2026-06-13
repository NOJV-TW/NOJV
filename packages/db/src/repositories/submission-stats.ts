import { prisma } from "../client";

export interface ProblemUserStats {
  problemId: string;
  attempters: number;
  solvers: number;
}

export interface ProblemStatusSummary {
  all: number;
  solved: number;
  attempted: number;
  bookmarked: number;
}

export async function countUserStatsByProblem(
  problemIds: string[],
): Promise<ProblemUserStats[]> {
  if (problemIds.length === 0) return [];
  return prisma.$queryRaw<ProblemUserStats[]>`
    SELECT
      "problemId",
      COUNT(DISTINCT "userId")::int AS attempters,
      COUNT(DISTINCT "userId") FILTER (WHERE status = 'accepted')::int AS solvers
    FROM "Submission"
    WHERE "problemId" = ANY(${problemIds}::text[])
      AND "sampleOnly" = false
    GROUP BY "problemId"
  `;
}

export async function countUserStatsByProblemForAssessments(
  assessmentIds: string[],
): Promise<ProblemUserStats[]> {
  if (assessmentIds.length === 0) return [];
  return prisma.$queryRaw<ProblemUserStats[]>`
    SELECT
      "problemId",
      COUNT(DISTINCT "userId")::int AS attempters,
      COUNT(DISTINCT "userId") FILTER (WHERE status = 'accepted')::int AS solvers
    FROM "Submission"
    WHERE "assessmentId" = ANY(${assessmentIds}::text[])
      AND "sampleOnly" = false
    GROUP BY "problemId"
  `;
}

export async function countProblemStatusSummaryForUser(
  userId: string,
): Promise<ProblemStatusSummary> {
  const rows = await prisma.$queryRaw<ProblemStatusSummary[]>`
    SELECT
      COUNT(DISTINCT p.id)::int AS all,
      COUNT(DISTINCT CASE WHEN s.has_accepted THEN p.id END)::int AS solved,
      COUNT(DISTINCT CASE WHEN s.has_any AND NOT s.has_accepted THEN p.id END)::int AS attempted,
      COUNT(DISTINCT CASE WHEN b."userId" IS NOT NULL THEN p.id END)::int AS bookmarked
    FROM "Problem" p
    LEFT JOIN (
      SELECT
        "problemId",
        bool_or(status = 'accepted' AND "sampleOnly" = false) AS has_accepted,
        bool_or("sampleOnly" = false) AS has_any
      FROM "Submission"
      WHERE "userId" = ${userId}
      GROUP BY "problemId"
    ) s ON s."problemId" = p.id
    LEFT JOIN "ProblemBookmark" b ON b."problemId" = p.id AND b."userId" = ${userId}
    WHERE p.visibility = 'public' AND p.status = 'published'
  `;
  return rows[0] ?? { all: 0, solved: 0, attempted: 0, bookmarked: 0 };
}

import { courseMembershipRepo, gradingRepo, scoreOverrideRepo, submissionRepo } from "@nojv/db";
import { getProblemTotalScores, requireProblemTotalScore } from "../problem/total-score";
import {
  activityScore,
  averageActivityScores,
  sumActivityScores,
} from "../scoring/activity-points";

export interface ClassStats {
  submittedUsers: number;
  totalStudents: number;
  avgScore: number;
}
export interface MyStatus {
  solved: number;
  total: number;
  score: number;
  totalPoints: number;
}

async function activityResults(type: "assignment" | "exam", ids: string[], userId?: string) {
  const activities = await gradingRepo.listActivities(type, ids);
  const maxima = await getProblemTotalScores(
    activities.flatMap((a) => a.problems.map((p) => p.problemId)),
  );
  return Promise.all(
    activities.map(async (activity) => {
      const [groups, overrides] = await Promise.all([
        submissionRepo.groupByUserAndProblem({
          ...(type === "exam" ? { examId: activity.id } : { assessmentId: activity.id }),
          ...(userId ? { userId } : {}),
          problemId: { in: activity.problems.map((p) => p.problemId) },
          sampleOnly: false,
          ...(type === "exam" ? { createdAt: { lt: activity.deadline } } : {}),
        }),
        scoreOverrideRepo.findCourseOverrides(type, [activity.id], userId),
      ]);
      const users = new Set(groups.map((g) => g.userId));
      const best = new Map(
        groups.map((g) => [`${g.userId}::${g.problemId}`, g._max.score ?? 0]),
      );
      const submittedUsers = users.size;
      for (const override of overrides) {
        const uid = override.membership?.userId ?? override.courseMembershipId;
        const pid = override.problemId;
        if (
          !uid ||
          (userId && uid !== userId) ||
          !activity.problems.some((p) => p.problemId === pid)
        )
          continue;
        users.add(uid);
        best.set(`${uid}::${pid}`, override.overrideScore);
      }
      const results = new Map(
        [...users].map((uid) => {
          let solved = 0;
          const scores = activity.problems.map((p) => {
            const raw = best.get(`${uid}::${p.problemId}`);
            const max = requireProblemTotalScore(maxima, p.problemId);
            if (raw !== undefined && raw >= max) solved++;
            return activityScore(raw ?? 0, max, p.points);
          });
          return [
            uid,
            {
              solved,
              total: activity.problems.length,
              score: sumActivityScores(scores),
              totalPoints: Number(activity.totalPoints),
            },
          ];
        }),
      );
      return {
        id: activity.id,
        totalPoints: Number(activity.totalPoints),
        problemCount: activity.problems.length,
        results,
        submittedUsers,
      };
    }),
  );
}

async function classStats(
  type: "assignment" | "exam",
  rows: { id: string; courseId: string }[],
): Promise<Map<string, ClassStats>> {
  if (!rows.length) return new Map();
  const [activities, students] = await Promise.all([
    activityResults(
      type,
      rows.map((r) => r.id),
    ),
    courseMembershipRepo.countStudentsByCourse([...new Set(rows.map((r) => r.courseId))]),
  ]);
  const courses = new Map(rows.map((r) => [r.id, r.courseId]));
  return new Map(
    activities.map((a) => [
      a.id,
      {
        submittedUsers: a.submittedUsers,
        totalStudents: students.get(courses.get(a.id) ?? "") ?? 0,
        avgScore: averageActivityScores([...a.results.values()].map((v) => v.score)),
      },
    ]),
  );
}

async function myStatus(
  type: "assignment" | "exam",
  userId: string,
  rows: { id: string; problemCount: number }[],
): Promise<Map<string, MyStatus>> {
  if (!rows.length) return new Map();
  const activities = await activityResults(
    type,
    rows.map((r) => r.id),
    userId,
  );
  return new Map(
    activities.map((a) => [
      a.id,
      a.results.get(userId) ?? {
        solved: 0,
        total: a.problemCount,
        score: 0,
        totalPoints: a.totalPoints,
      },
    ]),
  );
}

export function aggregateAssignmentClassStats(
  rows: { id: string; courseId: string; problemCount: number }[],
) {
  return classStats("assignment", rows);
}
export function aggregateExamClassStats(
  rows: { id: string; courseId: string; problemCount: number }[],
) {
  return classStats("exam", rows);
}
export function aggregateAssignmentMyStatus(
  userId: string,
  rows: { id: string; problemCount: number }[],
) {
  return myStatus("assignment", userId, rows);
}
export function aggregateExamMyStatus(
  userId: string,
  rows: { id: string; problemCount: number }[],
) {
  return myStatus("exam", userId, rows);
}

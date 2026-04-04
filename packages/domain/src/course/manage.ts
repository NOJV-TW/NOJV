import { assessmentRepo, courseMembershipRepo, courseRepo, submissionRepo } from "@nojv/db";
import { DEFAULT_LOCALE } from "@nojv/core";

import { pickProblemStatement } from "../shared/pick-problem-statement";

// ─── Course manage analytics ────────────────────────────────────────

export async function getCourseManageAnalytics(
  courseSlug: string,
  members: {
    userId: string;
    courseRole: string;
    displayName: string;
    username: string | null;
  }[]
) {
  const now = new Date();

  const students = members.filter((member) => member.courseRole === "student");
  const studentIds = new Set(students.map((student) => student.userId));
  const studentNameMap = new Map(
    students.map((student) => [student.userId, student.username ?? student.displayName])
  );

  const assessments = await assessmentRepo.listByCourseSlug(courseSlug);
  const assessmentIds = assessments.map((assessment) => assessment.id);

  const submissions =
    assessmentIds.length > 0
      ? await submissionRepo.findByCourseAndAssessments(courseSlug, assessmentIds)
      : [];

  const statusMap = new Map<string, number>();
  const studentSubmissionCount = new Map<string, number>();
  const studentAcceptedCount = new Map<string, number>();
  const studentBestScoreMap = new Map<string, Map<string, number>>();
  const studentAcceptedCellSet = new Map<string, Set<string>>();

  const assessmentAggMap = new Map(
    assessments.map((assessment) => [
      assessment.id,
      {
        submissionCount: 0,
        acceptedSubmissions: 0,
        participants: new Set<string>(),
        acceptedStudents: new Set<string>(),
        latestSubmissionAt: null as Date | null,
        bestScoreByUser: new Map<string, number>()
      }
    ])
  );

  for (const submission of submissions) {
    const assessmentId = submission.courseAssessmentId;
    if (!assessmentId) continue;

    const agg = assessmentAggMap.get(assessmentId);
    if (!agg) continue;

    agg.submissionCount += 1;
    agg.participants.add(submission.userId);

    const currentBest = agg.bestScoreByUser.get(submission.userId) ?? 0;
    if (submission.score > currentBest) {
      agg.bestScoreByUser.set(submission.userId, submission.score);
    }

    if (!agg.latestSubmissionAt || submission.createdAt > agg.latestSubmissionAt) {
      agg.latestSubmissionAt = submission.createdAt;
    }

    statusMap.set(submission.status, (statusMap.get(submission.status) ?? 0) + 1);

    if (studentIds.has(submission.userId)) {
      studentSubmissionCount.set(
        submission.userId,
        (studentSubmissionCount.get(submission.userId) ?? 0) + 1
      );

      let bestScoreEntries = studentBestScoreMap.get(submission.userId);
      if (!bestScoreEntries) {
        bestScoreEntries = new Map();
        studentBestScoreMap.set(submission.userId, bestScoreEntries);
      }
      const scoreKey = `${assessmentId}:${submission.problemId}`;
      const existingBest = bestScoreEntries.get(scoreKey) ?? 0;
      if (submission.score > existingBest) {
        bestScoreEntries.set(scoreKey, submission.score);
      }

      if (submission.status === "accepted") {
        agg.acceptedSubmissions += 1;
        agg.acceptedStudents.add(submission.userId);

        studentAcceptedCount.set(
          submission.userId,
          (studentAcceptedCount.get(submission.userId) ?? 0) + 1
        );

        let acceptedCells = studentAcceptedCellSet.get(submission.userId);
        if (!acceptedCells) {
          acceptedCells = new Set();
          studentAcceptedCellSet.set(submission.userId, acceptedCells);
        }
        acceptedCells.add(scoreKey);
      }
    }
  }

  const assessmentRows = assessments.map((assessment) => {
    const agg = assessmentAggMap.get(assessment.id);
    const participants = agg?.participants.size ?? 0;
    const acceptedStudents = agg?.acceptedStudents.size ?? 0;
    const submissionCount = agg?.submissionCount ?? 0;
    const acceptedSubmissions = agg?.acceptedSubmissions ?? 0;
    const bestScores = [...(agg?.bestScoreByUser.values() ?? [])];

    const avgBestScore =
      bestScores.length > 0
        ? Number(
            (bestScores.reduce((sum, score) => sum + score, 0) / bestScores.length).toFixed(1)
          )
        : 0;

    const participantRate =
      students.length > 0 ? Math.round((participants / students.length) * 100) : 0;
    const acceptedStudentRate =
      students.length > 0 ? Math.round((acceptedStudents / students.length) * 100) : 0;

    return {
      id: assessment.id,
      slug: assessment.slug,
      title: assessment.title,
      opensAt: assessment.opensAt,
      dueAt: assessment.dueAt,
      closesAt: assessment.closesAt,
      problemCount: assessment._count.problems,
      participantCount: participants,
      participantRate,
      submissionCount,
      acceptedSubmissions,
      acceptedStudents,
      acceptedStudentRate,
      avgBestScore,
      latestSubmissionAt: agg?.latestSubmissionAt ?? null,
      isActive: assessment.opensAt <= now && now <= assessment.closesAt
    };
  });

  const totalSubmissions = submissions.length;
  const acceptedSubmissionsTotal = submissions.filter(
    (submission) => submission.status === "accepted"
  ).length;
  const pendingJudgeCount =
    (statusMap.get("queued") ?? 0) +
    (statusMap.get("compiling") ?? 0) +
    (statusMap.get("running") ?? 0);

  const activeStudents = new Set(
    submissions
      .filter((submission) => studentIds.has(submission.userId))
      .map((submission) => submission.userId)
  );
  const participationRate =
    students.length > 0 ? Math.round((activeStudents.size / students.length) * 100) : 0;

  const acceptedRate =
    totalSubmissions > 0 ? Math.round((acceptedSubmissionsTotal / totalSubmissions) * 100) : 0;

  const statusBreakdown = [...statusMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value);

  const seriesRows = [...assessmentRows].reverse();

  const leaderboard = students
    .map((student) => {
      const bestScoreMap = studentBestScoreMap.get(student.userId);
      const totalScore = bestScoreMap
        ? [...bestScoreMap.values()].reduce((sum, score) => sum + score, 0)
        : 0;

      return {
        userId: student.userId,
        username: student.username ?? student.displayName,
        submissionCount: studentSubmissionCount.get(student.userId) ?? 0,
        acceptedCount: studentAcceptedCount.get(student.userId) ?? 0,
        acceptedCells: studentAcceptedCellSet.get(student.userId)?.size ?? 0,
        totalScore
      };
    })
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
      if (right.acceptedCells !== left.acceptedCells)
        return right.acceptedCells - left.acceptedCells;
      return left.username.localeCompare(right.username);
    })
    .slice(0, 12);

  const atRiskStudents = students
    .map((student) => ({
      userId: student.userId,
      username: studentNameMap.get(student.userId) ?? student.displayName,
      submissionCount: studentSubmissionCount.get(student.userId) ?? 0,
      acceptedCount: studentAcceptedCount.get(student.userId) ?? 0
    }))
    .filter((student) => student.submissionCount === 0 || student.acceptedCount === 0)
    .sort((left, right) => {
      if (left.submissionCount !== right.submissionCount)
        return left.submissionCount - right.submissionCount;
      if (left.acceptedCount !== right.acceptedCount)
        return left.acceptedCount - right.acceptedCount;
      return left.username.localeCompare(right.username);
    })
    .slice(0, 8);

  return {
    overview: {
      totalStudents: students.length,
      totalAssessments: assessmentRows.length,
      activeAssessments: assessmentRows.filter((assessment) => assessment.isActive).length,
      totalSubmissions,
      acceptedRate,
      pendingJudgeCount,
      participationRate
    },
    assessmentRows,
    statusBreakdown,
    series: {
      labels: seriesRows.map((row) => row.title),
      submissionCounts: seriesRows.map((row) => row.submissionCount),
      acceptedRates: seriesRows.map((row) => row.acceptedStudentRate),
      participantRates: seriesRows.map((row) => row.participantRate)
    },
    leaderboard,
    atRiskStudents
  };
}

// ─── Teacher overview ───────────────────────────────────────────────

export async function getTeacherOverview(courseSlugs: string[]) {
  const now = new Date();
  const from7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [studentMemberships, activeAssessments, submissions7d] = await Promise.all([
    courseMembershipRepo.countStudents(courseSlugs),
    courseMembershipRepo.countActiveAssessments(courseSlugs, now),
    submissionRepo.findByCourseSlugsWith7dStats(courseSlugs, from7d)
  ]);

  const total7d = submissions7d.length;
  const accepted7d = submissions7d.filter(
    (submission) => submission.status === "accepted"
  ).length;
  const acceptedRate7d = total7d > 0 ? Math.round((accepted7d / total7d) * 100) : 0;

  const byAssessment = new Map<
    string,
    {
      accepted: number;
      assessmentSlug: string;
      assessmentTitle: string;
      count: number;
      courseSlug: string;
      courseTitle: string;
    }
  >();

  for (const submission of submissions7d) {
    const assessment = submission.courseAssessment;
    if (!assessment || !submission.courseAssessmentId) continue;

    const key = submission.courseAssessmentId;
    const current = byAssessment.get(key) ?? {
      accepted: 0,
      assessmentSlug: assessment.slug,
      assessmentTitle: assessment.title,
      count: 0,
      courseSlug: assessment.course.slug,
      courseTitle: assessment.course.title
    };

    current.count += 1;
    if (submission.status === "accepted") {
      current.accepted += 1;
    }
    byAssessment.set(key, current);
  }

  return {
    totalStudents: studentMemberships,
    activeAssessments,
    submissions7d: total7d,
    acceptedRate7d,
    hottestAssessments: [...byAssessment.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, 6)
      .map((row) => ({
        assessmentSlug: row.assessmentSlug,
        assessmentTitle: row.assessmentTitle,
        courseSlug: row.courseSlug,
        courseTitle: row.courseTitle,
        submissionCount: row.count,
        acceptedRate: row.count > 0 ? Math.round((row.accepted / row.count) * 100) : 0
      }))
  };
}

// ─── Export CSV ─────────────────────────────────────────────────────

export async function getExportData(courseSlug: string, assessmentSlug: string) {
  const course = await courseRepo.findIdBySlug(courseSlug);
  if (!course) return null;

  const assessment = await assessmentRepo.findWithProblemDetails(course.id, assessmentSlug);
  if (!assessment) return null;

  const problems = assessment.problems.map((p) => {
    const localized = pickProblemStatement(
      p.problem.statements,
      DEFAULT_LOCALE,
      p.problem.id,
      p.problem.summary
    );
    return { problemId: p.problem.id, title: localized.title };
  });

  const memberships = await courseMembershipRepo.findStudents(course.id);
  const students = memberships.map((m) => ({
    userId: m.userId,
    username: m.user.username ?? m.user.name,
    name: m.user.name
  }));

  const problemIds = problems.map((p) => p.problemId);
  const studentIds = students.map((s) => s.userId);

  const grouped = await submissionRepo.groupBestScores({
    assessmentId: assessment.id,
    studentIds,
    problemIds
  });

  const scoreLookup = new Map<string, number>();
  for (const row of grouped) {
    scoreLookup.set(`${row.userId}:${row.problemId}`, row._max.score ?? 0);
  }

  return { problems, students, scoreLookup };
}

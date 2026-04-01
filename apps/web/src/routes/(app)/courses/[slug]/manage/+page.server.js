/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/restrict-plus-operands */

import { prisma } from "@nojv/db";

export const load = async ({ parent }) => {
  const { courseData } = await parent();
  const courseSlug = courseData.course.slug;
  const now = new Date();

  const students = courseData.course.members.filter(
    (member) => member.courseRole === "student"
  );
  const studentIds = new Set(students.map((student) => student.userId));
  const studentNameMap = new Map(
    students.map((student) => [student.userId, student.username ?? student.displayName])
  );

  const assessments = await prisma.courseAssessment.findMany({
    where: {
      course: { slug: courseSlug },
      status: "published"
    },
    orderBy: { opensAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      opensAt: true,
      dueAt: true,
      closesAt: true,
      _count: { select: { problems: true } }
    }
  });

  const assessmentIds = assessments.map((assessment) => assessment.id);

  const submissions =
    assessmentIds.length > 0
      ? await prisma.submission.findMany({
          where: {
            course: { slug: courseSlug },
            sampleOnly: false,
            courseAssessmentId: { in: assessmentIds }
          },
          select: {
            courseAssessmentId: true,
            userId: true,
            status: true,
            score: true,
            problemId: true,
            createdAt: true
          }
        })
      : [];

  const statusMap = new Map();
  const studentSubmissionCount = new Map();
  const studentAcceptedCount = new Map();
  const studentBestScoreMap = new Map();
  const studentAcceptedCellSet = new Map();

  const assessmentAggMap = new Map(
    assessments.map((assessment) => [
      assessment.id,
      {
        submissionCount: 0,
        acceptedSubmissions: 0,
        participants: new Set(),
        acceptedStudents: new Set(),
        latestSubmissionAt: null,
        bestScoreByUser: new Map()
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
    analytics: {
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
    }
  };
};

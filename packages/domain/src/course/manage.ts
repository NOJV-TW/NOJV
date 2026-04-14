import { courseMembershipRepo, submissionRepo } from "@nojv/db";

export async function getTeacherOverview(courseIds: string[]) {
  const now = new Date();
  const from7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [studentMemberships, activeAssessments, submissions7d] = await Promise.all([
    courseMembershipRepo.countStudents(courseIds),
    courseMembershipRepo.countActiveAssessments(courseIds, now),
    submissionRepo.findByCourseIdsWith7dStats(courseIds, from7d)
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
      courseId: string;
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
      courseId: assessment.course.id,
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
        courseId: row.courseId,
        courseTitle: row.courseTitle,
        submissionCount: row.count,
        acceptedRate: row.count > 0 ? Math.round((row.accepted / row.count) * 100) : 0
      }))
  };
}

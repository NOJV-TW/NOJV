import { error } from "@sveltejs/kit";
import { prisma } from "@nojv/db";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, parent }) => {
  const { courseData } = await parent();

  const assessment = courseData.course.assessments.find(
    (a) => a.slug === params.assessmentSlug
  );

  if (!assessment) {
    error(404, "Assessment not found");
  }

  const reports = await prisma.plagiarismReport.findMany({
    where: { courseAssessmentId: assessment.id },
    orderBy: { createdAt: "desc" },
    select: {
      completedAt: true,
      createdAt: true,
      id: true,
      mossReportUrl: true,
      results: true,
      status: true
    }
  });

  // Build a lookup of userId -> handle/name for display
  const memberMap = new Map(
    courseData.course.members.map((m) => [
      m.userId,
      { displayName: m.displayName, handle: m.handle }
    ])
  );

  // Build a lookup of problemId -> slug for display
  const assessmentProblems = await prisma.courseAssessmentProblem.findMany({
    where: { assessmentId: assessment.id },
    include: { problem: { select: { id: true, slug: true, defaultTitle: true } } }
  });

  const problemMap = Object.fromEntries(
    assessmentProblems.map((ap) => [ap.problemId, { slug: ap.problem.slug, title: ap.problem.defaultTitle }])
  );

  return {
    assessment: { id: assessment.id, slug: assessment.slug, title: assessment.title },
    courseSlug: params.slug,
    memberMap: Object.fromEntries(memberMap),
    problemMap,
    reports: reports.map((r) => ({
      ...r,
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString()
    }))
  };
};

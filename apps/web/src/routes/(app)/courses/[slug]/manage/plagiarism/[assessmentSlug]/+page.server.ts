import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";
import { plagiarismDomain } from "@nojv/domain";

const { listAssessmentPlagiarismReports, getAssessmentProblemMap } = plagiarismDomain;

export const load: PageServerLoad = async ({ params, parent }) => {
  const { courseData } = await parent();

  const assessment = courseData.course.assessments.find(
    (a) => a.slug === params.assessmentSlug
  );

  if (!assessment) {
    error(404, "Assessment not found");
  }

  const reports = await listAssessmentPlagiarismReports(assessment.id);

  // Build a lookup of userId -> username/name for display
  const memberMap = new Map(
    courseData.course.members.map((m) => [
      m.userId,
      { displayName: m.displayName, username: m.username }
    ])
  );

  // Build a lookup of problemId -> slug for display
  const problemMap = await getAssessmentProblemMap(assessment.id);

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

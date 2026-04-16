import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { courseDomain, plagiarismDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getAssignmentDetail, buildSubmissionsMatrix } = courseDomain;
const { findPlagiarismReport } = plagiarismDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { assessment, isManager } = parent;
  const assessmentId = assessment.id;
  const courseId = assessment.courseId;

  if (isManager) {
    const [detail, matrix, plagiarism] = await Promise.all([
      getAssignmentDetail(courseId, assessmentId, {
        viewerUserId: actor.userId,
        isManager: true
      }),
      buildSubmissionsMatrix(courseId, assessmentId),
      findPlagiarismReport({ type: "courseAssessment", id: assessmentId }).catch(() => null)
    ]);

    return {
      mode: "teacher" as const,
      detail,
      matrix,
      plagiarism: plagiarism
        ? {
            status: plagiarism.status,
            mossReportUrl: plagiarism.mossReportUrl,
            triggeredAt: plagiarism.triggeredAt?.toISOString() ?? null,
            completedAt: plagiarism.completedAt?.toISOString() ?? null,
            results: plagiarism.results as unknown
          }
        : null
    };
  }

  const detail = await getAssignmentDetail(courseId, assessmentId, {
    viewerUserId: actor.userId,
    isManager: false
  });
  return {
    mode: "student" as const,
    detail
  };
});

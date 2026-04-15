import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { courseDomain, plagiarismDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getAssignmentDetail, buildSubmissionsMatrix } = courseDomain;
const { findPlagiarismReport } = plagiarismDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const parent = await event.parent();
  const { course, isManager } = parent;
  const actor = requireAuth(event);
  const assessmentId = event.params.assignmentId;

  if (isManager) {
    const [detail, matrix, plagiarism] = await Promise.all([
      getAssignmentDetail(course.id, assessmentId, {
        viewerUserId: actor.userId,
        isManager: true
      }),
      buildSubmissionsMatrix(course.id, assessmentId),
      findPlagiarismReport({ type: "courseAssessment", id: assessmentId }).catch(() => null)
    ]);

    return {
      mode: "teacher" as const,
      detail,
      matrix,
      // Cast the plagiarism JSON result blob to a plain shape the UI can
      // consume without importing domain types into the Svelte side.
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

  const detail = await getAssignmentDetail(course.id, assessmentId, {
    viewerUserId: actor.userId,
    isManager: false
  });
  return {
    mode: "student" as const,
    detail
  };
});

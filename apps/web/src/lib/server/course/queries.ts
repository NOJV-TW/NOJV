import { courseDomain } from "@nojv/domain";

const { loadAssessmentDetail, listUserAssessments } = courseDomain;
type CoursePageDetailData = courseDomain.CoursePageDetailData;

import {
  assessmentPresentation,
  deriveAssessmentWindowState,
  windowStateColorClass
} from "$lib/types";

export function createAssessmentDetailLoader() {
  return async ({
    params,
    parent,
    locals
  }: {
    locals: App.Locals;
    params: { assessmentSlug: string; slug: string };
    parent: () => Promise<{ courseData: CoursePageDetailData }>;
    request: Request;
  }) => {
    const { assessmentSlug } = params;
    const { courseData } = await parent();
    const userId = locals.user?.id ?? null;

    const { assessment, course, problems } = await loadAssessmentDetail({
      assessmentSlug,
      courseData,
      userId
    });

    const presentation = assessmentPresentation;
    const windowState = deriveAssessmentWindowState({
      closesAt: assessment.closesAt,
      dueAt: assessment.dueAt,
      opensAt: assessment.opensAt
    });

    return {
      assessment,
      course,
      presentation,
      problems,
      windowState
    };
  };
}

export function createAssessmentListLoader() {
  return async ({ locals }: { locals: App.Locals }) => {
    const userId = locals.user?.id ?? null;

    if (!userId) {
      return { items: null };
    }

    const items = await listUserAssessments(userId);
    const now = new Date().toISOString();

    return {
      items: items.map((a) => {
        const windowState = deriveAssessmentWindowState({
          closesAt: a.closesAt,
          dueAt: a.dueAt,
          now,
          opensAt: a.opensAt
        });
        return {
          ...a,
          windowState,
          windowStateColor: windowStateColorClass(windowState)
        };
      })
    };
  };
}

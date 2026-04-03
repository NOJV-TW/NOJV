// Re-export from domain — original logic has been moved to @nojv/domain
// SvelteKit-specific loaders remain here as thin wrappers around domain functions.
import { error } from "@sveltejs/kit";
import { courseDomain, getClientIp } from "@nojv/domain";

const { loadAssessmentDetail, listUserAssessments, ForbiddenIpError } = courseDomain;
type CoursePageDetailData = courseDomain.CoursePageDetailData;

import {
  assessmentPresentation,
  deriveAssessmentWindowState,
  windowStateColorClass
} from "$lib/types";

// ─── Assessment detail loader ────────────────────────────────────────

export function createAssessmentDetailLoader() {
  return async ({
    params,
    parent,
    locals,
    request
  }: {
    locals: App.Locals;
    params: { assessmentSlug: string; slug: string };
    parent: () => Promise<{ courseData: CoursePageDetailData }>;
    request: Request;
  }) => {
    const { assessmentSlug } = params;
    const { courseData } = await parent();
    const userId = locals.user?.id ?? null;
    const clientIp = getClientIp(request);

    try {
      const { assessment, course, problems } = await loadAssessmentDetail({
        assessmentSlug,
        courseData,
        userId,
        clientIp
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
    } catch (err) {
      if (err instanceof ForbiddenIpError) {
        error(403, err.message);
      }
      if (err && typeof err === "object" && "name" in err) {
        const namedErr = err as { name: string; message: string };
        if (namedErr.name === "NotFoundError") {
          error(404, namedErr.message);
        }
      }
      throw err;
    }
  };
}

// ─── Assessment list loader ──────────────────────────────────────────

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

import type { PageServerLoad } from "./$types";
import { listUserAssessments } from "$lib/server/read-model";
import {
  deriveAssessmentWindowState,
  windowStateColorClass
} from "$lib/course-assessment-helpers";

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id ?? null;

  if (!userId) {
    return { items: null };
  }

  const items = await listUserAssessments(userId, "exam");
  const now = new Date().toISOString();

  return {
    items: items.map((a) => ({
      ...a,
      windowState: deriveAssessmentWindowState({
        closesAt: a.closesAt,
        dueAt: a.dueAt,
        now,
        opensAt: a.opensAt
      }),
      windowStateColor: windowStateColorClass(
        deriveAssessmentWindowState({
          closesAt: a.closesAt,
          dueAt: a.dueAt,
          now,
          opensAt: a.opensAt
        })
      )
    }))
  };
};

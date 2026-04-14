import { courseDomain } from "@nojv/domain";

const { listUserAssessments } = courseDomain;

import { deriveAssessmentWindowState, windowStateColorClass } from "$lib/types";

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

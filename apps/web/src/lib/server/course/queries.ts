import { courseDomain } from "@nojv/domain";

const { listUserAssignments } = courseDomain;

import { deriveAssignmentWindowState, windowStateColorClass } from "$lib/types";

export function createAssignmentListLoader() {
  return async ({ locals }: { locals: App.Locals }) => {
    const userId = locals.user?.id ?? null;

    if (!userId) {
      return { items: null };
    }

    const items = await listUserAssignments(userId);
    const now = new Date().toISOString();

    return {
      items: items.map((a) => {
        const windowState = deriveAssignmentWindowState({
          closesAt: a.closesAt,
          dueAt: a.dueAt,
          now,
          opensAt: a.opensAt,
        });
        return {
          ...a,
          windowState,
          windowStateColor: windowStateColorClass(windowState),
        };
      }),
    };
  };
}

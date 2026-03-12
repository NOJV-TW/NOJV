import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

import { getActorContext, hasActorHandle } from "$lib/server/auth";
import { listAnnouncements, listUpcomingAssessments } from "$lib/server/course/queries";
import { deriveAssessmentWindowState, windowStateColorClass } from "$lib/types";

export const load: PageServerLoad = async (event) => {
  const user = event.locals.user;

  // If logged in but hasn't set a handle, redirect to complete profile
  const actor = getActorContext(event);
  if (actor && !hasActorHandle(actor)) {
    redirect(302, "/complete-profile");
  }

  if (!user) {
    const announcements = await listAnnouncements();
    return { announcements, assessments: [] };
  }

  const now = new Date().toISOString();
  const [announcements, rawAssessments] = await Promise.all([
    listAnnouncements(),
    listUpcomingAssessments(user.id)
  ]);

  const assessments = rawAssessments.map((a) => {
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
  });

  return { announcements, assessments };
};

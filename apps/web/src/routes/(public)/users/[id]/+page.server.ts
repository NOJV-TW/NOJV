import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { NotFoundError, userDomain } from "@nojv/application";
import { fail } from "@sveltejs/kit";
import { requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { canViewProfile, getPublicProfile } = userDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const profile = await getPublicProfile(event.params.id);

  const sessionUser = event.locals.sessionUser;
  const viewer = sessionUser
    ? {
        userId: sessionUser.id,
        isAdmin: sessionUser.platformRole === "admin" && event.locals.adminModeActive,
      }
    : null;

  if (!canViewProfile(viewer, profile.user)) {
    throw new NotFoundError("User not found");
  }

  return {
    profile: {
      ...profile,
      activity: profile.activity.map((e) => ({ at: e.createdAt.toISOString(), ac: e.isAc })),
    },
    isOwner: viewer?.userId === profile.user.id,
  };
});

export const actions = {
  updateProfileVisibility: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    if (actor.userId !== event.params.id) {
      return fail(403);
    }

    const formData = await event.request.formData();
    const profilePublic = formData.get("profilePublic") === "true";

    await userDomain.updateProfileVisibility(actor.userId, profilePublic);

    return { success: true };
  }),
} satisfies Actions;

import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { canViewManagePanel, requireAuth, getCoursePermissionRole } from "$lib/server/auth";

export const load: LayoutServerLoad = async (event) => {
  const actor = requireAuth(event);
  const role = await getCoursePermissionRole(event.params.slug, actor);

  if (!role || !canViewManagePanel(role)) {
    error(403, "You do not have permission to manage this course.");
  }

  return { courseRole: role };
};

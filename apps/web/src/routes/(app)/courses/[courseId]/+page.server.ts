import { fail } from "@sveltejs/kit";
import type { PlatformRole } from "@nojv/core";
import {
  ForbiddenError,
  announcementDomain,
  canManageCourse,
  courseDomain,
  resolveEffectiveCourseRole,
} from "@nojv/domain";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { readCheckbox, readString } from "$lib/server/shared/form-utils";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { withRateLimit } from "$lib/server/shared/action-handlers";

const {
  listRecentAnnouncementsForCourse,
  listAssignmentOverviewForCourse,
  listExamOverviewForCourse,
  getCourseHeaderById,
} = courseDomain;
const {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  toggleAnnouncementPin,
  getAnnouncementById,
} = announcementDomain;

const ANNOUNCEMENT_LIMIT = 5;
const ASSESSMENT_LIMIT = 3;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { course, isManager, counts } = parent;
  const now = new Date();

  const [announcements, assignments, exams] = await Promise.all([
    listRecentAnnouncementsForCourse(course.id, ANNOUNCEMENT_LIMIT, actor),
    listAssignmentOverviewForCourse(course.id, {
      limit: ASSESSMENT_LIMIT,
      isManager,
      forUserId: actor.userId,
      now,
    }),
    listExamOverviewForCourse(course.id, {
      limit: ASSESSMENT_LIMIT,
      isManager,
      forUserId: actor.userId,
      now,
    }),
  ]);

  const totalStudents = counts.members;
  const examsWithClassTotals = exams.map((exam) => ({
    ...exam,
    totalStudents,
  }));

  return {
    announcements,
    assignments,
    exams: examsWithClassTotals,
    totalStudents,
  };
});

// Re-derive manager status server-side per action — never trust loader output.
async function assertCourseManager(
  userId: string,
  platformRole: PlatformRole,
  courseId: string,
) {
  if (platformRole === "admin") return;
  const course = await getCourseHeaderById(courseId, userId);
  if (!course) throw new ForbiddenError("Course not found.");
  if (course.ownerId === userId) return;
  const membership = course.memberships[0] ?? null;
  const role = resolveEffectiveCourseRole(platformRole, membership?.role ?? null);
  if (!canManageCourse(role) || membership?.status !== "active") {
    throw new ForbiddenError("You do not have permission to manage this course.");
  }
}

function readExpiresAt(formData: FormData): Date | null {
  const raw = formData.get("expiresAt");
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const actions = {
  createAnnouncement: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    try {
      await assertCourseManager(actor.userId, actor.platformRole, courseId);
    } catch (err) {
      const c = classifyError(err);
      return fail(c.status, { error: c.message });
    }

    const formData = await event.request.formData();
    const title = readString(formData, "title");
    const content = readString(formData, "content");
    if (!title || !content) {
      return fail(400, { error: "Title and content are required." });
    }

    try {
      await createAnnouncement({
        title,
        content,
        pinned: readCheckbox(formData, "pinned"),
        // Course announcements always go live and target the whole class —
        // platform-level audience/draft semantics don't apply here.
        published: true,
        audience: "all",
        expiresAt: readExpiresAt(formData),
        courseId,
        createdByUserId: actor.userId,
      });
    } catch (err) {
      const c = classifyError(err);
      return fail(c.status, { error: c.message });
    }

    return { success: true };
  }),

  updateAnnouncement: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    try {
      await assertCourseManager(actor.userId, actor.platformRole, courseId);
    } catch (err) {
      const c = classifyError(err);
      return fail(c.status, { error: c.message });
    }

    const formData = await event.request.formData();
    const id = readString(formData, "id");
    const title = readString(formData, "title");
    const content = readString(formData, "content");
    if (!id || !title || !content) {
      return fail(400, { error: "ID, title, and content are required." });
    }

    // Forbid moving an announcement between courses through this endpoint.
    const existing = await getAnnouncementById(id);
    if (existing?.courseId !== courseId) {
      return fail(404, { error: "Announcement not found in this course." });
    }

    try {
      await updateAnnouncement(id, {
        title,
        content,
        pinned: readCheckbox(formData, "pinned"),
        published: true,
        audience: "all",
        expiresAt: readExpiresAt(formData),
      });
    } catch (err) {
      const c = classifyError(err);
      return fail(c.status, { error: c.message });
    }

    return { success: true };
  }),

  togglePinAnnouncement: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    try {
      await assertCourseManager(actor.userId, actor.platformRole, courseId);
    } catch (err) {
      const c = classifyError(err);
      return fail(c.status, { error: c.message });
    }

    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    const existing = await getAnnouncementById(id);
    if (existing?.courseId !== courseId) {
      return fail(404, { error: "Announcement not found in this course." });
    }

    try {
      await toggleAnnouncementPin(id);
    } catch (err) {
      const c = classifyError(err);
      return fail(c.status, { error: c.message });
    }

    return { success: true };
  }),

  deleteAnnouncement: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    try {
      await assertCourseManager(actor.userId, actor.platformRole, courseId);
    } catch (err) {
      const c = classifyError(err);
      return fail(c.status, { error: c.message });
    }

    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    const existing = await getAnnouncementById(id);
    if (existing?.courseId !== courseId) {
      return fail(404, { error: "Announcement not found in this course." });
    }

    try {
      await deleteAnnouncement(id);
    } catch (err) {
      const c = classifyError(err);
      return fail(c.status, { error: c.message });
    }

    return { success: true };
  }),
} satisfies Actions;

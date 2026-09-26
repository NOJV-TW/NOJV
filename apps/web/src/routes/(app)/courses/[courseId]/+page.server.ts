import { fail } from "@sveltejs/kit";
import { announcementDomain, assertCourseManager, courseDomain } from "@nojv/application";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { readCheckbox, readString } from "$lib/server/shared/form-utils";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { withAction } from "$lib/server/shared/action-handlers";

const {
  listRecentAnnouncementsForCourse,
  listAssignmentOverviewForCourse,
  listExamOverviewForCourse,
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

function readExpiresAt(formData: FormData): Date | null {
  const raw = formData.get("expiresAt");
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const actions = {
  createAnnouncement: withAction(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    await assertCourseManager(actor, courseId);

    const formData = await event.request.formData();
    const title = readString(formData, "title");
    const content = readString(formData, "content");
    if (!title || !content) {
      return fail(400, { error: "Title and content are required." });
    }

    await createAnnouncement({
      title,
      content,
      pinned: readCheckbox(formData, "pinned"),
      published: true,
      audience: "all",
      expiresAt: readExpiresAt(formData),
      courseId,
      createdByUserId: actor.userId,
    });

    return { success: true };
  }),

  updateAnnouncement: withAction(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    await assertCourseManager(actor, courseId);

    const formData = await event.request.formData();
    const id = readString(formData, "id");
    const title = readString(formData, "title");
    const content = readString(formData, "content");
    if (!id || !title || !content) {
      return fail(400, { error: "ID, title, and content are required." });
    }

    const existing = await getAnnouncementById(id);
    if (existing?.courseId !== courseId) {
      return fail(404, { error: "Announcement not found in this course." });
    }

    await updateAnnouncement(id, {
      title,
      content,
      pinned: readCheckbox(formData, "pinned"),
      published: true,
      audience: "all",
      expiresAt: readExpiresAt(formData),
    });

    return { success: true };
  }),

  togglePinAnnouncement: withAction(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    await assertCourseManager(actor, courseId);

    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    const existing = await getAnnouncementById(id);
    if (existing?.courseId !== courseId) {
      return fail(404, { error: "Announcement not found in this course." });
    }

    await toggleAnnouncementPin(id);

    return { success: true };
  }),

  deleteAnnouncement: withAction(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    await assertCourseManager(actor, courseId);

    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    const existing = await getAnnouncementById(id);
    if (existing?.courseId !== courseId) {
      return fail(404, { error: "Announcement not found in this course." });
    }

    await deleteAnnouncement(id);

    return { success: true };
  }),
} satisfies Actions;

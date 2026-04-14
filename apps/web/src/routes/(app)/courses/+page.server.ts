import { courseCreateSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { canCreateCourse, getActorContext, requireAuth } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { courseDomain } from "@nojv/domain";

const { createCourseRecord, listCourseCards, getTeacherOverview } = courseDomain;

export const load: PageServerLoad = async (event) => {
  const actor = getActorContext(event);
  const isStaff = actor ? canCreateCourse(actor.platformRole) : false;

  const courses = isStaff
    ? await listCourseCards()
    : actor
      ? await listCourseCards(actor.userId)
      : [];

  let teacherOverview: {
    managedCourses: number;
    totalStudents: number;
    activeAssessments: number;
    submissions7d: number;
    acceptedRate7d: number;
    hottestAssessments: {
      assessmentSlug: string;
      assessmentTitle: string;
      courseId: string;
      courseTitle: string;
      submissionCount: number;
      acceptedRate: number;
    }[];
  } | null = null;

  if (actor && isStaff && courses.length > 0) {
    const courseIds = courses.map((course) => course.id);
    const overview = await getTeacherOverview(courseIds);

    teacherOverview = {
      managedCourses: courses.length,
      ...overview
    };
  }

  const form = await superValidate(zod4(courseCreateSchema));

  return { courses, form, teacherOverview };
};

export const actions = {
  create: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);

    if (!canCreateCourse(actor.platformRole)) {
      return fail(403, { error: "Only teachers or admins can create courses." });
    }

    const form = await superValidate(event, zod4(courseCreateSchema));
    if (!form.valid) return fail(400, { form });

    try {
      await createCourseRecord(actor, form.data);
      return message(form, "Course created.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Course creation failed.";
      return fail(400, { form, error: msg });
    }
  }
} satisfies Actions;

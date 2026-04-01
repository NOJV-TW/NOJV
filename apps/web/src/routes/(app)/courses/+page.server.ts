import { courseCreateSchema } from "@nojv/core";
import { prisma } from "@nojv/db";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { canCreateCourse, getActorContext, requireAuth } from "$lib/server/auth";
import { createCourseRecord } from "$lib/server/course/mutations";
import { listCourseCards } from "$lib/server/course/queries";

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
      courseSlug: string;
      courseTitle: string;
      submissionCount: number;
      acceptedRate: number;
    }[];
  } | null = null;

  if (actor && isStaff && courses.length > 0) {
    const now = new Date();
    const from7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const courseSlugs = courses.map((course) => course.slug);

    const [studentMemberships, activeAssessments, submissions7d] = await Promise.all([
      prisma.courseMembership.count({
        where: {
          course: { slug: { in: courseSlugs } },
          role: "student",
          status: "active"
        }
      }),
      prisma.courseAssessment.count({
        where: {
          course: { slug: { in: courseSlugs } },
          status: "published",
          opensAt: { lte: now },
          closesAt: { gte: now }
        }
      }),
      prisma.submission.findMany({
        where: {
          sampleOnly: false,
          createdAt: { gte: from7d },
          course: { slug: { in: courseSlugs } },
          courseAssessmentId: { not: null }
        },
        select: {
          status: true,
          courseAssessmentId: true,
          courseAssessment: {
            select: {
              slug: true,
              title: true,
              course: { select: { slug: true, title: true } }
            }
          }
        }
      })
    ]);

    const total7d = submissions7d.length;
    const accepted7d = submissions7d.filter(
      (submission) => submission.status === "accepted"
    ).length;
    const acceptedRate7d = total7d > 0 ? Math.round((accepted7d / total7d) * 100) : 0;

    const byAssessment = new Map<
      string,
      {
        accepted: number;
        assessmentSlug: string;
        assessmentTitle: string;
        count: number;
        courseSlug: string;
        courseTitle: string;
      }
    >();

    for (const submission of submissions7d) {
      const assessment = submission.courseAssessment;
      if (!assessment || !submission.courseAssessmentId) continue;

      const key = submission.courseAssessmentId;
      const current = byAssessment.get(key) ?? {
        accepted: 0,
        assessmentSlug: assessment.slug,
        assessmentTitle: assessment.title,
        count: 0,
        courseSlug: assessment.course.slug,
        courseTitle: assessment.course.title
      };

      current.count += 1;
      if (submission.status === "accepted") {
        current.accepted += 1;
      }
      byAssessment.set(key, current);
    }

    teacherOverview = {
      managedCourses: courses.length,
      totalStudents: studentMemberships,
      activeAssessments,
      submissions7d: total7d,
      acceptedRate7d,
      hottestAssessments: [...byAssessment.values()]
        .sort((left, right) => right.count - left.count)
        .slice(0, 6)
        .map((row) => ({
          assessmentSlug: row.assessmentSlug,
          assessmentTitle: row.assessmentTitle,
          courseSlug: row.courseSlug,
          courseTitle: row.courseTitle,
          submissionCount: row.count,
          acceptedRate: row.count > 0 ? Math.round((row.accepted / row.count) * 100) : 0
        }))
    };
  }

  const form = await superValidate(zod4(courseCreateSchema));

  return { courses, form, teacherOverview };
};

export const actions = {
  create: async (event) => {
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

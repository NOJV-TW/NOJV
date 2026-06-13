import { courseAssignmentFormSchema } from "@nojv/core";
import { courseDomain, problemDomain } from "@nojv/application";
import { fail, redirect, type RequestEvent } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { withRateLimit } from "$lib/server/shared/action-handlers";

const { createCourseAssignmentRecord } = courseDomain;
const { listEditableProblems } = problemDomain;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { course, isManager } = parent;
  if (!isManager) {
    redirect(302, `/courses/${course.id}/assignments`);
  }

  const form = await superValidate(
    {
      courseId: course.id,
      status: "draft",
    },
    zod4(courseAssignmentFormSchema),
  );

  const candidateProblems = await listEditableProblems(actor.userId);

  return { form, candidateProblems };
};

function submitAssignment(status: "draft" | "published") {
  return withRateLimit(async (event: RequestEvent) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId ?? "";

    const form = await superValidate(event, zod4(courseAssignmentFormSchema));
    if (!form.valid) return fail(400, { form });

    try {
      await createCourseAssignmentRecord(actor, courseId, {
        ...form.data,
        status,
      });
    } catch (err) {
      const classified = classifyError(err);
      return message(form, { kind: "error", text: classified.message }, { status: 400 });
    }

    redirect(303, `/courses/${courseId}/assignments`);
  });
}

export const actions = {
  saveDraft: submitAssignment("draft"),
  publish: submitAssignment("published"),
} satisfies Actions;

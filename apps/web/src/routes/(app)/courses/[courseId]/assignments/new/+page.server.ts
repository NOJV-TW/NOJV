import { courseAssignmentFormSchema } from "@nojv/core";
import { courseDomain, problemDomain } from "@nojv/application";
import { fail, redirect, type RequestEvent } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { classifyRequestError } from "$lib/server/shared/handle-action-error";
import { withAction } from "$lib/server/shared/action-handlers";

const { createCourseAssignmentRecord } = courseDomain;
const { listProblemPickerGroups } = problemDomain;

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
    { errors: false },
  );

  const candidateProblems = await listProblemPickerGroups(actor.userId);

  return { form, candidateProblems };
};

function submitAssignment(status: "draft" | "published") {
  return withAction(async (event: RequestEvent) => {
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
      const classified = classifyRequestError(err, event);
      return message(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }

    redirect(303, `/courses/${courseId}/assignments`);
  });
}

export const actions = {
  saveDraft: submitAssignment("draft"),
  publish: submitAssignment("published"),
} satisfies Actions;

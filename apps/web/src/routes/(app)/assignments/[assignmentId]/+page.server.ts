import { activityGradingUpdateSchema } from "@nojv/core";
import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import {
  assessmentSettingsFormSchema,
  type AssessmentSettingsFormData,
  type AssessmentUpdate,
} from "@nojv/core";

const updateProblemsPayloadSchema = activityGradingUpdateSchema;
import { assignmentDomain } from "@nojv/application";

import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import {
  serializePlagiarismFlags,
  serializePlagiarismReport,
} from "$lib/server/shared/plagiarism-view";
import { classifyRequestError } from "$lib/server/shared/handle-action-error";
import { withAction } from "$lib/server/shared/action-handlers";
import {
  toDateTimeLocal,
  toIsoOrUndefined,
  tryParseJsonField,
} from "$lib/server/shared/form-utils";
import { buildAssignmentResults } from "$lib/server/results/assignment";

const {
  deleteAssignmentDraft,
  getAssignmentPageView,
  publishAssignment,
  revertAssignmentToDraft,
  updateAssignmentRecord,
} = assignmentDomain;

function localToIso(local: string): string {
  return toIsoOrUndefined(local) ?? "";
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  event.depends("submission:data");
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { assignment, isManager } = parent;

  const view = await getAssignmentPageView(actor, {
    courseId: assignment.courseId,
    assignmentId: assignment.id,
    isManager,
  });
  if (view.mode === "student") return view;

  const { detail, matrix } = view;
  const settingsForm = await superValidate<AssessmentSettingsFormData>(
    {
      title: detail.title,
      summary: detail.summary,
      opensAt: toDateTimeLocal(detail.opensAt),
      dueAt: toDateTimeLocal(detail.dueAt ?? detail.closesAt),
      allowLateSubmissions:
        !!detail.dueAt &&
        !!detail.closesAt &&
        new Date(detail.closesAt) > new Date(detail.dueAt),
      closesAt: toDateTimeLocal(detail.closesAt),
      allowedLanguages: detail.allowedLanguages,
      maxAttemptsPerDay: detail.maxAttemptsPerDay ?? null,
      attemptResetMinuteOfDay: detail.attemptResetMinuteOfDay ?? 300,
      latePenalty: detail.latePenalty,
    },
    zod4(assessmentSettingsFormSchema),
  );

  return {
    ...view,
    results: buildAssignmentResults(matrix),
    settingsForm,
    plagiarism: serializePlagiarismReport(view.plagiarism),
    plagiarismFlags: serializePlagiarismFlags(view.plagiarismFlags),
  };
});

export const actions = {
  updateSettings: withAction(async (event) => {
    const actor = requireAuth(event);
    const assignmentId = event.params.assignmentId;

    const form = await superValidate(event, zod4(assessmentSettingsFormSchema));
    if (!form.valid) return fail(400, { form });

    const payload: AssessmentUpdate = {
      title: form.data.title,
      summary: form.data.summary,
      allowedLanguages: form.data.allowedLanguages,
      maxAttemptsPerDay: form.data.maxAttemptsPerDay ?? null,
      attemptResetMinuteOfDay: form.data.attemptResetMinuteOfDay ?? null,
      opensAt: localToIso(form.data.opensAt),
      closesAt: localToIso(
        form.data.allowLateSubmissions ? form.data.closesAt : form.data.dueAt,
      ),
      dueAt: form.data.dueAt ? localToIso(form.data.dueAt) : null,
      latePenalty: form.data.allowLateSubmissions ? form.data.latePenalty : null,
    };

    try {
      await updateAssignmentRecord(actor, assignmentId, payload);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }

    return message(form, { kind: "success", text: "ok" });
  }),

  updateProblems: withAction(async (event) => {
    const actor = requireAuth(event);
    const assignmentId = event.params.assignmentId;

    const formData = await event.request.formData();
    const parsed = tryParseJsonField(formData.get("payload"), updateProblemsPayloadSchema);
    if (!parsed.ok) return fail(400, { error: "invalid_payload" });
    const payload: AssessmentUpdate = parsed.data;

    await updateAssignmentRecord(actor, assignmentId, payload);

    return { success: true };
  }),

  publishAssignment: withAction(async (event) => {
    const actor = requireAuth(event);
    const assignmentId = event.params.assignmentId;

    const form = await superValidate(event, zod4(assessmentSettingsFormSchema));
    try {
      await publishAssignment(actor, assignmentId);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }

    return { success: true };
  }),

  revertToDraft: withAction(async (event) => {
    const actor = requireAuth(event);
    const assignmentId = event.params.assignmentId;

    const form = await superValidate(event, zod4(assessmentSettingsFormSchema));
    try {
      await revertAssignmentToDraft(actor, assignmentId);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }

    return { success: true };
  }),

  deleteAssignment: withAction(async (event) => {
    const actor = requireAuth(event);
    const assignmentId = event.params.assignmentId;

    const form = await superValidate(event, zod4(assessmentSettingsFormSchema));
    try {
      await deleteAssignmentDraft(actor, assignmentId);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }

    redirect(303, "/assignments");
  }),
} satisfies Actions;

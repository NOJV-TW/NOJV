import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import {
  assessmentSettingsFormSchema,
  type AssessmentSettingsFormData,
  type CourseAssessmentUpdate,
} from "@nojv/core";

// Body of the `updateProblems` action — posted by the client as a single
// JSON field so we can ship problem IDs plus the matching points map in
// one round trip. Validate here so downstream code can rely on the
// narrowed types instead of re-filtering.
const updateProblemsPayloadSchema = z.object({
  problemIds: z.array(z.string()).default([]),
  points: z.record(z.string(), z.unknown()).default({}),
});
import {
  assignmentDomain,
  clarificationDomain,
  courseDomain,
  plagiarismDomain,
  problemDomain,
  scoreOverrideDomain,
} from "@nojv/domain";

import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import {
  toDateTimeLocal,
  toIsoOrUndefined,
  tryParseJsonField,
} from "$lib/server/shared/form-utils";
import { buildAssignmentResults } from "$lib/server/results/assignment";

const { getAssignmentDetail, buildSubmissionsMatrix } = courseDomain;
const { findPlagiarismReport, listFlagsForContext } = plagiarismDomain;
const { listEditableProblems } = problemDomain;
const {
  deleteAssignmentDraft,
  publishAssignment,
  revertAssignmentToDraft,
  updateAssignmentRecord,
} = assignmentDomain;

function localToIso(local: string): string {
  return toIsoOrUndefined(local) ?? "";
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { assignment, isManager } = parent;
  const assignmentId = assignment.id;
  const courseId = assignment.courseId;

  if (isManager) {
    const [
      detail,
      matrix,
      plagiarism,
      plagiarismFlags,
      candidateProblems,
      canSetOverride,
      canAskClar,
      canAnswerClar,
      canViewClar,
    ] = await Promise.all([
      getAssignmentDetail(courseId, assignmentId, {
        viewerUserId: actor.userId,
        isManager: true,
      }),
      buildSubmissionsMatrix(courseId, assignmentId),
      findPlagiarismReport({ type: "courseAssessment", id: assignmentId }).catch(() => null),
      listFlagsForContext("assessment", assignmentId).catch(() => []),
      listEditableProblems(actor.userId),
      scoreOverrideDomain.canSetScoreOverride(actor, {
        type: "assignment",
        assignmentId,
      }),
      clarificationDomain.canAskClarification(actor, { type: "assignment", assignmentId }),
      clarificationDomain.canAnswerInContext(actor, { type: "assignment", assignmentId }),
      clarificationDomain.canViewClarifications(actor, { type: "assignment", assignmentId }),
    ]);

    const settingsForm = await superValidate<AssessmentSettingsFormData>(
      {
        title: detail.title,
        summary: detail.summary,
        opensAt: toDateTimeLocal(detail.opensAt),
        dueAt: toDateTimeLocal(detail.dueAt),
        closesAt: toDateTimeLocal(detail.closesAt),
        allowedLanguages: detail.allowedLanguages,
        maxAttemptsPerDay: detail.maxAttemptsPerDay ?? null,
        latePenalty: detail.latePenalty,
      },
      zod4(assessmentSettingsFormSchema),
    );

    return {
      mode: "teacher" as const,
      detail,
      matrix,
      results: buildAssignmentResults(matrix),
      settingsForm,
      candidateProblems,
      canSetOverride,
      clarification: {
        canAsk: canAskClar,
        canAnswer: canAnswerClar,
        canView: canViewClar,
      },
      plagiarism: plagiarism
        ? {
            status: plagiarism.status,
            reportUrl: plagiarism.reportUrl,
            triggeredAt: plagiarism.triggeredAt?.toISOString() ?? null,
            completedAt: plagiarism.completedAt?.toISOString() ?? null,
            // `results` is `Prisma.JsonValue | null` on the domain side; the
            // consumer (AssignmentPlagiarismReport) accepts `unknown` and
            // defensively parses `pairs` at render time. Widening to
            // `unknown` here keeps the prop contract loose on purpose.
            results: plagiarism.results as unknown,
          }
        : null,
      plagiarismFlags: plagiarismFlags.map((f) => ({
        id: f.id,
        pairKey: f.pairKey,
        flaggedBy: f.flaggedBy,
        flaggedAt: f.flaggedAt.toISOString(),
        note: f.note,
      })),
    };
  }

  const [detail, canAskClar, canAnswerClar, canViewClar] = await Promise.all([
    getAssignmentDetail(courseId, assignmentId, {
      viewerUserId: actor.userId,
      isManager: false,
    }),
    clarificationDomain.canAskClarification(actor, { type: "assignment", assignmentId }),
    clarificationDomain.canAnswerInContext(actor, { type: "assignment", assignmentId }),
    clarificationDomain.canViewClarifications(actor, { type: "assignment", assignmentId }),
  ]);
  return {
    mode: "student" as const,
    detail,
    clarification: {
      canAsk: canAskClar,
      canAnswer: canAnswerClar,
      canView: canViewClar,
    },
  };
});

export const actions = {
  updateSettings: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const assignmentId = event.params.assignmentId;

    const form = await superValidate(event, zod4(assessmentSettingsFormSchema));
    if (!form.valid) return fail(400, { form });

    const payload: CourseAssessmentUpdate = {
      title: form.data.title,
      summary: form.data.summary,
      allowedLanguages: form.data.allowedLanguages,
      maxAttemptsPerDay: form.data.maxAttemptsPerDay ?? null,
      opensAt: localToIso(form.data.opensAt),
      closesAt: localToIso(form.data.closesAt),
      dueAt: form.data.dueAt ? localToIso(form.data.dueAt) : null,
      adjustmentRules: form.data.latePenalty ? [form.data.latePenalty] : [],
    };

    try {
      await updateAssignmentRecord(actor, assignmentId, payload);
    } catch (err) {
      const classified = classifyError(err);
      return message(form, { kind: "error", text: classified.message }, { status: 400 });
    }

    return message(form, { kind: "success", text: "ok" });
  }),

  updateProblems: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const assignmentId = event.params.assignmentId;

    const formData = await event.request.formData();
    const parsed = tryParseJsonField(formData.get("payload"), updateProblemsPayloadSchema);
    if (!parsed.ok) return fail(400, { error: "invalid_payload" });
    const { problemIds, points: pointsMap } = parsed.data;

    const payload: CourseAssessmentUpdate = {
      problemIds,
      problemOrdinals: problemIds.map((id) => {
        const raw = pointsMap[id];
        const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 100;
        return { problemId: id, points: n };
      }),
    };

    try {
      await updateAssignmentRecord(actor, assignmentId, payload);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    return { success: true };
  }),

  publishAssignment: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const assignmentId = event.params.assignmentId;

    try {
      await publishAssignment(actor, assignmentId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    return { success: true };
  }),

  revertToDraft: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const assignmentId = event.params.assignmentId;

    try {
      await revertAssignmentToDraft(actor, assignmentId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    return { success: true };
  }),

  deleteAssignment: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const assignmentId = event.params.assignmentId;

    try {
      await deleteAssignmentDraft(actor, assignmentId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    redirect(303, "/assignments");
  }),
} satisfies Actions;

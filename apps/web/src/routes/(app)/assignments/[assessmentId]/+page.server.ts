import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import {
  assessmentSettingsFormSchema,
  type AssessmentSettingsFormData,
  type CourseAssessmentUpdate,
  type Language,
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
  assessmentDomain,
  clarificationDomain,
  courseDomain,
  plagiarismDomain,
  problemDomain,
  scoreOverrideDomain,
} from "@nojv/domain";

import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";

const { getAssignmentDetail, buildSubmissionsMatrix } = courseDomain;
const { findPlagiarismReport } = plagiarismDomain;
const { listEditableProblems } = problemDomain;
const {
  archiveAssessment,
  deleteAssessmentDraft,
  publishAssessment,
  revertAssessmentToDraft,
  unarchiveAssessment,
  updateAssessmentRecord,
} = assessmentDomain;

// Strip timezone off an ISO string so <input type="datetime-local"> can prefill.
function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// datetime-local strings are local-time, not ISO. Normalise to an ISO
// string before handing to the domain layer (which calls `new Date(...)`).
function localToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { assessment, isManager } = parent;
  const assessmentId = assessment.id;
  const courseId = assessment.courseId;

  if (isManager) {
    const [
      detail,
      matrix,
      plagiarism,
      candidateProblems,
      canSetOverride,
      canAskClar,
      canAnswerClar,
    ] = await Promise.all([
      getAssignmentDetail(courseId, assessmentId, {
        viewerUserId: actor.userId,
        isManager: true,
      }),
      buildSubmissionsMatrix(courseId, assessmentId),
      findPlagiarismReport({ type: "courseAssessment", id: assessmentId }).catch(() => null),
      listEditableProblems(actor.userId),
      scoreOverrideDomain.canSetScoreOverride(actor, "assignment", assessmentId),
      clarificationDomain.canAskClarification(actor, "assignment", assessmentId),
      clarificationDomain.canAnswerInContext(actor, "assignment", assessmentId),
    ]);

    const settingsForm = await superValidate<AssessmentSettingsFormData>(
      {
        title: detail.title,
        summary: detail.summary,
        opensAt: toDateTimeLocal(detail.opensAt),
        dueAt: toDateTimeLocal(detail.dueAt),
        closesAt: toDateTimeLocal(detail.closesAt),
        allowedLanguages: detail.allowedLanguages as Language[],
        maxAttemptsPerDay: detail.maxAttemptsPerDay ?? null,
      },
      zod4(assessmentSettingsFormSchema),
    );

    return {
      mode: "teacher" as const,
      detail,
      matrix,
      settingsForm,
      candidateProblems,
      canSetOverride,
      clarification: {
        canAsk: canAskClar,
        canAnswer: canAnswerClar,
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
    };
  }

  const [detail, canAskClar, canAnswerClar] = await Promise.all([
    getAssignmentDetail(courseId, assessmentId, {
      viewerUserId: actor.userId,
      isManager: false,
    }),
    clarificationDomain.canAskClarification(actor, "assignment", assessmentId),
    clarificationDomain.canAnswerInContext(actor, "assignment", assessmentId),
  ]);
  return {
    mode: "student" as const,
    detail,
    clarification: {
      canAsk: canAskClar,
      canAnswer: canAnswerClar,
    },
  };
});

export const actions = {
  updateSettings: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const assessmentId = event.params.assessmentId;

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
    };

    try {
      await updateAssessmentRecord(actor, assessmentId, payload);
    } catch (err) {
      const classified = classifyError(err);
      return message(form, { kind: "error", text: classified.message }, { status: 400 });
    }

    return message(form, { kind: "success", text: "ok" });
  },

  updateProblems: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const assessmentId = event.params.assessmentId;

    const formData = await event.request.formData();
    const payloadRaw = formData.get("payload");
    if (typeof payloadRaw !== "string") return fail(400, { error: "missing_payload" });

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(payloadRaw);
    } catch {
      return fail(400, { error: "invalid_payload" });
    }
    const parsed = updateProblemsPayloadSchema.safeParse(rawJson);
    if (!parsed.success) return fail(400, { error: "invalid_payload" });
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
      await updateAssessmentRecord(actor, assessmentId, payload);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    return { success: true };
  },

  publishAssessment: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const assessmentId = event.params.assessmentId;

    try {
      await publishAssessment(actor, assessmentId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    return { success: true };
  },

  revertToDraft: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const assessmentId = event.params.assessmentId;

    try {
      await revertAssessmentToDraft(actor, assessmentId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    return { success: true };
  },

  archiveAssessment: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const assessmentId = event.params.assessmentId;

    try {
      await archiveAssessment(actor, assessmentId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    return { success: true };
  },

  unarchiveAssessment: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const assessmentId = event.params.assessmentId;

    try {
      await unarchiveAssessment(actor, assessmentId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    return { success: true };
  },

  deleteAssessment: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const assessmentId = event.params.assessmentId;

    try {
      await deleteAssessmentDraft(actor, assessmentId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    redirect(303, "/assignments");
  },
} satisfies Actions;

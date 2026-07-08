import { error, fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import {
  examSettingsFormSchema,
  examUpdateSchema,
  parseIpWhitelistText,
  type ExamSettingsForm,
} from "@nojv/core";
import {
  auditDomain,
  clarificationDomain,
  examDomain,
  feedbackDomain,
  HttpError,
  listExamIpViolations,
  plagiarismDomain,
  problemDomain,
  proctoringDomain,
  scoreOverrideDomain,
  userDomain,
} from "@nojv/application";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { invalidateExamContextCaches } from "$lib/server/exam-context-cache";
import { getClientIp } from "$lib/server/shared/client-ip";
import { createLogger } from "$lib/server/logger";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import {
  serializePlagiarismFlags,
  serializePlagiarismReport,
} from "$lib/server/shared/plagiarism-view";
import { toDateTimeLocal, toIsoOrUndefined } from "$lib/server/shared/form-utils";
import { buildExamResults, type ExamResults } from "$lib/server/results/exam";
import type { FormMessage } from "$lib/types/form-message";

const {
  deleteExamDraft,
  getExamDetailPage,
  buildExamSubmissionsMatrix,
  publishExam,
  updateExamRecord,
} = examDomain;

const logger = createLogger("exam-page-action");

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const parent = await event.parent();
  const { exam: examHeader, isManager } = parent;
  const actor = requireAuth(event);
  const examId = event.params.examId;

  const [
    detail,
    canSetOverride,
    canAskClar,
    canAnswerClar,
    canViewClar,
    plagiarism,
    plagiarismFlags,
    ipViolations,
    activeSessions,
    feedback,
    auditEvents,
    viewerSession,
    candidateProblems,
  ] = await Promise.all([
    getExamDetailPage(examId, { viewerUserId: actor.userId, isManager }),
    isManager
      ? scoreOverrideDomain.canSetScoreOverride(actor, { type: "exam", examId })
      : Promise.resolve(false),
    clarificationDomain.canAskClarification(actor, { type: "exam", examId }),
    clarificationDomain.canAnswerInContext(actor, { type: "exam", examId }),
    clarificationDomain.canViewClarifications(actor, { type: "exam", examId }),
    isManager
      ? plagiarismDomain.findPlagiarismReport({ type: "exam", id: examId }).catch(() => null)
      : Promise.resolve(null),
    isManager
      ? plagiarismDomain.listFlagsForContext("exam", examId).catch(() => [])
      : Promise.resolve([]),
    isManager ? listExamIpViolations({ examId }).catch(() => []) : Promise.resolve([]),
    isManager ? examDomain.session.listActiveSessions(examId) : Promise.resolve([]),
    isManager
      ? Promise.resolve([])
      : feedbackDomain.getFeedbackForStudent(actor.userId, { type: "exam", examId }),
    isManager
      ? auditDomain.listAuditTimelineForContext({ type: "exam", examId })
      : Promise.resolve([] as auditDomain.AuditEvent[]),
    isManager
      ? Promise.resolve(null)
      : examDomain.session.getActiveSessionContext(actor.userId),
    isManager ? problemDomain.listEditableProblems(actor.userId) : Promise.resolve([]),
  ]);

  const auditActorNames = isManager
    ? await userDomain.listUserDisplayNames([
        ...new Set(auditEvents.flatMap((e) => (e.actorUserId ? [e.actorUserId] : []))),
      ])
    : {};

  const matrix =
    isManager && detail
      ? await buildExamSubmissionsMatrix({
          examId,
          courseId: detail.courseId,
          problems: detail.problems.map((p) => ({
            problemId: p.id,
            ordinal: p.ordinal,
            title: p.title,
            points: p.points,
          })),
        })
      : null;

  const results: ExamResults | null = matrix ? buildExamResults(matrix, actor.userId) : null;

  if (detail?.courseId !== examHeader.courseId) {
    error(404, "Exam not found");
  }

  const settingsForm =
    isManager && detail.manager
      ? await superValidate<ExamSettingsForm, FormMessage>(
          {
            title: detail.title,
            summary: detail.summary,
            startsAt: toDateTimeLocal(detail.startsAt),
            endsAt: toDateTimeLocal(detail.endsAt),
            // Exams are cumulative-only (累分制); any legacy mode collapses to point_sum.
            scoringMode: "point_sum",
            scoreboardMode: detail.scoreboardMode,
            allowedLanguages: detail.manager.allowedLanguages,
            submitCooldownSec: detail.manager.submitCooldownSec,
            pageLockEnabled: detail.pageLockEnabled,
            ipBindingEnabled: detail.ipBindingEnabled,
            ipViolationMode: detail.ipViolationMode,
            ipWhitelistEnabled: detail.ipWhitelistEnabled,
            ipWhitelistText: detail.manager.ipWhitelist.join("\n"),
          },
          zod4(examSettingsFormSchema),
        )
      : null;

  const hasActiveSession = viewerSession?.session.examId === examId;

  return {
    detail,
    hasActiveSession,
    matrix,
    isManager,
    activeSessions,
    activeSessionCount: activeSessions.length,
    canSetOverride,
    courseId: examHeader.courseId,
    settingsForm,
    results,
    plagiarism: serializePlagiarismReport(plagiarism),
    plagiarismFlags: serializePlagiarismFlags(plagiarismFlags),
    clarification: {
      canAsk: canAskClar,
      canAnswer: canAnswerClar,
      canView: canViewClar,
    },
    ipViolations: ipViolations.map((v) => ({
      id: v.id,
      userId: v.userId,
      handle: v.user.displayUsername ?? v.user.email,
      displayName: v.user.name,
      violationType: v.violationType,
      expectedIp: v.expectedIp,
      actualIp: v.actualIp,
      createdAt: v.createdAt.toISOString(),
    })),
    feedback: feedback.map((f) => ({ problemId: f.problemId, comment: f.comment })),
    auditEvents,
    auditActorNames,
    candidateProblems,
  };
});

export const actions = {
  startExam: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const examId = event.params.examId;
    const clientIp = getClientIp(event);
    try {
      await examDomain.session.startSessionWithGate(actor, { examId });
      try {
        await proctoringDomain.checkProctoringGate({
          entityKind: "exam",
          entityId: examId,
          userId: actor.userId,
          ip: clientIp,
        });
      } catch (err) {
        logger.warn("start-time IP pin failed — hooks gate still enforces", {
          userId: actor.userId,
          examId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(err.status, { error: err.message });
      }
      throw err;
    } finally {
      invalidateExamContextCaches(actor.userId);
    }
    return { success: true };
  }),

  releaseSession: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    try {
      await examDomain.session.endSession(actor, {
        examId: event.params.examId,
        reason: "submitted",
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(err.status, { error: err.message });
      }
      throw err;
    } finally {
      invalidateExamContextCaches(actor.userId);
    }
    return { success: true };
  }),

  releaseAllSessions: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    try {
      const { releasedUserIds } = await examDomain.session.releaseAllSessionsAsInstructor(
        actor,
        {
          examId: event.params.examId,
        },
      );
      for (const releasedUserId of releasedUserIds) {
        invalidateExamContextCaches(releasedUserId);
      }
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(err.status, { error: err.message });
      }
      throw err;
    }
    return { success: true };
  }),

  releaseStudentSession: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();
    const targetUserId = formData.get("targetUserId");
    if (typeof targetUserId !== "string" || targetUserId.length === 0) {
      return fail(400, { error: "Missing target user." });
    }
    try {
      await examDomain.session.releaseSessionAsInstructor(actor, {
        examId: event.params.examId,
        targetUserId,
      });
      invalidateExamContextCaches(targetUserId);
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(err.status, { error: err.message });
      }
      throw err;
    }
    return { success: true };
  }),

  resetStudentIpBinding: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();
    const targetUserId = formData.get("targetUserId");
    if (typeof targetUserId !== "string" || targetUserId.length === 0) {
      return fail(400, { error: "Missing target user." });
    }
    try {
      await examDomain.session.resetStudentIpBinding(actor, {
        examId: event.params.examId,
        targetUserId,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(err.status, { error: err.message });
      }
      throw err;
    }
    return { success: true };
  }),

  updateSettings: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ExamSettingsForm, FormMessage>(
      event,
      zod4(examSettingsFormSchema),
    );
    if (!form.valid) {
      return fail(400, { form });
    }

    const parsed = examUpdateSchema.safeParse({
      title: form.data.title,
      summary: form.data.summary ? form.data.summary : undefined,
      startsAt: toIsoOrUndefined(form.data.startsAt),
      endsAt: toIsoOrUndefined(form.data.endsAt),
      scoringMode: form.data.scoringMode,
      scoreboardMode: form.data.scoreboardMode,
      allowedLanguages: form.data.allowedLanguages,
      submitCooldownSec: form.data.submitCooldownSec,
      pageLockEnabled: form.data.pageLockEnabled,
      ipBindingEnabled: form.data.ipBindingEnabled,
      ipViolationMode: form.data.ipViolationMode,
      ipWhitelistEnabled: form.data.ipWhitelistEnabled,
      ipWhitelist: form.data.ipWhitelistEnabled
        ? parseIpWhitelistText(form.data.ipWhitelistText)
        : [],
    });
    if (!parsed.success) {
      return message<FormMessage>(
        form,
        { kind: "error", text: parsed.error.issues[0]?.message ?? "validation_failed" },
        { status: 400 },
      );
    }

    try {
      await updateExamRecord(actor, event.params.examId, parsed.data);
    } catch (err) {
      const classified = classifyError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: 400 },
      );
    }

    return message<FormMessage>(form, {
      kind: "success",
      text: "Saved.",
    });
  }),

  publishExam: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ExamSettingsForm, FormMessage>(
      event,
      zod4(examSettingsFormSchema),
    );
    try {
      await publishExam(actor, event.params.examId);
    } catch (err) {
      const classified = classifyError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: 400 },
      );
    }
    return { success: true };
  }),

  deleteExam: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ExamSettingsForm, FormMessage>(
      event,
      zod4(examSettingsFormSchema),
    );
    try {
      await deleteExamDraft(actor, event.params.examId);
    } catch (err) {
      const classified = classifyError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: 400 },
      );
    }
    redirect(303, "/exams");
  }),

  updateProblems: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();
    const seen = new Set<string>();
    const problemIds: string[] = [];
    for (const raw of formData.getAll("problemIds")) {
      const id = typeof raw === "string" ? raw.trim() : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      problemIds.push(id);
    }
    try {
      await updateExamRecord(actor, event.params.examId, { problemIds });
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, { error: err.message });
      throw err;
    }

    return { success: true };
  }),
} satisfies Actions;

import { error, fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import {
  examSettingsFormSchema,
  examUpdateSchema,
  type ExamSettingsForm,
  type ExamUpdate,
} from "@nojv/core";
import { clarificationDomain, examDomain, HttpError, scoreOverrideDomain } from "@nojv/domain";

import type { Actions, PageServerLoad, PageServerLoadEvent, RequestEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import type { FormMessage } from "$lib/types/form-message";

const {
  archiveExam,
  deleteExamDraft,
  getExamDetailPage,
  getExamSubmissionsMatrix,
  publishExam,
  setExamBoardFrozen,
  unarchiveExam,
  updateExamRecord,
} = examDomain;

function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseWhitelist(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toIsoOrUndefined(local: string): string | undefined {
  if (!local) return undefined;
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const parent = await event.parent();
  const { exam: examHeader, isManager } = parent;
  const actor = requireAuth(event);

  const [detail, matrix, canSetOverride, canAskClar, canAnswerClar] = await Promise.all([
    getExamDetailPage(event.params.examId, {
      viewerUserId: actor.userId,
      isManager,
    }),
    // Manager-only aggregation; null for students keeps the hydration payload slim.
    isManager ? getExamSubmissionsMatrix(event.params.examId) : Promise.resolve(null),
    isManager
      ? scoreOverrideDomain.canSetScoreOverride(actor, "exam", event.params.examId)
      : Promise.resolve(false),
    clarificationDomain.canAskClarification(actor, "exam", event.params.examId),
    clarificationDomain.canAnswerInContext(actor, "exam", event.params.examId),
  ]);

  // The layout gate already accepted this exam for the viewer; treat a
  // null payload here (draft hidden from students, archived, etc.) as a
  // defense-in-depth 404 rather than a crash.
  if (detail?.courseId !== examHeader.courseId) {
    error(404, "Exam not found");
  }

  // Managers also get a pre-seeded superform for the Settings tab so
  // the initial render matches what the server believes the exam looks
  // like — avoids client-side duplication of seeding logic.
  const settingsForm =
    isManager && detail.manager
      ? await superValidate<ExamSettingsForm, FormMessage>(
          {
            title: detail.title,
            summary: detail.summary,
            startsAt: toDateTimeLocal(detail.startsAt),
            endsAt: toDateTimeLocal(detail.endsAt),
            scoringMode: detail.scoringMode,
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

  return {
    detail,
    matrix,
    isManager,
    canSetOverride,
    courseId: examHeader.courseId,
    settingsForm,
    clarification: {
      canAsk: canAskClar,
      canAnswer: canAnswerClar,
    },
  };
});

// ─── Action helpers ─────────────────────────────────────────────────

async function runFreezeAction(event: RequestEvent, frozen: boolean) {
  const actor = requireAuth(event);
  try {
    await setExamBoardFrozen(actor, event.params.examId, frozen);
  } catch (err) {
    if (err instanceof HttpError) {
      return fail(err.status, { error: err.message });
    }
    throw err;
  }
  return { success: true };
}

export const actions = {
  startExam: async (event) => {
    const actor = requireAuth(event);
    try {
      await examDomain.session.startSessionWithGate(actor, {
        examId: event.params.examId,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(err.status, { error: err.message });
      }
      throw err;
    }
    return { success: true };
  },

  updateSettings: async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ExamSettingsForm, FormMessage>(
      event,
      zod4(examSettingsFormSchema),
    );
    if (!form.valid) {
      return fail(400, { form });
    }

    const payload: ExamUpdate = examUpdateSchema.parse({
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
        ? parseWhitelist(form.data.ipWhitelistText)
        : [],
    });

    try {
      await updateExamRecord(actor, event.params.examId, payload);
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
  },

  publishExam: async (event) => {
    const actor = requireAuth(event);
    try {
      await publishExam(actor, event.params.examId);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, { error: err.message });
      throw err;
    }
    return { success: true };
  },

  deleteExam: async (event) => {
    const actor = requireAuth(event);
    try {
      await deleteExamDraft(actor, event.params.examId);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, { error: err.message });
      throw err;
    }
    redirect(303, "/exams");
  },

  archiveExam: async (event) => {
    const actor = requireAuth(event);
    try {
      await archiveExam(actor, event.params.examId);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, { error: err.message });
      throw err;
    }
    return { success: true };
  },

  unarchiveExam: async (event) => {
    const actor = requireAuth(event);
    try {
      await unarchiveExam(actor, event.params.examId);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, { error: err.message });
      throw err;
    }
    return { success: true };
  },

  freezeBoard: (event) => runFreezeAction(event, true),
  unfreezeBoard: (event) => runFreezeAction(event, false),

  updateProblems: async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();
    // `problemIds` is sent once per row (repeated) in the canonical
    // order the user selected; order is preserved in-order by
    // `getAll()`. Deduplicate while keeping first occurrence so
    // double-submits from the Attach form can't double-list.
    const seen = new Set<string>();
    const problemIds: string[] = [];
    for (const raw of formData.getAll("problemIds")) {
      const id = typeof raw === "string" ? raw.trim() : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      problemIds.push(id);
    }
    // Optional per-problem points override via `points_<id>` inputs.
    const pointOverrides: Record<string, number> = {};
    for (const [key, val] of formData.entries()) {
      if (!key.startsWith("points_")) continue;
      const id = key.slice("points_".length);
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) pointOverrides[id] = Math.floor(n);
    }

    try {
      await updateExamRecord(actor, event.params.examId, { problemIds }, { pointOverrides });
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, { error: err.message });
      throw err;
    }

    return { success: true };
  },
} satisfies Actions;

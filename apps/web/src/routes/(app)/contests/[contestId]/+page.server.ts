import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import {
  contestSettingsFormSchema,
  contestUpdateSchema,
  type ContestSettingsForm,
} from "@nojv/core";
import { contestDomain } from "@nojv/application";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth, getActorContext, hasActorUsername } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { classifyRequestError } from "$lib/server/shared/handle-action-error";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import {
  serializePlagiarismFlags,
  serializePlagiarismReport,
} from "$lib/server/shared/plagiarism-view";
import { toDateTimeLocal, toIsoOrUndefined } from "$lib/server/shared/form-utils";
import type { FormMessage } from "$lib/types/form-message";

const { getContestPageView, updateContestRecord, publishContest, deleteContestDraft } =
  contestDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  event.depends("submission:data");
  const { params, locals } = event;
  const actor = getActorContext(event);
  const completedActor = actor && hasActorUsername(actor) ? actor : null;

  const view = await getContestPageView({
    contestId: params.contestId,
    viewer: { userId: locals.user?.id ?? null, platformRole: actor?.platformRole ?? null },
    actor: completedActor,
    now: new Date(),
  });
  const { contest } = view;

  const settingsForm =
    contest.isManager && completedActor
      ? await superValidate<ContestSettingsForm, FormMessage>(
          {
            title: contest.title,
            summary: contest.summary,
            startsAt: toDateTimeLocal(contest.startsAt),
            endsAt: toDateTimeLocal(contest.endsAt),
            frozenAt: toDateTimeLocal(contest.frozenAt),
            problems: (contest.problems ?? []).map((p) => ({
              problemId: p.id,
              points: p.points,
            })),
            scoringMode: contest.scoringMode,
            scoreboardMode: contest.scoreboardMode,
            allowedLanguages: contest.allowedLanguages,
            submitCooldownSec: contest.submitCooldownSec,
            penaltyMinutesPerWrong: contest.penaltyMinutesPerWrong,
          },
          zod4(contestSettingsFormSchema),
        )
      : null;

  return {
    ...view,
    settingsForm,
    plagiarism: serializePlagiarismReport(view.plagiarism),
    plagiarismFlags: serializePlagiarismFlags(view.plagiarismFlags),
  };
});

export const actions: Actions = {
  updateSettings: withAction(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ContestSettingsForm, FormMessage>(
      event,
      zod4(contestSettingsFormSchema),
    );
    if (!form.valid) {
      return fail(400, { form });
    }

    const parsed = contestUpdateSchema.safeParse({
      title: form.data.title,
      summary: form.data.summary ? form.data.summary : undefined,
      startsAt: toIsoOrUndefined(form.data.startsAt),
      endsAt: toIsoOrUndefined(form.data.endsAt),
      frozenAt: toIsoOrUndefined(form.data.frozenAt),
      problems: form.data.problems,
      scoringMode: form.data.scoringMode,
      scoreboardMode: form.data.scoreboardMode,
      allowedLanguages: form.data.allowedLanguages,
      submitCooldownSec: form.data.submitCooldownSec,
      penaltyMinutesPerWrong: form.data.penaltyMinutesPerWrong,
    });
    if (!parsed.success) {
      return message<FormMessage>(
        form,
        { kind: "error", text: parsed.error.issues[0]?.message ?? "validation_failed" },
        { status: 400 },
      );
    }

    try {
      await updateContestRecord(actor, event.params.contestId, parsed.data);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }

    return message<FormMessage>(form, { kind: "success", text: "Saved." });
  }),

  joinContest: withAction(async (event) => {
    const actor = requireAuth(event);
    await contestDomain.joinContest(actor, event.params.contestId);
    return { success: true };
  }),

  publishContest: withAction(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ContestSettingsForm, FormMessage>(
      event,
      zod4(contestSettingsFormSchema),
    );
    try {
      await publishContest(actor, event.params.contestId);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }
    return { success: true };
  }),

  deleteContest: withAction(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ContestSettingsForm, FormMessage>(
      event,
      zod4(contestSettingsFormSchema),
    );
    try {
      await deleteContestDraft(actor, event.params.contestId);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }
    redirect(303, "/contests");
  }),
};

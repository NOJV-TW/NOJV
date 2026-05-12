import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import {
  contestSettingsFormSchema,
  contestUpdateSchema,
  type ContestSettingsForm,
  type ContestUpdate,
} from "@nojv/core";
import {
  clarificationDomain,
  contestDomain,
  plagiarismDomain,
  scoreOverrideDomain,
} from "@nojv/domain";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth, getActorContext, hasActorUsername } from "$lib/server/auth";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { toDateTimeLocal, toIsoOrUndefined } from "$lib/server/shared/form-utils";
import { buildContestResults, type ContestResults } from "$lib/server/results/contest";
import type { FormMessage } from "$lib/types/form-message";

const {
  getContestDetail,
  getScoreboard,
  listContestParticipantsWithUser,
  buildContestSubmissionsMatrix,
  updateContestRecord,
  publishContest,
  archiveContest,
  unarchiveContest,
  deleteContestDraft,
} = contestDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const { params, locals } = event;
  const now = new Date();
  const user = locals.user;

  const contest = await getContestDetail(params.contestId, {
    userId: user?.id ?? null,
    platformRole: locals.sessionUser?.platformRole ?? null,
    now,
  });

  // Mini-leaderboard for the detail sidebar. Skip for not-yet-started
  // contests (no entries exist) and tolerate hidden boards by reading the
  // user-facing view (entries auto-blank when `scoreboardMode === "hidden"`).
  const showLeaderboard = now >= new Date(contest.startsAt);
  const isPrivileged =
    locals.sessionUser?.platformRole === "admin" ||
    locals.sessionUser?.platformRole === "teacher";
  const topEntries = showLeaderboard
    ? await getScoreboard(contest.id, { isPrivileged }).then((sb) =>
        sb.entries.slice(0, 5).map((e) => ({
          rank: e.rank,
          username: e.username,
          displayName: e.displayName,
          totalScore: e.totalScore,
          isMe: user?.id === e.userId,
        })),
      )
    : [];

  // Staff-only data for the score-override drawer + class results tab.
  // Students don't see the button so we skip the extra fetches entirely.
  let canSetOverride = false;
  let overrideStudents: { id: string; username: string; name: string }[] = [];
  let results: ContestResults | null = null;
  let matrix: contestDomain.ContestSubmissionsMatrix | null = null;
  let settingsForm: Awaited<
    ReturnType<typeof superValidate<ContestSettingsForm, FormMessage>>
  > | null = null;

  let plagiarism: Awaited<ReturnType<typeof plagiarismDomain.findPlagiarismReport>> = null;
  let plagiarismFlags: Awaited<ReturnType<typeof plagiarismDomain.listFlagsForContext>> = [];

  if (contest.isManager) {
    const actor = getActorContext(event);
    if (actor && hasActorUsername(actor)) {
      const [allowed, participants, plagReport, plagFlags] = await Promise.all([
        scoreOverrideDomain.canSetScoreOverride(actor, {
          type: "contest",
          contestId: contest.id,
        }),
        listContestParticipantsWithUser(contest.id),
        plagiarismDomain
          .findPlagiarismReport({ type: "contest", id: contest.id })
          .catch(() => null),
        plagiarismDomain.listFlagsForContext("contest", contest.id).catch(() => []),
      ]);
      matrix = await buildContestSubmissionsMatrix({
        contestId: contest.id,
        problems: contest.problems ?? [],
        participants,
      });
      plagiarism = plagReport;
      plagiarismFlags = plagFlags;
      canSetOverride = allowed;
      const scores: number[] = [];
      overrideStudents = participants.map((p) => {
        scores.push(p.score);
        return {
          id: p.user.id,
          username: p.user.username ?? "",
          name: p.user.name,
        };
      });

      // Aggregate participant scores into the shared distribution bucket
      // shape. For point_sum contests `score` is the absolute total; for
      // problem_count contests it's the solve count and the helper falls
      // back to absolute-vs-max bucketing.
      const totalPoints = (contest.problems ?? []).reduce((sum, p) => sum + p.points, 0);
      results = buildContestResults(
        scores,
        contest.scoringMode === "point_sum" ? totalPoints : 0,
      );

      settingsForm = await superValidate<ContestSettingsForm, FormMessage>(
        {
          title: contest.title,
          summary: contest.summary,
          startsAt: toDateTimeLocal(contest.startsAt),
          endsAt: toDateTimeLocal(contest.endsAt),
          scoringMode: contest.scoringMode,
          scoreboardMode: contest.scoreboardMode,
          allowedLanguages: contest.allowedLanguages,
          submitCooldownSec: contest.submitCooldownSec,
        },
        zod4(contestSettingsFormSchema),
      );
    }
  }

  const actor = getActorContext(event);
  let canAskClar = false;
  let canAnswerClar = false;
  let canViewClar = false;
  if (actor && hasActorUsername(actor)) {
    [canAskClar, canAnswerClar, canViewClar] = await Promise.all([
      clarificationDomain.canAskClarification(actor, {
        type: "contest",
        contestId: contest.id,
      }),
      clarificationDomain.canAnswerInContext(actor, { type: "contest", contestId: contest.id }),
      clarificationDomain.canViewClarifications(actor, {
        type: "contest",
        contestId: contest.id,
      }),
    ]);
  }

  return {
    contest,
    canSetOverride,
    overrideStudents,
    topEntries,
    results,
    matrix,
    settingsForm,
    plagiarism: plagiarism
      ? {
          status: plagiarism.status,
          reportUrl: plagiarism.reportUrl,
          triggeredAt: plagiarism.triggeredAt?.toISOString() ?? null,
          completedAt: plagiarism.completedAt?.toISOString() ?? null,
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
    clarification: {
      canAsk: canAskClar,
      canAnswer: canAnswerClar,
      canView: canViewClar,
    },
  };
});

export const actions: Actions = {
  updateSettings: async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ContestSettingsForm, FormMessage>(
      event,
      zod4(contestSettingsFormSchema),
    );
    if (!form.valid) {
      return fail(400, { form });
    }

    const payload: ContestUpdate = contestUpdateSchema.parse({
      title: form.data.title,
      summary: form.data.summary ? form.data.summary : undefined,
      startsAt: toIsoOrUndefined(form.data.startsAt),
      endsAt: toIsoOrUndefined(form.data.endsAt),
      scoringMode: form.data.scoringMode,
      scoreboardMode: form.data.scoreboardMode,
      allowedLanguages: form.data.allowedLanguages,
      submitCooldownSec: form.data.submitCooldownSec,
    });

    try {
      await updateContestRecord(actor, event.params.contestId, payload);
    } catch (err) {
      const classified = classifyError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: 400 },
      );
    }

    return message<FormMessage>(form, { kind: "success", text: "Saved." });
  },

  publishContest: async (event) => {
    const actor = requireAuth(event);
    try {
      await publishContest(actor, event.params.contestId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
    return { success: true };
  },

  archiveContest: async (event) => {
    const actor = requireAuth(event);
    try {
      await archiveContest(actor, event.params.contestId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
    return { success: true };
  },

  unarchiveContest: async (event) => {
    const actor = requireAuth(event);
    try {
      await unarchiveContest(actor, event.params.contestId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
    return { success: true };
  },

  deleteContest: async (event) => {
    const actor = requireAuth(event);
    try {
      await deleteContestDraft(actor, event.params.contestId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
    redirect(303, "/contests");
  },
};

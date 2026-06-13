import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import {
  contestSettingsFormSchema,
  contestUpdateSchema,
  type ContestSettingsForm,
} from "@nojv/core";
import {
  auditDomain,
  clarificationDomain,
  contestDomain,
  plagiarismDomain,
  scoreOverrideDomain,
  userDomain,
} from "@nojv/application";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth, getActorContext, hasActorUsername } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import {
  serializePlagiarismFlags,
  serializePlagiarismReport,
} from "$lib/server/shared/plagiarism-view";
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

  const showLeaderboard = now >= new Date(contest.startsAt);
  const canSeeLive = await contestDomain.canViewLiveContestScoreboard(
    contest.id,
    user ? { userId: user.id, platformRole: locals.sessionUser?.platformRole ?? null } : null,
  );
  const topEntries = showLeaderboard
    ? await getScoreboard(contest.id, { canSeeLive }).then((sb) =>
        sb.entries.slice(0, 5).map((e) => ({
          rank: e.rank,
          username: e.username,
          displayName: e.displayName,
          totalScore: e.totalScore,
          isMe: user?.id === e.userId,
        })),
      )
    : [];

  let canSetOverride = false;
  let overrideStudents: { id: string; username: string; name: string }[] = [];
  let results: ContestResults | null = null;
  let matrix: contestDomain.ContestSubmissionsMatrix | null = null;
  let settingsForm: Awaited<
    ReturnType<typeof superValidate<ContestSettingsForm, FormMessage>>
  > | null = null;

  let plagiarism: Awaited<ReturnType<typeof plagiarismDomain.findPlagiarismReport>> = null;
  let plagiarismFlags: Awaited<ReturnType<typeof plagiarismDomain.listFlagsForContext>> = [];

  let auditEvents: auditDomain.AuditEvent[] = [];
  let auditActorNames: Record<string, string> = {};

  if (contest.isManager) {
    const actor = getActorContext(event);
    if (actor && hasActorUsername(actor)) {
      const [allowed, participants, plagReport, plagFlags, audit] = await Promise.all([
        scoreOverrideDomain.canSetScoreOverride(actor, {
          type: "contest",
          contestId: contest.id,
        }),
        listContestParticipantsWithUser(contest.id),
        plagiarismDomain
          .findPlagiarismReport({ type: "contest", id: contest.id })
          .catch(() => null),
        plagiarismDomain.listFlagsForContext("contest", contest.id).catch(() => []),
        auditDomain.listAuditTimelineForContext({ type: "contest", contestId: contest.id }),
      ]);
      auditEvents = audit;
      auditActorNames = await userDomain.listUserDisplayNames([
        ...new Set(audit.flatMap((e) => (e.actorUserId ? [e.actorUserId] : []))),
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
          frozenAt: toDateTimeLocal(contest.frozenAt),
          scoringMode: contest.scoringMode,
          scoreboardMode: contest.scoreboardMode,
          allowedLanguages: contest.allowedLanguages,
          submitCooldownSec: contest.submitCooldownSec,
          penaltyMinutesPerWrong: contest.penaltyMinutesPerWrong,
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
    plagiarism: serializePlagiarismReport(plagiarism),
    plagiarismFlags: serializePlagiarismFlags(plagiarismFlags),
    clarification: {
      canAsk: canAskClar,
      canAnswer: canAnswerClar,
      canView: canViewClar,
    },
    auditEvents,
    auditActorNames,
  };
});

export const actions: Actions = {
  updateSettings: withRateLimit(async (event) => {
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
      const classified = classifyError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: 400 },
      );
    }

    return message<FormMessage>(form, { kind: "success", text: "Saved." });
  }),

  publishContest: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    try {
      await publishContest(actor, event.params.contestId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
    return { success: true };
  }),

  deleteContest: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    try {
      await deleteContestDraft(actor, event.params.contestId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
    redirect(303, "/contests");
  }),
};

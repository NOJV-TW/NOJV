import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { clarificationDomain, contestDomain, scoreOverrideDomain } from "@nojv/domain";

import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { buildContestResults, type ContestResultsData } from "$lib/server/contest-results";

const { getContestDetail, getScoreboard, listContestParticipantsWithUser } = contestDomain;

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
  let results: ContestResultsData | null = null;

  if (contest.isManager) {
    const actor = getActorContext(event);
    if (actor && hasActorUsername(actor)) {
      const [allowed, participants] = await Promise.all([
        scoreOverrideDomain.canSetScoreOverride(actor, "contest", contest.id),
        listContestParticipantsWithUser(contest.id),
      ]);
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
    }
  }

  const actor = getActorContext(event);
  let canAskClar = false;
  let canAnswerClar = false;
  let canViewClar = false;
  if (actor && hasActorUsername(actor)) {
    [canAskClar, canAnswerClar, canViewClar] = await Promise.all([
      clarificationDomain.canAskClarification(actor, "contest", contest.id),
      clarificationDomain.canAnswerInContext(actor, "contest", contest.id),
      clarificationDomain.canViewClarifications(actor, "contest", contest.id),
    ]);
  }

  return {
    contest,
    canSetOverride,
    overrideStudents,
    topEntries,
    results,
    clarification: {
      canAsk: canAskClar,
      canAnswer: canAnswerClar,
      canView: canViewClar,
    },
  };
});

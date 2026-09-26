import type { PlatformRole } from "@nojv/core";

import { getAuditTimelineView, type AuditEvent } from "../audit/queries";
import {
  canAnswerInContext,
  canAskClarification,
  canViewClarifications,
} from "../clarification/permissions";
import { listFlagsForContext } from "../plagiarism/flags";
import { findPlagiarismReport } from "../plagiarism/queries";
import { listProblemPickerGroups, type ProblemPickerGroups } from "../problem/picker";
import type { ActorContext } from "../shared/actor-context";
import { buildScoreStats, type ScoreStats } from "../shared/score-stats";
import { listRecentContextSubmissions } from "../submission/history";
import { canViewLiveContestScoreboard } from "./permissions";
import {
  findViewerContestParticipation,
  getContestDetail,
  listContestParticipantsWithUser,
} from "./queries";
import { getScoreboard } from "./scoring";
import {
  buildContestSubmissionsMatrix,
  type ContestSubmissionsMatrix,
} from "./submissions-matrix";

export async function getContestPageView(options: {
  contestId: string;
  viewer: { userId: string | null; platformRole: PlatformRole | null };
  actor: ActorContext | null;
  now: Date;
}) {
  const { viewer, actor, now } = options;

  const contest = await getContestDetail(options.contestId, { ...viewer, now });

  const showLeaderboard =
    contest.visibility === "published" && now >= new Date(contest.startsAt);
  const canSeeLive = await canViewLiveContestScoreboard(
    contest.id,
    viewer.userId ? { userId: viewer.userId, platformRole: viewer.platformRole } : null,
  );
  const topEntries = showLeaderboard
    ? await getScoreboard(contest.id, { canSeeLive }).then((sb) =>
        sb.entries.slice(0, 5).map((e) => ({
          rank: e.rank,
          username: e.username,
          displayName: e.displayName,
          totalScore: e.totalScore,
          isMe: viewer.userId === e.userId,
        })),
      )
    : [];

  let results: ScoreStats | null = null;
  let recentSubmissions: Awaited<ReturnType<typeof listRecentContextSubmissions>> = [];
  let matrix: ContestSubmissionsMatrix | null = null;
  let candidateProblems: ProblemPickerGroups = { personalProblems: [], publicProblems: [] };
  let plagiarism: Awaited<ReturnType<typeof findPlagiarismReport>> = null;
  let plagiarismFlags: Awaited<ReturnType<typeof listFlagsForContext>> = [];
  let auditEvents: AuditEvent[] = [];
  let auditActorNames: Record<string, string> = {};

  if (contest.isManager && actor) {
    const [participants, plagReport, plagFlags, audit, availableProblems, recent] =
      await Promise.all([
        listContestParticipantsWithUser(contest.id),
        findPlagiarismReport({ type: "contest", id: contest.id }),
        listFlagsForContext("contest", contest.id),
        getAuditTimelineView({ type: "contest", contestId: contest.id }),
        listProblemPickerGroups(actor.userId),
        listRecentContextSubmissions({ actor, context: { type: "contest", id: contest.id } }),
      ]);
    candidateProblems = availableProblems;
    recentSubmissions = recent;
    ({ auditEvents, auditActorNames } = audit);
    matrix = await buildContestSubmissionsMatrix({
      contestId: contest.id,
      problems: contest.problems ?? [],
      participants,
    });
    plagiarism = plagReport;
    plagiarismFlags = plagFlags;
    const scores = participants.map((p) => Number(p.score));
    const totalPoints = (contest.problems ?? []).reduce((sum, p) => sum + p.points, 0);
    const maxScore =
      contest.scoringMode === "problem_count" ? (contest.problems ?? []).length : totalPoints;
    results = buildScoreStats(scores, scores.length, maxScore);
  }

  let canAsk = false;
  let canAnswer = false;
  let canView = false;
  if (actor) {
    [canAsk, canAnswer, canView] = await Promise.all([
      canAskClarification(actor, { type: "contest", contestId: contest.id }),
      canAnswerInContext(actor, { type: "contest", contestId: contest.id }),
      canViewClarifications(actor, { type: "contest", contestId: contest.id }),
    ]);
  }

  const hasJoined =
    actor && !contest.isManager
      ? (await findViewerContestParticipation(actor.userId, contest.id)) !== null
      : false;

  return {
    contest: { ...contest, inviteCode: contest.isManager ? contest.inviteCode : null },
    hasJoined,
    topEntries,
    results,
    matrix,
    recentSubmissions,
    candidateProblems,
    plagiarism,
    plagiarismFlags,
    clarification: { canAsk, canAnswer, canView },
    auditEvents,
    auditActorNames,
  };
}

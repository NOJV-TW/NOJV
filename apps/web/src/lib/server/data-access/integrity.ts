import { prisma, type TransactionClient } from "@nojv/db";
import { evaluateIntegritySignals, type CheatingSignal } from "@nojv/domain";

import {
  buildCheatingCaseSummary,
  mapIntegrityAssessmentToCaseStatus
} from "../persistence-mappers";
import {
  ensureContestParticipation,
  ensureUser,
  requireContest,
  requireCourseAssessment
} from "./shared";

async function upsertCheatingCase(
  tx: TransactionClient,
  signals: CheatingSignal[]
) {
  const firstSignal = signals[0];

  if (!firstSignal) {
    throw new Error("At least one cheating signal is required.");
  }

  const assessment = evaluateIntegritySignals(signals);
  const contest = firstSignal.contestSlug
    ? await requireContest(tx, firstSignal.contestSlug)
    : null;
  const courseContext = firstSignal.assessment
    ? await requireCourseAssessment(
        tx,
        firstSignal.assessment.courseSlug,
        firstSignal.assessment.assessmentSlug
      )
    : null;
  const existingCase = await tx.cheatingCase.findFirst({
    orderBy: {
      openedAt: "desc"
    },
    where: {
      courseAssessmentId: courseContext?.assessment.id ?? null,
      courseId: courseContext?.course.id ?? null,
      contestId: contest?.id ?? null,
      status: {
        in: ["open", "under_review"]
      },
      userId: firstSignal.userId
    }
  });

  const data = {
    courseAssessmentId: courseContext?.assessment.id ?? null,
    courseId: courseContext?.course.id ?? null,
    contestId: contest?.id ?? null,
    score: assessment.score,
    status: mapIntegrityAssessmentToCaseStatus(assessment),
    summary: buildCheatingCaseSummary(assessment, signals.length),
    userId: firstSignal.userId
  } as const;

  if (existingCase) {
    return tx.cheatingCase.update({
      data,
      where: {
        id: existingCase.id
      }
    });
  }

  return tx.cheatingCase.create({
    data
  });
}

export async function persistCheatingSignals(signals: CheatingSignal[]) {
  if (signals.length === 0) {
    return [];
  }

  return prisma.$transaction(async (tx) => {
    const groupedSignals = new Map<string, CheatingSignal[]>();

    for (const signal of signals) {
      const key = `${signal.userId}::${signal.contestSlug ?? "practice"}::${signal.assessment?.courseSlug ?? "course"}::${signal.assessment?.assessmentSlug ?? "none"}`;
      const existingGroup = groupedSignals.get(key);
      if (existingGroup) {
        existingGroup.push(signal);
      } else {
        groupedSignals.set(key, [signal]);
      }
    }

    const persisted: Awaited<ReturnType<typeof tx.cheatingSignal.create>>[] = [];

    for (const group of groupedSignals.values()) {
      const firstSignal = group[0];

      if (!firstSignal) {
        continue;
      }

      const user = await ensureUser(tx, firstSignal.userId);
      const contestParticipation = firstSignal.contestSlug
        ? await ensureContestParticipation(tx, user.id, firstSignal.contestSlug)
        : null;
      const cheatingCase = await upsertCheatingCase(tx, group);

      const sessionIds = [...new Set(group.map((signal) => signal.sessionId).filter(Boolean))] as string[];
      const sessions =
        sessionIds.length > 0
          ? await tx.workspaceSession.findMany({
              where: {
                id: {
                  in: sessionIds
                }
              }
            })
          : [];
      const sessionMap = new Map(sessions.map((session) => [session.id, session]));

      const sessionIdsForRuns = sessions.map((session) => session.id);
      const runs =
        sessionIdsForRuns.length > 0
          ? await tx.workspaceRun.findMany({
              distinct: ["workspaceSessionId"],
              orderBy: {
                createdAt: "desc"
              },
              where: {
                workspaceSessionId: {
                  in: sessionIdsForRuns
                }
              }
            })
          : [];
      const runBySessionId = new Map(runs.map((run) => [run.workspaceSessionId, run]));

      const assessmentKeys = [
        ...new Set(
          group.flatMap((signal) =>
            signal.assessment
              ? [`${signal.assessment.courseSlug}::${signal.assessment.assessmentSlug}`]
              : []
          )
        )
      ];
      const assessmentContextMap = new Map<
        string,
        Awaited<ReturnType<typeof requireCourseAssessment>>
      >();

      for (const key of assessmentKeys) {
        const [courseSlug, assessmentSlug] = key.split("::");
        if (!courseSlug || !assessmentSlug) {
          continue;
        }

        assessmentContextMap.set(
          key,
          await requireCourseAssessment(tx, courseSlug, assessmentSlug)
        );
      }

      for (const signal of group) {
        const workspaceSession = signal.sessionId ? sessionMap.get(signal.sessionId) ?? null : null;
        const workspaceRun = workspaceSession
          ? runBySessionId.get(workspaceSession.id) ?? null
          : null;
        const assessmentContext = signal.assessment
          ? assessmentContextMap.get(
              `${signal.assessment.courseSlug}::${signal.assessment.assessmentSlug}`
            ) ?? null
          : null;
        const record = await tx.cheatingSignal.create({
          data: {
            cheatingCaseId: cheatingCase.id,
            confidence: signal.confidence,
            contestParticipationId: contestParticipation?.id ?? null,
            courseAssessmentId: assessmentContext?.assessment.id ?? null,
            courseId: assessmentContext?.course.id ?? null,
            occurredAt: new Date(signal.capturedAt),
            payload: {
              assessment: signal.assessment ?? null,
              ...signal.payload,
              source: signal.source
            },
            type: signal.type,
            userId: signal.userId,
            workspaceRunId: workspaceRun?.id ?? null,
            workspaceSessionId: workspaceSession?.id ?? null
          }
        });

        persisted.push(record);
      }
    }

    return persisted;
  });
}

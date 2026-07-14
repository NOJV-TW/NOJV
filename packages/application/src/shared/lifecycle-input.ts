import type {
  AssignmentDueSoonInput,
  ContestLifecycleInput,
  ExamAutoCloseInput,
} from "@nojv/core";

interface ScheduleIdentity {
  scheduleRevision: number;
  timerFingerprint: string;
}

export function assignmentDueSoonInput(
  assignment: ScheduleIdentity & {
    id: string;
    opensAt: Date;
    closesAt: Date;
  },
): AssignmentDueSoonInput {
  return {
    assignmentId: assignment.id,
    opensAt: assignment.opensAt.toISOString(),
    closesAt: assignment.closesAt.toISOString(),
    scheduleRevision: assignment.scheduleRevision,
    timerFingerprint: assignment.timerFingerprint,
  };
}

export function examAutoCloseInput(
  exam: ScheduleIdentity & { id: string; startsAt: Date; endsAt: Date },
): ExamAutoCloseInput {
  return {
    examId: exam.id,
    startsAt: exam.startsAt.toISOString(),
    endsAt: exam.endsAt.toISOString(),
    scheduleRevision: exam.scheduleRevision,
    timerFingerprint: exam.timerFingerprint,
  };
}

export function contestLifecycleInput(
  contest: ScheduleIdentity & {
    id: string;
    startsAt: Date;
    endsAt: Date;
    frozenAt: Date | null;
    scoreboardMode: ContestLifecycleInput["scoreboardMode"];
  },
): ContestLifecycleInput {
  return {
    contestId: contest.id,
    startsAt: contest.startsAt.toISOString(),
    endsAt: contest.endsAt.toISOString(),
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    scoreboardMode: contest.scoreboardMode,
    scheduleRevision: contest.scheduleRevision,
    timerFingerprint: contest.timerFingerprint,
  };
}

import { assessmentRepo, contestRepo, examRepo } from "@nojv/db";

import { getDomainOrchestration } from "./orchestration";

export interface LifecycleReconcileResult {
  exams: number;
  contests: number;
  assignments: number;
}

export async function reconcileLifecycleTimers(): Promise<LifecycleReconcileResult> {
  const now = new Date();
  const orchestration = getDomainOrchestration();

  const [exams, contests, assignments] = await Promise.all([
    examRepo.listNeedingTimers(now),
    contestRepo.listNeedingTimers(now),
    assessmentRepo.listNeedingTimers(now),
  ]);

  for (const exam of exams) {
    await orchestration.dispatchExamAutoClose({
      examId: exam.id,
      startsAt: exam.startsAt.toISOString(),
      endsAt: exam.endsAt.toISOString(),
    });
  }

  for (const contest of contests) {
    await orchestration.dispatchContestLifecycle({ contestId: contest.id });
  }

  for (const assignment of assignments) {
    await orchestration.dispatchAssignmentDueSoon({
      assignmentId: assignment.id,
      closesAt: assignment.closesAt.toISOString(),
    });
  }

  return {
    exams: exams.length,
    contests: contests.length,
    assignments: assignments.length,
  };
}

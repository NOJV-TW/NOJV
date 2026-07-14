import { assessmentRepo, contestRepo, examRepo } from "@nojv/db";

import { getDomainOrchestration } from "./orchestration";
import {
  assignmentDueSoonInput,
  contestLifecycleInput,
  examAutoCloseInput,
} from "./lifecycle-input";

export interface LifecycleReconcileResult {
  exams: number;
  contests: number;
  assignments: number;
}

export async function reconcileLifecycleTimers(): Promise<LifecycleReconcileResult> {
  const now = new Date();
  const orchestration = getDomainOrchestration();

  const [exams, contests, assignments] = await Promise.all([
    examRepo.listNeedingTimers(),
    contestRepo.listNeedingTimers(now),
    assessmentRepo.listNeedingTimers(now),
  ]);

  for (const exam of exams) {
    await orchestration.ensureExamAutoClose(examAutoCloseInput(exam));
  }

  for (const contest of contests) {
    await orchestration.ensureContestLifecycle(contestLifecycleInput(contest));
  }

  for (const assignment of assignments) {
    await orchestration.ensureAssignmentDueSoon(assignmentDueSoonInput(assignment));
  }

  return {
    exams: exams.length,
    contests: contests.length,
    assignments: assignments.length,
  };
}

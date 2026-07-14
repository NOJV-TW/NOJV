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
  next: LifecycleReconcileCursor | null;
}

interface LifecycleKindCursor {
  afterId: string;
}

export interface LifecycleReconcileCursor {
  exams?: LifecycleKindCursor | null;
  contests?: LifecycleKindCursor | null;
  assignments?: LifecycleKindCursor | null;
}

export const LIFECYCLE_RECONCILE_BATCH_SIZE = 20;
const LIFECYCLE_RECONCILE_CONCURRENCY = 8;

function pageInput(
  now: Date,
  cursor: LifecycleKindCursor | null | undefined,
): { now: Date; afterId?: string; take: number } {
  return {
    now,
    ...(cursor?.afterId ? { afterId: cursor.afterId } : {}),
    take: LIFECYCLE_RECONCILE_BATCH_SIZE + 1,
  };
}

function boundedPage<T extends { id: string }>(
  rows: readonly T[],
): {
  rows: T[];
  next: LifecycleKindCursor | null;
} {
  const selected = rows.slice(0, LIFECYCLE_RECONCILE_BATCH_SIZE);
  return {
    rows: selected,
    next:
      rows.length > LIFECYCLE_RECONCILE_BATCH_SIZE
        ? { afterId: selected[selected.length - 1]!.id }
        : null,
  };
}

async function runBounded(tasks: readonly (() => Promise<void>)[]): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(LIFECYCLE_RECONCILE_CONCURRENCY, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        if (task) await task();
      }
    },
  );
  await Promise.all(workers);
}

export async function reconcileLifecycleTimers(
  cursor: LifecycleReconcileCursor = {},
): Promise<LifecycleReconcileResult> {
  const now = new Date();
  const orchestration = getDomainOrchestration();

  const [exams, contests, assignments] = await Promise.all([
    cursor.exams === null
      ? Promise.resolve([])
      : examRepo.listNeedingTimers(pageInput(now, cursor.exams)),
    cursor.contests === null
      ? Promise.resolve([])
      : contestRepo.listNeedingTimers(pageInput(now, cursor.contests)),
    cursor.assignments === null
      ? Promise.resolve([])
      : assessmentRepo.listNeedingTimers(pageInput(now, cursor.assignments)),
  ]);

  const examPage = boundedPage(exams);
  const contestPage = boundedPage(contests);
  const assignmentPage = boundedPage(assignments);
  const tasksByKind = [
    examPage.rows.map(
      (exam) => () => orchestration.ensureExamAutoClose(examAutoCloseInput(exam)),
    ),
    contestPage.rows.map(
      (contest) => () => orchestration.ensureContestLifecycle(contestLifecycleInput(contest)),
    ),
    assignmentPage.rows.map(
      (assignment) => () =>
        orchestration.ensureAssignmentDueSoon(assignmentDueSoonInput(assignment)),
    ),
  ];
  const tasks: (() => Promise<void>)[] = [];
  const longestPage = Math.max(...tasksByKind.map(({ length }) => length));
  for (let index = 0; index < longestPage; index += 1) {
    for (const kindTasks of tasksByKind) {
      const task = kindTasks[index];
      if (task) tasks.push(task);
    }
  }
  await runBounded(tasks);

  const next: LifecycleReconcileCursor = {
    exams: cursor.exams === null ? null : examPage.next,
    contests: cursor.contests === null ? null : contestPage.next,
    assignments: cursor.assignments === null ? null : assignmentPage.next,
  };
  const complete = next.exams === null && next.contests === null && next.assignments === null;

  return {
    exams: examPage.rows.length,
    contests: contestPage.rows.length,
    assignments: assignmentPage.rows.length,
    next: complete ? null : next,
  };
}

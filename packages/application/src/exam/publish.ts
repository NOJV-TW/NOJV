import { examRepo, type TransactionClient } from "@nojv/db";

import { assertActivityAllocation } from "../scoring/activity-points";
import { assertEffectiveTimeWindow } from "../shared/effective-time-window";
import { ValidationError } from "../shared/errors";
import { assertLateSubmissionPolicy } from "../shared/late-submission-policy";

interface DraftExam {
  id: string;
  status: string;
  allowedLanguages: readonly string[];
  startsAt: Date;
  dueAt: Date | null;
  endsAt: Date;
  adjustmentRules: unknown;
  scoringMode: string;
}

export async function publishExamInTransaction(tx: TransactionClient, exam: DraftExam) {
  if (exam.status !== "draft") {
    throw new ValidationError("Only draft exams can be published.");
  }

  const attached = await tx.examProblem.findMany({ where: { examId: exam.id } });
  assertActivityAllocation(
    attached.map((p) => ({ problemId: p.problemId, points: Number(p.points) })),
    true,
  );

  if (attached.length === 0) {
    throw new ValidationError("Add at least one problem before publishing.");
  }
  if (exam.allowedLanguages.length === 0) {
    throw new ValidationError("Select at least one allowed language before publishing.");
  }
  assertEffectiveTimeWindow({
    start: exam.startsAt,
    end: exam.endsAt,
    due: exam.dueAt,
    fields: { start: "startsAt", due: "dueAt", end: "endsAt" },
  });
  assertLateSubmissionPolicy(exam.adjustmentRules, exam.dueAt, exam.endsAt, exam.scoringMode);
  if (exam.endsAt <= new Date()) {
    throw new ValidationError("End time must be in the future.");
  }

  return examRepo.withTx(tx).update(exam.id, { status: "published" });
}

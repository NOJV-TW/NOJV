import { assessmentRepo, contestRepo, examRepo } from "@nojv/db";
import type {
  AssignmentDueSoonInput,
  ContestLifecycleInput,
  ExamAutoCloseInput,
} from "@nojv/core";

export async function isAssignmentLifecycleCurrent(
  input: AssignmentDueSoonInput,
): Promise<boolean> {
  const row = await assessmentRepo.findByIdWithCourseId(input.assignmentId);
  return (
    row?.status === "published" &&
    row.scheduleRevision === input.scheduleRevision &&
    row.timerFingerprint === input.timerFingerprint
  );
}

export async function isExamLifecycleCurrent(input: ExamAutoCloseInput): Promise<boolean> {
  const row = await examRepo.findById(input.examId);
  return (
    row?.status === "published" &&
    row.scheduleRevision === input.scheduleRevision &&
    row.timerFingerprint === input.timerFingerprint
  );
}

export async function isContestLifecycleCurrent(
  input: ContestLifecycleInput,
): Promise<boolean> {
  const row = await contestRepo.findById(input.contestId);
  return (
    row?.visibility === "published" &&
    row.scheduleRevision === input.scheduleRevision &&
    row.timerFingerprint === input.timerFingerprint
  );
}

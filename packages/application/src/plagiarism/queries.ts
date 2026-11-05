import {
  assessmentRepo,
  contestRepo,
  courseRepo,
  examRepo,
  plagiarismRepo,
  plagiarismTriggerLogRepo,
  submissionRepo,
  runTransaction,
  type PlagiarismContext,
  type PlagiarismReportSummary,
  type TransactionClient,
} from "@nojv/db";
import type { ExamAutoCloseInput } from "@nojv/core";
import type { SubmissionSource } from "@nojv/storage";

import { dispatchPlagiarismCheck } from "./dispatch";
import { lockWritableContextCourse } from "../shared/course-writable";
import { IntegrityError, NotFoundError } from "../shared/errors";
import { toJsonValue } from "../shared/to-json-value";
import { getSubmissionSources } from "../submission/details";
import {
  plagiarismGradedContext,
  plagiarismTargetFilter,
  type PlagiarismResults,
  type PlagiarismTarget,
} from "./types";

export function boundaryMarkerFor(language: string): string {
  return language === "python" ? "#" : "//";
}

export interface PlagiarismSubmission {
  id: string;
  language: string;
  problemId: string;
  score: number;
  sourceCode: string;
  userId: string;
}

async function reportSubmissionFilter(target: PlagiarismTarget) {
  if (target.type !== "exam") return plagiarismTargetFilter(target);
  const exam = await examRepo.findByIdOrThrow(target.id, { startsAt: true, endsAt: true });
  return {
    examId: target.id,
    sampleOnly: false,
    createdAt: { gte: exam.startsAt, lt: exam.endsAt },
  };
}

export async function listSubmissionsForCheck(
  target: PlagiarismTarget,
): Promise<PlagiarismSubmission[]> {
  const rows = await submissionRepo.findForPlagiarism({
    ...(await reportSubmissionFilter(target)),
    status: "accepted",
  });
  const loadOne = async (row: (typeof rows)[number]): Promise<PlagiarismSubmission> => {
    const sources = await getSubmissionSources(row.id);
    const marker = boundaryMarkerFor(row.language);
    const merged = sources
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((s) => `${marker} === ${s.path} ===\n${s.content}`)
      .join("\n");
    return {
      id: row.id,
      userId: row.userId,
      problemId: row.problemId,
      language: row.language,
      score: row.score,
      sourceCode: merged,
    };
  };

  const CONCURRENCY = 16;
  const result: PlagiarismSubmission[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    result.push(...(await Promise.all(rows.slice(i, i + CONCURRENCY).map(loadOne))));
  }
  return result;
}

type PlagiarismReportStatus = "pending" | "running" | "completed" | "failed";

type ReportRun = PlagiarismTarget & { expectedTriggeredAt?: Date | null };

export async function currentExamReportRun(examId: string): Promise<ReportRun> {
  const exam = await examRepo.findByIdOrThrow(examId, { plagiarismTriggeredAt: true });
  return { type: "exam", id: examId, expectedTriggeredAt: exam.plagiarismTriggeredAt };
}

async function writePlagiarismFields(
  target: ReportRun,
  input: Parameters<typeof plagiarismRepo.upsertForExam>[1],
  tx?: TransactionClient,
): Promise<void> {
  if (target.type === "exam" && target.expectedTriggeredAt !== undefined) {
    await plagiarismRepo.updateExamRun(target.id, target.expectedTriggeredAt, input);
  } else if (target.type === "exam") {
    await plagiarismRepo.upsertForExam(target.id, input, tx);
  } else if (target.type === "contest") {
    await plagiarismRepo.upsertForContest(target.id, input, tx);
  } else {
    await plagiarismRepo.upsertForAssessment(target.id, input, tx);
  }
}

export async function updateReportStatus(
  target: ReportRun,
  status: PlagiarismReportStatus,
): Promise<void> {
  await writePlagiarismFields(target, { status });
}

export async function saveResults(
  target: ReportRun,
  results: PlagiarismResults,
  reportUrl: string | null,
): Promise<void> {
  await writePlagiarismFields(target, {
    status: "completed",
    results: toJsonValue(results),
    reportUrl,
    completedAt: new Date(),
  });
}

export async function markReportFailed(target: PlagiarismTarget): Promise<void> {
  await writePlagiarismFields(target, {
    status: "failed",
    completedAt: new Date(),
  });
}

export interface ResolvedPlagiarismTarget {
  target: PlagiarismTarget;
  courseId: string;
}

export async function getPlagiarismTarget(
  targetId: string,
  type: string | null,
): Promise<ResolvedPlagiarismTarget> {
  if (type === "exam") {
    const exam = await examRepo.findByIdWithCourse(targetId);
    if (!exam) throw new NotFoundError("Exam not found.");
    return { courseId: exam.courseId, target: { id: exam.id, type: "exam" } };
  }

  if (type === "contest") {
    const contest = await contestRepo.findById(targetId);
    if (!contest) throw new NotFoundError("Contest not found.");
    return { courseId: "", target: { id: contest.id, type: "contest" } };
  }

  const assignment = await assessmentRepo.findByIdWithCourseId(targetId);
  if (!assignment) throw new NotFoundError("Assignment not found.");
  return {
    courseId: assignment.course.id,
    target: { id: assignment.id, type: "assessment" },
  };
}

function targetToContextType(target: PlagiarismTarget): PlagiarismContext {
  if (target.type === "assessment") return "assessment";
  if (target.type === "contest") return "contest";
  return "exam";
}

function countPriorPairs(results: unknown): number {
  if (!results || typeof results !== "object" || Array.isArray(results)) return 0;
  const pairs = (results as { pairs?: unknown }).pairs;
  return Array.isArray(pairs) ? pairs.length : 0;
}

function pendingReport(triggeredById: string | null, previous?: Date | null) {
  return {
    status: "pending" as const,
    triggeredById,
    triggeredAt: new Date(Math.max(Date.now(), (previous?.getTime() ?? 0) + 1)),
    results: null,
    reportUrl: null,
    completedAt: null,
  };
}

export async function createPlagiarismReport(
  target: PlagiarismTarget,
  triggeredById: string,
): Promise<PlagiarismReportSummary> {
  await runTransaction(async (tx) => {
    await lockWritableContextCourse(tx, plagiarismGradedContext(target.type, target.id));
    if (target.type === "exam") await examRepo.withTx(tx).lockForUpdate(target.id);
    const prior = await findPlagiarismReport(target, tx);
    await plagiarismTriggerLogRepo.create(tx, {
      contextType: targetToContextType(target),
      contextId: target.id,
      triggeredByUserId: triggeredById,
      priorPairCount: countPriorPairs(prior?.results),
    });
    await writePlagiarismFields(target, pendingReport(triggeredById, prior?.triggeredAt), tx);
  });
  const summary = await findPlagiarismReport(target);
  if (!summary) {
    throw new IntegrityError("Failed to persist plagiarism report state.");
  }
  return summary;
}

export async function triggerClosedExamReport(
  input: ExamAutoCloseInput,
): Promise<"wait" | "done"> {
  const receiptId = `exam-close:${input.examId}:${String(input.scheduleRevision)}`;
  const action = await runTransaction(async (tx) => {
    const exams = examRepo.withTx(tx);
    const identity = await exams.findCourseId(input.examId);
    if (!identity) return "done";
    const courses = courseRepo.withTx(tx);
    await courses.lockForShare(identity.courseId);
    if ((await courses.findArchivedById(identity.courseId))?.archived !== false) return "done";
    await exams.lockForUpdate(input.examId);
    const exam = await exams.findById(input.examId);
    if (
      exam?.status !== "published" ||
      exam.scheduleRevision !== input.scheduleRevision ||
      exam.timerFingerprint !== input.timerFingerprint
    )
      return "done";
    if (exam.endsAt.getTime() > Date.now()) return "wait";

    if (await plagiarismTriggerLogRepo.findById(tx, receiptId)) {
      return exam.plagiarismStatus === "pending" && exam.plagiarismTriggeredById === null
        ? "dispatch"
        : "done";
    }
    const pending = await submissionRepo.withTx(tx).count({
      examId: exam.id,
      sampleOnly: false,
      createdAt: { gte: exam.startsAt, lt: exam.endsAt },
      status: { in: ["pending_upload", "queued", "compiling", "running"] },
    });
    if (pending > 0) return "wait";
    await plagiarismTriggerLogRepo.create(tx, {
      id: receiptId,
      contextType: "exam",
      contextId: exam.id,
      triggeredByUserId: null,
      priorPairCount: countPriorPairs(exam.plagiarismResults),
    });
    await plagiarismRepo.upsertForExam(
      exam.id,
      pendingReport(null, exam.plagiarismTriggeredAt),
      tx,
    );
    return "dispatch";
  });
  if (action === "dispatch") {
    await dispatchPlagiarismCheck({
      targetType: "exam",
      targetId: input.examId,
      triggeredById: null,
    });
  }
  return action === "wait" ? "wait" : "done";
}

export async function findPlagiarismReport(
  target: PlagiarismTarget,
  tx?: TransactionClient,
): Promise<PlagiarismReportSummary | null> {
  if (target.type === "assessment") {
    return plagiarismRepo.findByAssessmentId(target.id, tx);
  }
  if (target.type === "contest") {
    return plagiarismRepo.findByContestId(target.id, tx);
  }
  return plagiarismRepo.findByExamId(target.id, tx);
}

// intentional-nullable: caller needs absence when the user has no target submission.
export async function getPlagiarismSourceCode(
  target: PlagiarismTarget,
  userId: string,
  problemId: string,
): Promise<{ submissionId: string; files: SubmissionSource[] } | null> {
  const submission = await submissionRepo.findMany({
    where: {
      ...(await reportSubmissionFilter(target)),
      status: "accepted",
      problemId,
      userId,
    },
    orderBy: [{ score: "desc" }, { id: "asc" }],
    select: { id: true },
    take: 1,
  });
  const top = submission[0];
  if (!top) return null;
  return { submissionId: top.id, files: await getSubmissionSources(top.id) };
}

export async function listAssignmentPlagiarismReports(
  assignmentId: string,
): Promise<PlagiarismReportSummary[]> {
  const report = await plagiarismRepo.findByAssessmentId(assignmentId);
  return report ? [report] : [];
}

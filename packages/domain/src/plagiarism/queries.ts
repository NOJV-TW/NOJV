import {
  assessmentRepo,
  contestRepo,
  examRepo,
  plagiarismRepo,
  plagiarismTriggerLogRepo,
  submissionRepo,
  runTransaction,
  type PlagiarismContext,
  type PlagiarismReportSummary,
} from "@nojv/db";
import type { SubmissionSource } from "@nojv/storage";

import { IntegrityError, NotFoundError } from "../shared/errors";
import { toJsonValue } from "../shared/to-json-value";
import { getSubmissionSources } from "../submission/queries";
import { plagiarismTargetFilter, type PlagiarismResults, type PlagiarismTarget } from "./types";

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

export async function listSubmissionsForCheck(
  target: PlagiarismTarget,
): Promise<PlagiarismSubmission[]> {
  const rows = await submissionRepo.findForPlagiarism({
    ...plagiarismTargetFilter(target),
    status: "accepted",
  });
  return Promise.all(
    rows.map(async (row): Promise<PlagiarismSubmission> => {
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
    }),
  );
}

type PlagiarismReportStatus = "pending" | "running" | "completed" | "failed";

async function writePlagiarismFields(
  target: PlagiarismTarget,
  input: Parameters<typeof plagiarismRepo.upsertForExam>[1],
): Promise<void> {
  if (target.type === "exam") {
    await plagiarismRepo.upsertForExam(target.id, input);
  } else if (target.type === "contest") {
    await plagiarismRepo.upsertForContest(target.id, input);
  } else {
    await plagiarismRepo.upsertForAssessment(target.id, input);
  }
}

export async function updateReportStatus(
  target: PlagiarismTarget,
  status: PlagiarismReportStatus,
): Promise<void> {
  await writePlagiarismFields(target, { status });
}

export async function saveResults(
  target: PlagiarismTarget,
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
    target: { id: assignment.id, type: "courseAssessment" },
  };
}

function targetToContextType(target: PlagiarismTarget): PlagiarismContext {
  if (target.type === "courseAssessment") return "assessment";
  if (target.type === "contest") return "contest";
  return "exam";
}

function countPriorPairs(summary: PlagiarismReportSummary | null): number {
  const results = summary?.results;
  if (!results || typeof results !== "object" || Array.isArray(results)) return 0;
  const pairs = (results as { pairs?: unknown }).pairs;
  return Array.isArray(pairs) ? pairs.length : 0;
}

export async function createPlagiarismReport(
  target: PlagiarismTarget,
  triggeredById: string,
): Promise<PlagiarismReportSummary> {
  const priorSummary = await findPlagiarismReport(target);
  const priorPairCount = countPriorPairs(priorSummary);

  await runTransaction(async (tx) => {
    await plagiarismTriggerLogRepo.create(tx, {
      contextType: targetToContextType(target),
      contextId: target.id,
      triggeredByUserId: triggeredById,
      priorPairCount,
    });
  });

  await writePlagiarismFields(target, {
    status: "pending",
    triggeredById,
    triggeredAt: new Date(),
    results: null,
    reportUrl: null,
    completedAt: null,
  });
  const summary = await findPlagiarismReport(target);
  if (!summary) {
    throw new IntegrityError("Failed to persist plagiarism report state.");
  }
  return summary;
}

export async function findPlagiarismReport(
  target: PlagiarismTarget,
): Promise<PlagiarismReportSummary | null> {
  if (target.type === "courseAssessment") {
    return plagiarismRepo.findByAssessmentId(target.id);
  }
  if (target.type === "contest") {
    return plagiarismRepo.findByContestId(target.id);
  }
  return plagiarismRepo.findByExamId(target.id);
}

// intentional-nullable: pair-diff view renders an empty side when a user has no submission for the problem (MOSS sometimes flags pairs where one side was later deleted); throwing would 500 the whole report.
export async function getPlagiarismSourceCode(
  target: PlagiarismTarget,
  userId: string,
  problemId: string,
): Promise<SubmissionSource[] | null> {
  const submission = await submissionRepo.findMany({
    where: {
      ...plagiarismTargetFilter(target),
      problemId,
      userId,
    },
    orderBy: { score: "desc" },
    select: { id: true },
    take: 1,
  });
  const top = submission[0];
  if (!top) return null;
  return getSubmissionSources(top.id);
}

export async function listAssignmentPlagiarismReports(
  assignmentId: string,
): Promise<PlagiarismReportSummary[]> {
  const report = await plagiarismRepo.findByAssessmentId(assignmentId);
  return report ? [report] : [];
}

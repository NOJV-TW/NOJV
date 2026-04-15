import { courseMembershipRepo, examParticipationRepo, examRepo } from "@nojv/db";
import type { ContestScoringMode, ScoreboardMode } from "@nojv/core";

export type ExamDetailStatus = "draft" | "upcoming" | "running" | "ended";

export interface ExamDetailProblem {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  points: number;
  ordinal: number;
  /** A, B, C… derived from ordinal so the UI never has to compute it. */
  letter: string;
}

export interface ExamRosterEntry {
  userId: string;
  name: string;
  handle: string | null;
  status: "registered" | "active" | "submitted" | "disqualified";
}

export interface ExamDetailPageData {
  id: string;
  courseId: string;
  title: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  status: ExamDetailStatus;
  scoringMode: ContestScoringMode;
  scoreboardMode: ScoreboardMode;
  pageLockEnabled: boolean;
  ipBindingEnabled: boolean;
  ipWhitelistEnabled: boolean;
  ipWhitelistCount: number;
  ipViolationMode: "block" | "notify";
  problems: ExamDetailProblem[];
  registeredCount: number;
  totalStudents: number;
  /** Manager-only — null for student viewers. */
  roster: ExamRosterEntry[] | null;
}

export interface GetExamDetailPageOptions {
  viewerUserId: string;
  isManager: boolean;
  now?: Date;
}

function letterFromOrdinal(ordinal: number): string {
  // Ordinal is 1-indexed in the schema (1, 2, 3 …). Map → A, B, C …
  // and fall back to the raw number if we ever exceed Z.
  const idx = ordinal - 1;
  if (idx < 0 || idx >= 26) return String(ordinal);
  return String.fromCharCode(65 + idx);
}

function deriveStatus(
  raw: "draft" | "published" | "archived",
  startsAt: Date,
  endsAt: Date,
  now: Date
): ExamDetailStatus {
  if (raw === "draft") return "draft";
  if (now < startsAt) return "upcoming";
  if (now >= endsAt) return "ended";
  return "running";
}

/**
 * Loader helper for the exam registration page (prototype 10 — State A).
 *
 * Returns null when the exam does not exist OR when the viewer should
 * not see it (draft + not manager). Returning null lets the caller
 * convert to a 404 without leaking which case it was.
 *
 * The roster is only fetched for managers — students never see who
 * else registered, and we don't want to pay the query for the student
 * path.
 */
export async function getExamDetailPage(
  examId: string,
  options: GetExamDetailPageOptions
): Promise<ExamDetailPageData | null> {
  const now = options.now ?? new Date();
  const exam = await examRepo.findDetailForRegistrationPage(examId);
  if (!exam) return null;

  // Drafts are manager-only.
  if (exam.status === "draft" && !options.isManager) return null;
  // Archived exams are hidden from everyone on this page — they belong
  // in the contest scoreboard view, not the registration screen.
  if (exam.status === "archived") return null;

  const [roster, students] = await Promise.all([
    options.isManager
      ? examParticipationRepo.listForExamWithUser(examId)
      : Promise.resolve(null),
    courseMembershipRepo.findStudents(exam.courseId)
  ]);

  const problems: ExamDetailProblem[] = exam.problems.map((ep) => ({
    id: ep.problem.id,
    title: ep.problem.title,
    difficulty: ep.problem.difficulty as "easy" | "medium" | "hard",
    points: ep.points,
    ordinal: ep.ordinal,
    letter: letterFromOrdinal(ep.ordinal)
  }));

  const rosterMapped: ExamRosterEntry[] | null =
    roster === null
      ? null
      : roster.map((p) => ({
          userId: p.user.id,
          name: p.user.name,
          handle: p.user.username,
          status: p.status
        }));

  return {
    id: exam.id,
    courseId: exam.courseId,
    title: exam.title,
    summary: exam.summary,
    startsAt: exam.startsAt.toISOString(),
    endsAt: exam.endsAt.toISOString(),
    status: deriveStatus(exam.status, exam.startsAt, exam.endsAt, now),
    scoringMode: exam.scoringMode as ContestScoringMode,
    scoreboardMode: exam.scoreboardMode as ScoreboardMode,
    pageLockEnabled: exam.pageLockEnabled,
    ipBindingEnabled: exam.ipBindingEnabled,
    ipWhitelistEnabled: exam.ipWhitelistEnabled,
    ipWhitelistCount: exam.ipWhitelist.length,
    ipViolationMode: exam.ipViolationMode as "block" | "notify",
    problems,
    registeredCount: exam._count.participations,
    totalStudents: students.length,
    roster: rosterMapped
  };
}

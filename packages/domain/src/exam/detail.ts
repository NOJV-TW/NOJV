import { courseMembershipRepo, examParticipationRepo, examRepo } from "@nojv/db";
import type { ContestScoringMode, Language, ScoreboardMode } from "@nojv/core";

export type ExamDetailStatus = "draft" | "upcoming" | "running" | "ended" | "archived";

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

/**
 * Fields exposed only to managers. Keeps the hydration payload for
 * student viewers lean and avoids leaking the raw whitelist / cooldown
 * config through DevTools.
 */
export interface ExamDetailManagerFields {
  /** Raw exam status — `liveStatus` still drives UI gating. */
  rawStatus: "draft" | "published" | "archived";
  frozenBoard: boolean;
  ipWhitelist: string[];
  allowedLanguages: Language[];
  submitCooldownSec: number;
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
  /** Manager-only settings payload; null for student viewers. */
  manager: ExamDetailManagerFields | null;
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
  now: Date,
): ExamDetailStatus {
  if (raw === "draft") return "draft";
  if (raw === "archived") return "archived";
  if (now < startsAt) return "upcoming";
  if (now >= endsAt) return "ended";
  return "running";
}

// Returns null when the exam is missing OR the viewer shouldn't see it — caller converts to 404 without leaking.
export async function getExamDetailPage(
  examId: string,
  options: GetExamDetailPageOptions,
): Promise<ExamDetailPageData | null> {
  const now = options.now ?? new Date();
  const exam = await examRepo.findDetailForRegistrationPage(examId);
  if (!exam) return null;

  // Drafts are manager-only.
  if (exam.status === "draft" && !options.isManager) return null;
  // Archived exams stay manager-only — managers need access to unarchive
  // from the Settings tab; students should not see the detail page for
  // an archived exam (they still see results via the scoreboard view).
  if (exam.status === "archived" && !options.isManager) return null;

  const [roster, students] = await Promise.all([
    options.isManager
      ? examParticipationRepo.listForExamWithUser(examId)
      : Promise.resolve(null),
    courseMembershipRepo.findStudents(exam.courseId),
  ]);

  const derivedStatus = deriveStatus(exam.status, exam.startsAt, exam.endsAt, now);

  // Problem titles/points/difficulty leak to the SvelteKit hydration
  // payload (the UI may hide them, DevTools still sees them). Strip the
  // list for non-managers when:
  //   - the exam hasn't opened yet (upcoming/draft), or
  //   - the parent course is archived (post-hoc lockdown — students see
  //     scoreboard scores but can't preview problems).
  const hideProblemsFromViewer =
    !options.isManager &&
    (derivedStatus === "upcoming" || derivedStatus === "draft" || exam.course.archived);

  const problems: ExamDetailProblem[] = hideProblemsFromViewer
    ? []
    : exam.problems.map((ep) => ({
        id: ep.problem.id,
        title: ep.problem.title,
        difficulty: ep.problem.difficulty,
        points: ep.points,
        ordinal: ep.ordinal,
        letter: letterFromOrdinal(ep.ordinal),
      }));

  const rosterMapped: ExamRosterEntry[] | null =
    roster === null
      ? null
      : roster.map((p) => ({
          userId: p.user.id,
          name: p.user.name,
          handle: p.user.username,
          status: p.status,
        }));

  const manager: ExamDetailManagerFields | null = options.isManager
    ? {
        rawStatus: exam.status,
        frozenBoard: exam.frozenBoard,
        ipWhitelist: exam.ipWhitelist,
        allowedLanguages: exam.allowedLanguages as Language[],
        submitCooldownSec: exam.submitCooldownSec,
      }
    : null;

  return {
    id: exam.id,
    courseId: exam.courseId,
    title: exam.title,
    summary: exam.summary,
    startsAt: exam.startsAt.toISOString(),
    endsAt: exam.endsAt.toISOString(),
    status: derivedStatus,
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
    roster: rosterMapped,
    manager,
  };
}

import { courseMembershipRepo, examRepo } from "@nojv/db";
import type { ContestScoringMode } from "@nojv/core";

// Top-level cross-course "personal exams" view (prototype 15).
// Aggregates published exams from every course the user is currently
// enrolled in, regardless of role. Drafts are excluded entirely —
// drafts only live inside the per-course exams page where teachers /
// TAs work on them.

export type ExamAcrossStatus = "running" | "upcoming" | "ended";

export type ExamAcrossStatusFilter = "all" | ExamAcrossStatus;

export interface ExamAcrossRow {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  status: ExamAcrossStatus;
  /** ISO string. */
  startsAt: string;
  /** ISO string. */
  endsAt: string;
  durationMinutes: number;
  scoringMode: ContestScoringMode;
  problemCount: number;
}

export interface ExamAcrossCounts {
  all: number;
  running: number;
  upcoming: number;
  ended: number;
}

export interface ExamAcrossResult {
  rows: ExamAcrossRow[];
  counts: ExamAcrossCounts;
}

export interface ListExamsAcrossCoursesOptions {
  status?: ExamAcrossStatusFilter;
  now?: Date;
}

function deriveStatus(startsAt: Date, endsAt: Date, now: Date): ExamAcrossStatus {
  if (startsAt > now) return "upcoming";
  if (endsAt <= now) return "ended";
  return "running";
}

function rankRow(row: ExamAcrossRow, now: Date): number {
  // Lower = sorted earlier.
  //   0 running  -> closest to ending first
  //   1 upcoming -> nearest start first
  //   2 ended    -> most recent end first
  const startMs = new Date(row.startsAt).getTime();
  const endMs = new Date(row.endsAt).getTime();
  const nowMs = now.getTime();
  if (row.status === "running") return endMs - nowMs;
  if (row.status === "upcoming") return 1_000_000_000_000 + (startMs - nowMs);
  return 2_000_000_000_000 - endMs;
}

/**
 * Cross-course personal exams list. Returns published exams from every
 * course the user is enrolled in (any role), flattened, status-filtered,
 * and sorted: running → upcoming → ended. Drafts are excluded — they
 * only exist on the per-course exams page.
 *
 * The fetch uses `examRepo.listByCourseId` per course in parallel.
 * Typical users are in fewer than ten courses so the N+1 is acceptable
 * and avoids adding a new repo method that could collide with the
 * in-flight per-course exams refactor.
 */
export async function listExamsAcrossCoursesForUser(
  userId: string,
  options: ListExamsAcrossCoursesOptions = {}
): Promise<ExamAcrossResult> {
  const now = options.now ?? new Date();
  const filter: ExamAcrossStatusFilter = options.status ?? "all";

  const memberships = await courseMembershipRepo.listActiveForUser(userId);
  const courseIds = memberships.map((m) => m.courseId);

  if (courseIds.length === 0) {
    return {
      rows: [],
      counts: { all: 0, running: 0, upcoming: 0, ended: 0 }
    };
  }

  const perCourse = await Promise.all(courseIds.map((id) => examRepo.listByCourseId(id)));
  const flat = perCourse.flat();

  const rows: ExamAcrossRow[] = flat.map((e) => {
    const status = deriveStatus(e.startsAt, e.endsAt, now);
    const durationMs = e.endsAt.getTime() - e.startsAt.getTime();
    const durationMinutes =
      Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 60_000) : 0;
    return {
      id: e.id,
      title: e.title,
      courseId: e.courseId,
      courseTitle: e.course.title,
      status,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      durationMinutes,
      scoringMode: e.scoringMode as ContestScoringMode,
      problemCount: e._count.problems
    };
  });

  const counts: ExamAcrossCounts = {
    all: rows.length,
    running: rows.filter((r) => r.status === "running").length,
    upcoming: rows.filter((r) => r.status === "upcoming").length,
    ended: rows.filter((r) => r.status === "ended").length
  };

  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  filtered.sort((a, b) => rankRow(a, now) - rankRow(b, now));

  return { rows: filtered, counts };
}

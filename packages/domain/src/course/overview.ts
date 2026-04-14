import { announcementRepo, assessmentRepo, examRepo } from "@nojv/db";
import { DEFAULT_LOCALE } from "@nojv/core";

/**
 * Announcement row shape consumed by the course overview page. Title
 * and body are picked from the first translation matching the default
 * locale (with a fallback to the first row). Author info is included
 * for the avatar + name rendering.
 *
 * NOTE: the underlying Announcement model is currently global (no
 * `courseId` column). `listRecentForCourse` accepts `courseId` for
 * forward compatibility; today it returns the most recent global
 * announcements.
 */
export interface OverviewAnnouncement {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  authorName: string;
  authorInitial: string;
}

function pickInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // Prefer the first visible character (works for CJK single-char names
  // like "王" as well as Latin "Alice").
  return trimmed.charAt(0) || "?";
}

export async function listRecentAnnouncementsForCourse(
  _courseId: string,
  limit: number
): Promise<OverviewAnnouncement[]> {
  const rows = await announcementRepo.listRecentWithAuthor(limit);
  return rows.map((row) => {
    const translations = row.translations;
    const localized = translations.find((t) => t.locale === DEFAULT_LOCALE) ??
      translations[0] ?? { title: "", content: "" };
    const authorName = row.createdBy?.name ?? "NOJV";
    return {
      id: row.id,
      title: localized.title,
      content: localized.content,
      createdAt: row.createdAt.toISOString(),
      authorName,
      authorInitial: pickInitial(authorName)
    };
  });
}

// ── Assessments ───────────────────────────────────────────────────────────

export type AssignmentOverviewStatus = "draft" | "upcoming" | "open" | "closed";

export interface AssignmentOverviewRow {
  id: string;
  slug: string;
  title: string;
  status: AssignmentOverviewStatus;
  /** ISO strings; `opensAt`/`closesAt` may be null for draft rows. */
  opensAt: string | null;
  closesAt: string | null;
  problemCount: number;
  /**
   * Best-effort class stats for teacher/TA. Currently always null
   * with a TODO — the per-assessment submission aggregation query
   * does not yet exist and the approximation convention (Task 3.2)
   * says to stub with null and render a simpler meta row.
   */
  classStats: { submittedUsers: number; totalStudents: number; avgScore: number } | null;
  /**
   * Best-effort personal progress for student viewer. Same approximation
   * convention as `classStats` — null until we have a "my work" stats table.
   */
  myStatus: { solved: number; total: number } | null;
}

export interface ListOverviewOptions {
  limit: number;
  isManager: boolean;
  forUserId: string;
  now?: Date;
}

function rankAssignment(
  status: AssignmentOverviewStatus,
  row: { opensAt: Date | null; closesAt: Date | null },
  now: Date
): number {
  // Lower = higher priority. Ranks:
  //  0 open              -> sorted by closesAt asc (most urgent first)
  //  1 upcoming          -> sorted by opensAt asc
  //  2 draft             -> preserved opensAt desc
  //  3 closed            -> most recent first
  if (status === "open") return row.closesAt ? row.closesAt.getTime() - now.getTime() : 0;
  if (status === "upcoming")
    return 1_000_000_000_000 + (row.opensAt ? row.opensAt.getTime() - now.getTime() : 0);
  if (status === "draft") return 2_000_000_000_000;
  // closed: most recent closes first (larger closesAt → smaller rank delta)
  return 3_000_000_000_000 - (row.closesAt?.getTime() ?? 0);
}

export async function listAssignmentOverviewForCourse(
  courseId: string,
  options: ListOverviewOptions
): Promise<AssignmentOverviewRow[]> {
  const now = options.now ?? new Date();
  const rows = await assessmentRepo.listForCourseOverview(
    courseId,
    options.isManager,
    options.limit
  );

  const mapped: { row: AssignmentOverviewRow; rank: number }[] = rows.map((row) => {
    let status: AssignmentOverviewStatus;
    if (row.status === "draft") {
      status = "draft";
    } else if (row.opensAt > now) {
      status = "upcoming";
    } else if (row.closesAt < now) {
      status = "closed";
    } else {
      status = "open";
    }

    const overviewRow: AssignmentOverviewRow = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      status,
      opensAt: status === "draft" ? null : row.opensAt.toISOString(),
      closesAt: status === "draft" ? null : row.closesAt.toISOString(),
      problemCount: row._count.problems,
      // TODO(course-overview): compute class stats (submitted users /
      // total active students / avg score) once the per-assessment
      // submission aggregation query lands. See Task 3.2 approximation.
      classStats: null,
      // TODO(course-overview): per-user solved counter requires a
      // "my work" stats table; see Task 3.2 for the convention.
      myStatus: null
    };
    return {
      row: overviewRow,
      rank: rankAssignment(status, { opensAt: row.opensAt, closesAt: row.closesAt }, now)
    };
  });

  mapped.sort((a, b) => a.rank - b.rank);
  return mapped.slice(0, options.limit).map((entry) => entry.row);
}

// ── Exams ─────────────────────────────────────────────────────────────────

export type ExamOverviewStatus = "draft" | "upcoming" | "running" | "ended";

export interface ExamOverviewRow {
  id: string;
  title: string;
  status: ExamOverviewStatus;
  startsAt: string | null;
  endsAt: string | null;
  /** Duration in minutes. Null when draft has no window. */
  durationMinutes: number | null;
  problemCount: number;
  scoringMode: "point_sum" | "icpc";
  /** Registered participation count for teacher view. */
  registeredCount: number | null;
  /** Total active students in the course — set in the loader. Null = unknown. */
  totalStudents: number | null;
}

function rankExam(
  status: ExamOverviewStatus,
  row: { startsAt: Date; endsAt: Date },
  now: Date
): number {
  if (status === "running") return row.endsAt.getTime() - now.getTime();
  if (status === "upcoming")
    return 1_000_000_000_000 + (row.startsAt.getTime() - now.getTime());
  if (status === "draft") return 2_000_000_000_000;
  return 3_000_000_000_000 - row.endsAt.getTime();
}

export async function listExamOverviewForCourse(
  courseId: string,
  options: ListOverviewOptions
): Promise<ExamOverviewRow[]> {
  const now = options.now ?? new Date();
  const rows = await examRepo.listForCourseOverview(courseId, options.isManager, options.limit);

  const mapped: { row: ExamOverviewRow; rank: number }[] = rows.map((row) => {
    let status: ExamOverviewStatus;
    if (row.status === "draft") {
      status = "draft";
    } else if (row.startsAt > now) {
      status = "upcoming";
    } else if (row.endsAt <= now) {
      status = "ended";
    } else {
      status = "running";
    }
    const durationMs = row.endsAt.getTime() - row.startsAt.getTime();
    const durationMinutes =
      Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 60_000) : null;

    const overviewRow: ExamOverviewRow = {
      id: row.id,
      title: row.title,
      status,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      durationMinutes,
      problemCount: row._count.problems,
      scoringMode: row.scoringMode as "point_sum" | "icpc",
      registeredCount: options.isManager ? row._count.participations : null,
      totalStudents: null
    };
    return {
      row: overviewRow,
      rank: rankExam(status, { startsAt: row.startsAt, endsAt: row.endsAt }, now)
    };
  });

  mapped.sort((a, b) => a.rank - b.rank);
  return mapped.slice(0, options.limit).map((entry) => entry.row);
}

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

interface RawAssessmentRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  opensAt: Date;
  closesAt: Date;
  _count: { problems: number };
}

function mapAssessmentToOverviewRow(
  row: RawAssessmentRow,
  now: Date
): { row: AssignmentOverviewRow; rank: number } {
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

  const mapped = rows.map((row) => mapAssessmentToOverviewRow(row, now));

  mapped.sort((a, b) => a.rank - b.rank);
  return mapped.slice(0, options.limit).map((entry) => entry.row);
}

// ── Assignments list page ─────────────────────────────────────────────────

export type AssignmentStatusFilter = "all" | "open" | "upcoming" | "closed" | "draft";

export interface AssignmentListCounts {
  all: number;
  open: number;
  upcoming: number;
  closed: number;
  /** Null when the viewer is not a manager (students don't see draft counts). */
  draft: number | null;
}

export interface AssignmentListResult {
  rows: AssignmentOverviewRow[];
  counts: AssignmentListCounts;
}

export interface ListAssignmentsForCourseOptions {
  status: AssignmentStatusFilter;
  /** `true` for teacher/TA viewers — includes draft rows in the unfiltered set. */
  includeDrafts: boolean;
  forUserId: string;
  limit: number;
  now?: Date;
}

/**
 * Full assignments list for the course list page. Returns the
 * filtered rows plus per-status counts derived from the same fetch
 * — the counts drive the filter chip badges in the UI.
 *
 * Status is computed in-memory from `opensAt`/`closesAt` (no stored
 * column), so filtering + counting also happen in-memory. We fetch
 * `limit * 3` rows as a superset buffer and cap the returned slice
 * at `limit`. For courses with more than ~150 assessments the counts
 * will underreport — acceptable for the current scale.
 */
export async function listAssignmentsForCourse(
  courseId: string,
  options: ListAssignmentsForCourseOptions
): Promise<AssignmentListResult> {
  const now = options.now ?? new Date();
  const rows = await assessmentRepo.listForCourse(
    courseId,
    options.includeDrafts,
    options.limit * 3
  );

  const mapped = rows.map((row) => mapAssessmentToOverviewRow(row, now));

  const counts: AssignmentListCounts = {
    all: 0,
    open: 0,
    upcoming: 0,
    closed: 0,
    draft: options.includeDrafts ? 0 : null
  };
  for (const entry of mapped) {
    const s = entry.row.status;
    if (s === "draft") {
      if (counts.draft !== null) counts.draft += 1;
      // Drafts are hidden from the `all` count for non-managers (they
      // never appear in mapped at all), and included in `all` for
      // managers — matching the prototype's chip counts.
      counts.all += 1;
      continue;
    }
    counts.all += 1;
    if (s === "open") counts.open += 1;
    else if (s === "upcoming") counts.upcoming += 1;
    else counts.closed += 1;
  }

  const filtered =
    options.status === "all"
      ? mapped
      : mapped.filter((entry) => entry.row.status === options.status);

  filtered.sort((a, b) => a.rank - b.rank);

  return {
    rows: filtered.slice(0, options.limit).map((entry) => entry.row),
    counts
  };
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

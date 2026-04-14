import { assessmentRepo, courseMembershipRepo } from "@nojv/db";

/**
 * Status filter for the top-level /assignments page. Unlike the per-
 * course list this does NOT expose a `draft` filter — drafts are
 * course-internal and the cross-course view only shows them inside
 * "all" for managers.
 */
export type AssignmentsTopStatusFilter = "all" | "open" | "upcoming" | "closed";

export type AssignmentsTopStatus = "draft" | "upcoming" | "open" | "closed";

export interface AssignmentsTopRow {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  status: AssignmentsTopStatus;
  /** ISO strings; both are null only for drafts without a schedule. */
  opensAt: string | null;
  closesAt: string | null;
  problemCount: number;
  /**
   * Best-effort personal progress for the viewer. Null today — the
   * "my work" stats table does not yet exist (see Task 3.2 convention).
   */
  myStatus: { solved: number; total: number } | null;
  /**
   * Best-effort class stats for a managing viewer. Null today — same
   * approximation convention as `myStatus`.
   */
  classStats: { submittedUsers: number; totalStudents: number; avgScore: number } | null;
}

export interface AssignmentsTopCounts {
  all: number;
  open: number;
  upcoming: number;
  closed: number;
}

export interface AssignmentsTopResult {
  rows: AssignmentsTopRow[];
  counts: AssignmentsTopCounts;
  /** True when the user has no active course memberships. */
  hasNoCourses: boolean;
}

export interface ListAssignmentsAcrossCoursesOptions {
  status: AssignmentsTopStatusFilter;
  limit?: number;
  now?: Date;
}

const DEFAULT_LIMIT = 100;

function deriveStatus(
  rawStatus: string,
  opensAt: Date,
  closesAt: Date,
  now: Date
): AssignmentsTopStatus {
  if (rawStatus === "draft") return "draft";
  if (opensAt > now) return "upcoming";
  if (closesAt < now) return "closed";
  return "open";
}

function rankRow(
  status: AssignmentsTopStatus,
  opensAt: Date,
  closesAt: Date,
  now: Date
): number {
  // Lower = higher priority. Matches per-course assignment ranking:
  //  0 open      -> sort by closesAt asc (most urgent first)
  //  1 upcoming  -> sort by opensAt asc
  //  2 draft     -> pushed to the bottom
  //  3 closed    -> most recently closed first
  if (status === "open") return closesAt.getTime() - now.getTime();
  if (status === "upcoming") return 1_000_000_000_000 + (opensAt.getTime() - now.getTime());
  if (status === "draft") return 2_000_000_000_000;
  return 3_000_000_000_000 - closesAt.getTime();
}

/**
 * Personal cross-course assignments roll-up for the top-level
 * /assignments page. Returns every assignment from every course the
 * user is in — published for all enrolments, plus drafts for courses
 * where the user is teacher/TA.
 *
 * Shape matches prototype 14: row carries `courseId` + `courseTitle`
 * for the CourseTagPill; `myStatus` / `classStats` are null today
 * (same TODO convention as the per-course overview).
 */
export async function listAssignmentsAcrossCoursesForUser(
  userId: string,
  options: ListAssignmentsAcrossCoursesOptions
): Promise<AssignmentsTopResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? DEFAULT_LIMIT;

  const memberships = await courseMembershipRepo.listActiveForUser(userId);
  if (memberships.length === 0) {
    return {
      rows: [],
      counts: { all: 0, open: 0, upcoming: 0, closed: 0 },
      hasNoCourses: true
    };
  }

  const allCourseIds = memberships.map((m) => m.courseId);
  const managerCourseIds = memberships
    .filter((m) => m.role === "teacher" || m.role === "ta")
    .map((m) => m.courseId);

  // Fetch a superset so the in-memory sort + trim has room. Cross-
  // course scale is small (a student has ~5 courses, each with ~10
  // assignments); the 3x buffer matches `listForCourse`'s convention.
  const rawRows = await assessmentRepo.listAcrossCourses(
    allCourseIds,
    managerCourseIds,
    limit * 3
  );

  interface Mapped {
    row: AssignmentsTopRow;
    rank: number;
  }

  const mapped: Mapped[] = rawRows.map((raw) => {
    const status = deriveStatus(raw.status, raw.opensAt, raw.closesAt, now);
    const row: AssignmentsTopRow = {
      id: raw.id,
      courseId: raw.course.id,
      courseTitle: raw.course.title,
      title: raw.title,
      status,
      opensAt: status === "draft" ? null : raw.opensAt.toISOString(),
      closesAt: status === "draft" ? null : raw.closesAt.toISOString(),
      problemCount: raw._count.problems,
      // TODO(cross-course): personal progress requires the "my work"
      // stats table (see per-course overview TODO, Task 3.2).
      myStatus: null,
      // TODO(cross-course): per-assessment class aggregation requires
      // the submission aggregation query (see per-course overview TODO).
      classStats: null
    };
    return {
      row,
      rank: rankRow(status, raw.opensAt, raw.closesAt, now)
    };
  });

  // Counts reflect the ALL filter set (drafts included for managers).
  // The status chips never filter to draft here — drafts only appear
  // inside "all" — so we don't expose a draft counter.
  const counts: AssignmentsTopCounts = { all: 0, open: 0, upcoming: 0, closed: 0 };
  for (const entry of mapped) {
    counts.all += 1;
    const s = entry.row.status;
    if (s === "open") counts.open += 1;
    else if (s === "upcoming") counts.upcoming += 1;
    else if (s === "closed") counts.closed += 1;
  }

  const filtered =
    options.status === "all"
      ? mapped
      : mapped.filter((entry) => entry.row.status === options.status);

  filtered.sort((a, b) => a.rank - b.rank);

  return {
    rows: filtered.slice(0, limit).map((entry) => entry.row),
    counts,
    hasNoCourses: false
  };
}

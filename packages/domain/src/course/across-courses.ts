import { assessmentRepo, courseMembershipRepo } from "@nojv/db";

import {
  aggregateAssessmentClassStats,
  aggregateAssessmentMyStatus,
} from "../shared/list-aggregations";

// No draft filter: drafts are course-internal and only appear inside "all" for managers.
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
  /** Student row only — null for assignments in courses this user manages. */
  myStatus: {
    solved: number;
    total: number;
    score: number;
    totalPoints: number;
  } | null;
  /** Manager row only — null for assignments in courses this user is enrolled in as a student. */
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
  now: Date,
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
  now: Date,
): number {
  // Lower rank = higher priority; matches per-course `rankAssignment` bands.
  if (status === "open") return closesAt.getTime() - now.getTime();
  if (status === "upcoming") return 1_000_000_000_000 + (opensAt.getTime() - now.getTime());
  if (status === "draft") return 2_000_000_000_000;
  return 3_000_000_000_000 - closesAt.getTime();
}

export async function listAssignmentsAcrossCoursesForUser(
  userId: string,
  options: ListAssignmentsAcrossCoursesOptions,
): Promise<AssignmentsTopResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? DEFAULT_LIMIT;

  const memberships = await courseMembershipRepo.listActiveForUser(userId);
  if (memberships.length === 0) {
    return {
      rows: [],
      counts: { all: 0, open: 0, upcoming: 0, closed: 0 },
      hasNoCourses: true,
    };
  }

  const allCourseIds = memberships.map((m) => m.courseId);
  const managerCourseIds = memberships
    .filter((m) => m.role === "teacher" || m.role === "ta")
    .map((m) => m.courseId);

  const rawRows = await assessmentRepo.listAcrossCourses(
    allCourseIds,
    managerCourseIds,
    limit * 3,
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
      myStatus: null,
      classStats: null,
    };
    return {
      row,
      rank: rankRow(status, raw.opensAt, raw.closesAt, now),
    };
  });

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

  const visibleRows = filtered.slice(0, limit).map((entry) => entry.row);

  const managerCourseSet = new Set(managerCourseIds);
  const managedRows = visibleRows.filter((r) => managerCourseSet.has(r.courseId));
  const studentRows = visibleRows.filter((r) => !managerCourseSet.has(r.courseId));

  const [classStatsByAssessment, myStatusByAssessment] = await Promise.all([
    aggregateAssessmentClassStats(
      managedRows.map((r) => ({
        id: r.id,
        courseId: r.courseId,
        problemCount: r.problemCount,
      })),
    ),
    aggregateAssessmentMyStatus(
      userId,
      studentRows.map((r) => ({ id: r.id, problemCount: r.problemCount })),
    ),
  ]);

  for (const r of managedRows) {
    r.classStats = classStatsByAssessment.get(r.id) ?? null;
  }
  for (const r of studentRows) {
    r.myStatus = myStatusByAssessment.get(r.id) ?? null;
  }

  return {
    rows: visibleRows,
    counts,
    hasNoCourses: false,
  };
}

import { assessmentRepo, examRepo } from "@nojv/db";
import { DEFAULT_LOCALE } from "@nojv/core";
import type { AnnouncementAudience, PlatformRole } from "@nojv/core";

import * as announcementDomain from "../announcement";
import {
  aggregateAssignmentClassStats,
  aggregateAssignmentMyStatus,
  aggregateExamMyStatus,
} from "../shared/list-aggregations";

interface ActorRoleHint {
  platformRole: PlatformRole;
}

export interface OverviewAnnouncement {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  authorName: string;
  authorInitial: string;
  /** Manager-edit fields. Safe to expose: row was already passed through audience filter. */
  pinned: boolean;
  published: boolean;
  audience: AnnouncementAudience;
  expiresAt: string | null;
}

// First character handles CJK single-char names ("王") and Latin ("Alice") alike.
function pickInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0) || "?";
}

// Sort bands: open rows < upcoming < draft < closed/ended.
// Within each band the row's own time pushes the rank.
const RANK_BAND_UPCOMING = 1_000_000_000_000;
const RANK_BAND_DRAFT = 2_000_000_000_000;
const RANK_BAND_TERMINAL = 3_000_000_000_000;

export async function listRecentAnnouncementsForCourse(
  courseId: string,
  limit: number,
  actor?: ActorRoleHint | null,
): Promise<OverviewAnnouncement[]> {
  const rows = await announcementDomain.listPublicAnnouncementsForCourse(
    courseId,
    actor,
    limit,
  );
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
      authorInitial: pickInitial(authorName),
      pinned: row.pinned,
      published: row.status === "published",
      audience: row.audience,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  });
}

export type AssignmentOverviewStatus = "draft" | "upcoming" | "open" | "closed";

export interface AssignmentOverviewRow {
  id: string;
  title: string;
  status: AssignmentOverviewStatus;
  /** ISO strings; `opensAt`/`closesAt` may be null for draft rows. */
  opensAt: string | null;
  closesAt: string | null;
  problemCount: number;
  /** Manager view only — null for students. avgScore is the rounded mean of per-user totals across submitters. */
  classStats: { submittedUsers: number; totalStudents: number; avgScore: number } | null;
  /** Student view only — null for managers. solved counts distinct problems with at least one accepted submission. */
  myStatus: {
    solved: number;
    total: number;
    score: number;
    totalPoints: number;
  } | null;
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
  now: Date,
): number {
  if (status === "open") return row.closesAt ? row.closesAt.getTime() - now.getTime() : 0;
  if (status === "upcoming")
    return RANK_BAND_UPCOMING + (row.opensAt ? row.opensAt.getTime() - now.getTime() : 0);
  if (status === "draft") return RANK_BAND_DRAFT;
  // Closed band: most-recently-closed first (larger closesAt → smaller rank).
  return RANK_BAND_TERMINAL - (row.closesAt?.getTime() ?? 0);
}

interface RawAssignmentRow {
  id: string;
  title: string;
  status: string;
  opensAt: Date;
  closesAt: Date;
  _count: { problems: number };
}

function mapAssignmentToOverviewRow(
  row: RawAssignmentRow,
  now: Date,
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
    title: row.title,
    status,
    opensAt: status === "draft" ? null : row.opensAt.toISOString(),
    closesAt: status === "draft" ? null : row.closesAt.toISOString(),
    problemCount: row._count.problems,
    classStats: null,
    myStatus: null,
  };
  return {
    row: overviewRow,
    rank: rankAssignment(status, { opensAt: row.opensAt, closesAt: row.closesAt }, now),
  };
}

export async function listAssignmentOverviewForCourse(
  courseId: string,
  options: ListOverviewOptions,
): Promise<AssignmentOverviewRow[]> {
  const now = options.now ?? new Date();
  const rows = await assessmentRepo.listForCourseOverview(
    courseId,
    options.isManager,
    options.limit,
  );

  const mapped = rows.map((row) => mapAssignmentToOverviewRow(row, now));

  mapped.sort((a, b) => a.rank - b.rank);
  const top = mapped.slice(0, options.limit).map((entry) => entry.row);
  await fillAssignmentStats(top, courseId, options);
  return top;
}

async function fillAssignmentStats(
  rows: AssignmentOverviewRow[],
  courseId: string,
  options: { isManager: boolean; forUserId: string },
): Promise<void> {
  if (rows.length === 0) return;
  const aggInput = rows.map((r) => ({ id: r.id, courseId, problemCount: r.problemCount }));
  if (options.isManager) {
    const stats = await aggregateAssignmentClassStats(aggInput);
    for (const r of rows) r.classStats = stats.get(r.id) ?? null;
  } else {
    const my = await aggregateAssignmentMyStatus(options.forUserId, aggInput);
    for (const r of rows) r.myStatus = my.get(r.id) ?? null;
  }
}

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

// Fetches `limit * 3` superset and caps; for courses with more than ~150 assignments chip counts will underreport.
export async function listAssignmentsForCourse(
  courseId: string,
  options: ListAssignmentsForCourseOptions,
): Promise<AssignmentListResult> {
  const now = options.now ?? new Date();
  const rows = await assessmentRepo.listForCourse(
    courseId,
    options.includeDrafts,
    options.limit * 3,
  );

  const mapped = rows.map((row) => mapAssignmentToOverviewRow(row, now));

  const counts: AssignmentListCounts = {
    all: 0,
    open: 0,
    upcoming: 0,
    closed: 0,
    draft: options.includeDrafts ? 0 : null,
  };
  for (const entry of mapped) {
    const s = entry.row.status;
    if (s === "draft") {
      if (counts.draft !== null) counts.draft += 1;
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

  const visibleRows = filtered.slice(0, options.limit).map((entry) => entry.row);
  await fillAssignmentStats(visibleRows, courseId, {
    isManager: options.includeDrafts,
    forUserId: options.forUserId,
  });

  return {
    rows: visibleRows,
    counts,
  };
}

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
  scoringMode: "point_sum" | "problem_count";
  /** Registered participation count for teacher view. */
  registeredCount: number | null;
  /** Total active students in the course — set in the loader. Null = unknown. */
  totalStudents: number | null;
  /** Student view only — null for managers / upcoming / draft. */
  myStatus: {
    solved: number;
    total: number;
    score: number;
    totalPoints: number;
  } | null;
}

function rankExam(
  status: ExamOverviewStatus,
  row: { startsAt: Date; endsAt: Date },
  now: Date,
): number {
  if (status === "running") return row.endsAt.getTime() - now.getTime();
  if (status === "upcoming")
    return RANK_BAND_UPCOMING + (row.startsAt.getTime() - now.getTime());
  if (status === "draft") return RANK_BAND_DRAFT;
  return RANK_BAND_TERMINAL - row.endsAt.getTime();
}

export async function listExamOverviewForCourse(
  courseId: string,
  options: ListOverviewOptions,
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
      scoringMode: row.scoringMode as "point_sum" | "problem_count",
      registeredCount: options.isManager ? row._count.participations : null,
      totalStudents: null,
      myStatus: null,
    };
    return {
      row: overviewRow,
      rank: rankExam(status, { startsAt: row.startsAt, endsAt: row.endsAt }, now),
    };
  });

  mapped.sort((a, b) => a.rank - b.rank);
  const visibleRows = mapped.slice(0, options.limit).map((entry) => entry.row);

  if (!options.isManager) {
    const scoreable = visibleRows.filter((r) => r.status === "running" || r.status === "ended");
    if (scoreable.length > 0) {
      const my = await aggregateExamMyStatus(
        options.forUserId,
        scoreable.map((r) => ({ id: r.id, problemCount: r.problemCount })),
      );
      for (const r of scoreable) {
        r.myStatus = my.get(r.id) ?? null;
      }
    }
  }

  return visibleRows;
}

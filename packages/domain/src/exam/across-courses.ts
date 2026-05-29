import { courseMembershipRepo, examRepo } from "@nojv/db";
import type { ContestScoringMode } from "@nojv/core";

import { aggregateExamMyStatus } from "../shared/list-aggregations";

export type ExamAcrossStatus = "running" | "upcoming" | "ended";

export type ExamAcrossStatusFilter = "all" | ExamAcrossStatus;

export interface ExamAcrossRow {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  status: ExamAcrossStatus;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  scoringMode: ContestScoringMode;
  problemCount: number;
  myStatus: {
    solved: number;
    total: number;
    score: number;
    totalPoints: number;
  } | null;
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
  const startMs = new Date(row.startsAt).getTime();
  const endMs = new Date(row.endsAt).getTime();
  const nowMs = now.getTime();
  if (row.status === "running") return endMs - nowMs;
  if (row.status === "upcoming") return 1_000_000_000_000 + (startMs - nowMs);
  return 2_000_000_000_000 - endMs;
}

export async function listExamsAcrossCoursesForUser(
  userId: string,
  options: ListExamsAcrossCoursesOptions = {},
): Promise<ExamAcrossResult> {
  const now = options.now ?? new Date();
  const filter: ExamAcrossStatusFilter = options.status ?? "all";

  const memberships = await courseMembershipRepo.listActiveForUser(userId);
  const courseIds = memberships.map((m) => m.courseId);

  if (courseIds.length === 0) {
    return {
      rows: [],
      counts: { all: 0, running: 0, upcoming: 0, ended: 0 },
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
      scoringMode: e.scoringMode,
      problemCount: e._count.problems,
      myStatus: null,
    };
  });

  const counts: ExamAcrossCounts = {
    all: rows.length,
    running: rows.filter((r) => r.status === "running").length,
    upcoming: rows.filter((r) => r.status === "upcoming").length,
    ended: rows.filter((r) => r.status === "ended").length,
  };

  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  filtered.sort((a, b) => rankRow(a, now) - rankRow(b, now));

  const scoreable = filtered.filter((r) => r.status !== "upcoming");
  if (scoreable.length > 0) {
    const my = await aggregateExamMyStatus(
      userId,
      scoreable.map((r) => ({ id: r.id, problemCount: r.problemCount })),
    );
    for (const r of scoreable) {
      r.myStatus = my.get(r.id) ?? null;
    }
  }

  return { rows: filtered, counts };
}

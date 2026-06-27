import { courseMembershipRepo, examRepo, ipViolationLogRepo } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { aggregateExamClassStats, aggregateExamMyStatus } from "../shared/list-aggregations";
import { canManageExam } from "./permissions";

export type ExamStatusFilter = "all" | "upcoming" | "running" | "ended" | "draft";

export type ExamRowStatus = "draft" | "upcoming" | "running" | "ended";

export interface ExamProctoring {
  pageLock: boolean;
  ipBinding: boolean;
  ipWhitelist: boolean;
}

export interface ExamListRow {
  id: string;
  title: string;
  status: ExamRowStatus;
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number | null;
  scoringMode: "problem_count" | "point_sum";
  problemCount: number;
  proctoring: ExamProctoring;
  registeredCount: number | null;
  totalStudents: number | null;
  classStats: { submittedUsers: number; totalStudents: number; avgScore: number } | null;
  myStatus: {
    solved: number;
    total: number;
    score: number;
    totalPoints: number;
  } | null;
}

export interface ExamListCounts {
  all: number;
  upcoming: number;
  running: number;
  ended: number;
  draft: number | null;
}

export interface ExamListResult {
  rows: ExamListRow[];
  counts: ExamListCounts;
}

export interface ListForCourseOptions {
  status: ExamStatusFilter;
  includeDrafts: boolean;
  forUserId: string;
  limit: number;
  now?: Date;
}

type ExamListRawRow = Awaited<ReturnType<typeof examRepo.listForCourse>>[number];

function rankExamRow(
  status: ExamRowStatus,
  row: { startsAt: Date; endsAt: Date },
  now: Date,
): number {
  if (status === "running") return row.endsAt.getTime() - now.getTime();
  if (status === "upcoming")
    return 1_000_000_000_000 + (row.startsAt.getTime() - now.getTime());
  if (status === "draft") return 2_000_000_000_000;
  return 3_000_000_000_000 - row.endsAt.getTime();
}

function mapExamRow(
  raw: ExamListRawRow,
  includeManagerData: boolean,
  now: Date,
): { row: ExamListRow; rank: number } {
  let status: ExamRowStatus;
  if (raw.status === "draft") {
    status = "draft";
  } else if (raw.startsAt > now) {
    status = "upcoming";
  } else if (raw.endsAt <= now) {
    status = "ended";
  } else {
    status = "running";
  }

  const durationMs = raw.endsAt.getTime() - raw.startsAt.getTime();
  const durationMinutes =
    Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 60_000) : null;

  const row: ExamListRow = {
    id: raw.id,
    title: raw.title,
    status,
    startsAt: status === "draft" ? null : raw.startsAt.toISOString(),
    endsAt: status === "draft" ? null : raw.endsAt.toISOString(),
    durationMinutes: status === "draft" ? null : durationMinutes,
    scoringMode: raw.scoringMode,
    problemCount: raw._count.problems,
    proctoring: {
      pageLock: raw.pageLockEnabled,
      ipBinding: raw.ipBindingEnabled,
      ipWhitelist: raw.ipWhitelistEnabled,
    },
    registeredCount: includeManagerData ? raw._count.participations : null,
    totalStudents: null,
    classStats: null,
    myStatus: null,
  };

  return {
    row,
    rank: rankExamRow(status, { startsAt: raw.startsAt, endsAt: raw.endsAt }, now),
  };
}

export async function listForCourse(
  courseId: string,
  options: ListForCourseOptions,
): Promise<ExamListResult> {
  const now = options.now ?? new Date();
  const raws = await examRepo.listForCourse(courseId, options.includeDrafts, options.limit);

  const mapped = raws.map((r) => mapExamRow(r, options.includeDrafts, now));

  const counts: ExamListCounts = {
    all: 0,
    upcoming: 0,
    running: 0,
    ended: 0,
    draft: options.includeDrafts ? 0 : null,
  };
  for (const entry of mapped) {
    const s = entry.row.status;
    counts.all += 1;
    if (s === "upcoming") counts.upcoming += 1;
    else if (s === "running") counts.running += 1;
    else if (s === "ended") counts.ended += 1;
    else if (counts.draft !== null) counts.draft += 1;
  }

  const filtered =
    options.status === "all"
      ? mapped
      : mapped.filter((entry) => entry.row.status === options.status);

  filtered.sort((a, b) => a.rank - b.rank);

  const visibleRows = filtered.slice(0, options.limit).map((entry) => entry.row);
  const aggInput = visibleRows.map((r) => ({
    id: r.id,
    courseId,
    problemCount: r.problemCount,
  }));
  if (options.includeDrafts) {
    const stats = await aggregateExamClassStats(aggInput);
    for (const r of visibleRows) r.classStats = stats.get(r.id) ?? null;
  } else {
    const my = await aggregateExamMyStatus(options.forUserId, aggInput);
    for (const r of visibleRows) r.myStatus = my.get(r.id) ?? null;
  }

  return {
    rows: visibleRows,
    counts,
  };
}

export async function getExamById(id: string) {
  return examRepo.findById(id);
}

export function listExamIpViolations(opts: { examId: string; take?: number }) {
  return ipViolationLogRepo.listByExam({
    examId: opts.examId,
    take: opts.take ?? 200,
  });
}

export async function listExamIpViolationsForActor(actor: ActorContext, examId: string) {
  const exam = await examRepo.findById(examId);
  if (!exam) {
    throw new NotFoundError(`Exam not found: ${examId}`);
  }
  if (actor.platformRole !== "admin") {
    const memberships = await courseMembershipRepo.listActiveForUser(actor.userId);
    const canManage = canManageExam(
      actor.userId,
      { createdByUserId: exam.createdByUserId, courseId: exam.courseId },
      memberships,
    );
    if (!canManage) {
      throw new ForbiddenError("Not authorized to view this exam's IP violations");
    }
  }
  return listExamIpViolations({ examId });
}

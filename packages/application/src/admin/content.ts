import { assessmentRepo, contestRepo, courseRepo, examRepo } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError } from "../shared/errors";

function assertAdmin(actor: ActorContext): void {
  if (actor.platformRole !== "admin") throw new ForbiddenError("Admin access required.");
}

function displayName(user: { name: string; username: string | null } | null): string {
  return user?.name ?? user?.username ?? "—";
}

export async function listAllCoursesForAdmin(actor: ActorContext) {
  assertAdmin(actor);
  const rows = await courseRepo.listAllForAdmin();
  return rows.map((row) => ({
    academicYear: row.academicYear,
    archived: row.archived,
    assignmentCount: row._count.assessments,
    examCount: row._count.exams,
    id: row.id,
    memberCount: row._count.memberships,
    ownerDisplayName: displayName(row.owner),
    semester: row.semester,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

function assignmentStatus(
  row: { status: string; opensAt: Date; closesAt: Date },
  now: Date,
): "draft" | "upcoming" | "open" | "closed" {
  if (row.status === "draft") return "draft";
  if (row.opensAt > now) return "upcoming";
  if (row.closesAt <= now) return "closed";
  return "open";
}

export async function listAllAssignmentsForAdmin(actor: ActorContext, now = new Date()) {
  assertAdmin(actor);
  const rows = await assessmentRepo.listAllForAdmin();
  return rows.map((row) => ({
    closesAt: row.closesAt.toISOString(),
    courseId: row.courseId,
    courseTitle: row.course.title,
    id: row.id,
    opensAt: row.opensAt.toISOString(),
    ownerDisplayName: displayName(row.createdBy),
    problemCount: row._count.problems,
    status: assignmentStatus(row, now),
    title: row.title,
  }));
}

function timedStatus(
  start: Date,
  end: Date,
  draft: boolean,
  now: Date,
): "draft" | "upcoming" | "running" | "ended" {
  if (draft) return "draft";
  if (start > now) return "upcoming";
  if (end <= now) return "ended";
  return "running";
}

export async function listAllExamsForAdmin(actor: ActorContext, now = new Date()) {
  assertAdmin(actor);
  const rows = await examRepo.listAllForAdmin();
  return rows.map((row) => ({
    courseId: row.courseId,
    courseTitle: row.course.title,
    endsAt: row.endsAt.toISOString(),
    id: row.id,
    ownerDisplayName: displayName(row.createdBy),
    problemCount: row._count.problems,
    startsAt: row.startsAt.toISOString(),
    status: timedStatus(row.startsAt, row.endsAt, row.status === "draft", now),
    title: row.title,
  }));
}

export async function listAllContestsForAdmin(actor: ActorContext, now = new Date()) {
  assertAdmin(actor);
  const rows = await contestRepo.listAllForAdmin();
  return rows.map((row) => ({
    endsAt: row.endsAt.toISOString(),
    id: row.id,
    ownerDisplayName: displayName(row.createdBy),
    participantCount: row._count.participations,
    problemCount: row._count.problems,
    startsAt: row.startsAt.toISOString(),
    status: timedStatus(row.startsAt, row.endsAt, row.visibility === "draft", now),
    summary: row.summary,
    title: row.title,
    visibility: row.visibility,
  }));
}

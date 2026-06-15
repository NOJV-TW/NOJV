import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import {
  assignmentDomain,
  canManageCourse,
  contestDomain,
  courseDomain,
  examDomain,
  ForbiddenError,
  NotFoundError,
  resolveEffectiveCourseRole,
  ValidationError,
  type plagiarismDomain,
} from "@nojv/application";

import type { CompletedActorContext } from "$lib/server/auth";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { loadPlagiarismPair } from "$lib/server/plagiarism-pair";

const { getCourseHeaderById } = courseDomain;
const { getContestDetail } = contestDomain;

function parsePairIdParam(raw: string): {
  contextType: plagiarismDomain.PlagiarismContext;
  contextId: string;
  pairKey: string;
} {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new ValidationError("Invalid pair id.");
  }
  const firstSep = decoded.indexOf(":");
  const secondSep = firstSep === -1 ? -1 : decoded.indexOf(":", firstSep + 1);
  if (firstSep === -1 || secondSep === -1) {
    throw new ValidationError("Invalid pair id.");
  }
  const ctxType = decoded.slice(0, firstSep);
  const ctxId = decoded.slice(firstSep + 1, secondSep);
  const pairKey = decoded.slice(secondSep + 1);
  if (!ctxId || !pairKey) {
    throw new ValidationError("Invalid pair id.");
  }
  if (ctxType !== "assessment" && ctxType !== "contest" && ctxType !== "exam") {
    throw new ValidationError("Invalid plagiarism context.");
  }
  return { contextType: ctxType, contextId: ctxId, pairKey };
}

async function assertAssignmentManager(actor: CompletedActorContext, assignmentId: string) {
  const assignment = await assignmentDomain.getAssignmentWithCourseId(assignmentId);
  if (!assignment) {
    throw new NotFoundError("Assignment not found.");
  }
  const course = await getCourseHeaderById(assignment.course.id, actor.userId);
  if (!course) {
    throw new NotFoundError("Course not found.");
  }
  const membership = course.memberships[0] ?? null;
  const effectiveRole = resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.role ?? null,
  );
  const isManager = canManageCourse(effectiveRole) || course.ownerId === actor.userId;
  if (!isManager) {
    throw new ForbiddenError("Only course staff can view plagiarism diff.");
  }
}

async function assertExamManager(actor: CompletedActorContext, examId: string) {
  const exam = await examDomain.getExamById(examId);
  if (!exam) {
    throw new NotFoundError("Exam not found.");
  }
  const course = await getCourseHeaderById(exam.courseId, actor.userId);
  if (!course) {
    throw new NotFoundError("Exam not found.");
  }
  const membership = course.memberships[0] ?? null;
  const effectiveRole = resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.role ?? null,
  );
  const isManager = canManageCourse(effectiveRole) || course.ownerId === actor.userId;
  if (!isManager) {
    throw new ForbiddenError("Only course staff can view plagiarism diff.");
  }
}

async function assertContestManager(actor: CompletedActorContext, contestId: string) {
  const contest = await getContestDetail(contestId, {
    userId: actor.userId,
    platformRole: actor.platformRole,
    now: new Date(),
  });
  if (!contest.isManager) {
    throw new ForbiddenError("Only contest organizers can view plagiarism diff.");
  }
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { contextType, contextId, pairKey } = parsePairIdParam(event.params.pairId);

  if (contextType === "assessment") {
    await assertAssignmentManager(actor, contextId);
    return await loadPlagiarismPair({
      pairId: pairKey,
      target: { type: "assessment", id: contextId },
      flagContext: "assessment",
    });
  }

  if (contextType === "exam") {
    await assertExamManager(actor, contextId);
    return await loadPlagiarismPair({
      pairId: pairKey,
      target: { type: "exam", id: contextId },
      flagContext: "exam",
    });
  }

  await assertContestManager(actor, contextId);
  return await loadPlagiarismPair({
    pairId: pairKey,
    target: { type: "contest", id: contextId },
    flagContext: "contest",
  });
});

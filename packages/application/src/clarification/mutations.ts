import {
  assessmentRepo,
  assessmentProblemRepo,
  clarificationRepo,
  contestProblemRepo,
  contestRepo,
  examProblemRepo,
  examRepo,
  type ClarificationRow,
} from "@nojv/db";
import { SSE_CLARIFICATION, type ClarificationSSEEvent } from "@nojv/core";
import { pubsub } from "@nojv/redis";

import * as notificationDomain from "../notification";
import type { ActorContext } from "../shared/actor-context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { canAnswerInContext, canAskClarification, canSeeAuthor } from "./permissions";
import { buildClarificationLink, projectRow, type ProjectedClarification } from "./queries";
import { fromContextDbFields, toContextDbFields, type ClarificationContext } from "./types";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_COUNT = 5;
const QUESTION_MIN = 10;
const QUESTION_MAX = 1000;
const ANSWER_MIN = 1;
const ANSWER_MAX = 1000;

export interface AskInput {
  context: ClarificationContext;
  problemId?: string | null;
  questionText: string;
}

export interface AnswerInput {
  answerText: string;
  /** Public answers are broadcast to every participant; private ones stay with the asker. */
  isPublic: boolean;
}

export async function ask(
  actor: ActorContext,
  input: AskInput,
): Promise<ProjectedClarification> {
  const text = input.questionText;
  if (text.length < QUESTION_MIN || text.length > QUESTION_MAX) {
    throw new ValidationError("Question must be 10-1000 characters.");
  }
  if (!(await canAskClarification(actor, input.context))) {
    throw new ForbiddenError("Only participants may ask clarifications.");
  }
  await assertContextActiveForAsk(input.context);
  if (input.problemId) {
    await assertProblemInContext(input.context, input.problemId);
  }

  const db = toContextDbFields(input.context);
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await clarificationRepo.countInWindow(
    actor.userId,
    db.contextType,
    db.contextId,
    windowStart,
  );
  if (recent >= RATE_LIMIT_COUNT) {
    throw new ConflictError("Too many questions in the last 10 minutes.");
  }

  const row = await clarificationRepo.create({
    contextType: db.contextType,
    contextId: db.contextId,
    problemId: input.problemId ?? null,
    askedByUserId: actor.userId,
    questionText: text,
  });
  // Do NOT broadcast the new question to peers — pending questions are visible
  // only to the asker (who gets it from this response) and to staff (on load).
  // Broadcasting raw questions live is a leak vector during exams/contests.
  const isStaff = await canSeeAuthor(actor, input.context);
  return projectRow(row, isStaff, actor.userId);
}

export async function answer(
  actor: ActorContext,
  id: string,
  input: AnswerInput,
): Promise<ProjectedClarification> {
  const text = input.answerText;
  if (text.length < ANSWER_MIN || text.length > ANSWER_MAX) {
    throw new ConflictError("Answer must be 1-1000 characters.");
  }
  const row = await clarificationRepo.findById(id);
  if (!row || row.deletedAt) throw new NotFoundError("Clarification not found.");
  const context = fromContextDbFields(row);
  if (!(await canAnswerInContext(actor, context))) {
    throw new ForbiddenError("Not permitted to answer clarifications in this context.");
  }
  if (row.state === "dismissed") {
    throw new ConflictError("Dismissed clarifications cannot be answered.");
  }

  const wasPending = row.state === "pending";
  const updated = await clarificationRepo.updateAnswer(id, {
    answerText: text,
    answeredByUserId: actor.userId,
    state: "answered",
    answeredAt: row.answeredAt ?? new Date(),
    isPublic: input.isPublic,
  });
  // Only public answers reach peers; private ones notify just the asker (below).
  if (updated.isPublic) {
    await publishClarificationEvent("updated", updated);
  }

  if (wasPending) {
    await notificationDomain
      .createNotification({
        userId: row.askedByUserId,
        type: "clarification_answered",
        params: {
          contextType: row.contextType,
          contextId: row.contextId,
          clarificationId: row.id,
          questionPreview: row.questionText.slice(0, 80),
        },
        linkUrl: buildClarificationLink(context, row.id),
      })
      .catch(() => undefined);
  }
  return projectRow(updated, true, actor.userId);
}

export async function dismiss(
  actor: ActorContext,
  id: string,
): Promise<ProjectedClarification> {
  const row = await clarificationRepo.findById(id);
  if (!row || row.deletedAt) throw new NotFoundError("Clarification not found.");
  const context = fromContextDbFields(row);
  if (!(await canAnswerInContext(actor, context))) {
    throw new ForbiddenError("Not permitted to dismiss clarifications in this context.");
  }
  if (row.state === "answered") {
    throw new ConflictError("Answered clarifications cannot be dismissed.");
  }
  const updated = await clarificationRepo.updateState(id, "dismissed");
  return projectRow(updated, true, actor.userId);
}

export async function deleteClarification(actor: ActorContext, id: string): Promise<void> {
  const row = await clarificationRepo.findById(id);
  if (!row || row.deletedAt) throw new NotFoundError("Clarification not found.");
  const context = fromContextDbFields(row);

  const isStaff = await canSeeAuthor(actor, context);
  const isAsker = row.askedByUserId === actor.userId;
  if (!isStaff && !isAsker) {
    throw new ForbiddenError("Not permitted to delete this clarification.");
  }

  const deleted = await clarificationRepo.softDelete(id);
  // Only peers who could see it (public) need the removal broadcast.
  if (deleted.isPublic) {
    await publishClarificationEvent("deleted", deleted);
  }
}

async function publishClarificationEvent(
  action: ClarificationSSEEvent["action"],
  row: ClarificationRow,
): Promise<void> {
  const masked = projectRow(row, false);
  const event: ClarificationSSEEvent = {
    type: SSE_CLARIFICATION,
    action,
    payload: {
      id: masked.id,
      contextType: masked.contextType,
      contextId: masked.contextId,
      problemId: masked.problemId,
      questionText: masked.questionText,
      answerText: masked.answerText,
      state: masked.state,
      askedByUserId: masked.askedByUserId,
      askedBy: masked.askedBy,
      answeredByUserId: masked.answeredByUserId,
      answeredBy: masked.answeredBy,
      answeredAt: masked.answeredAt ? masked.answeredAt.toISOString() : null,
      createdAt: masked.createdAt.toISOString(),
    },
  };
  await pubsub.publishClarification(row.contextType, row.contextId, event);
}

async function assertProblemInContext(
  context: ClarificationContext,
  problemId: string,
): Promise<void> {
  let belongs = false;
  switch (context.type) {
    case "contest":
      belongs = await contestProblemRepo.existsById(context.contestId, problemId);
      break;
    case "exam":
      belongs = await examProblemRepo.exists(context.examId, problemId);
      break;
    case "assignment":
      belongs = await assessmentProblemRepo.exists(context.assignmentId, problemId);
      break;
  }
  if (!belongs) {
    throw new ConflictError("The selected problem does not belong to this context.");
  }
}

async function assertContextActiveForAsk(context: ClarificationContext): Promise<void> {
  const now = new Date();
  switch (context.type) {
    case "contest": {
      const contest = await contestRepo.findById(context.contestId);
      if (!contest) throw new NotFoundError("Contest not found.");
      if (now < contest.startsAt || now > contest.endsAt) {
        throw new ConflictError("This contest is not currently accepting questions.");
      }
      return;
    }
    case "exam": {
      const exam = await examRepo.findById(context.examId);
      if (!exam) throw new NotFoundError("Exam not found.");
      if (now < exam.startsAt || now > exam.endsAt) {
        throw new ConflictError("This exam is not currently accepting questions.");
      }
      return;
    }
    case "assignment": {
      const assignment = await assessmentRepo.findByIdWithCourseId(context.assignmentId);
      if (!assignment) throw new NotFoundError("Assignment not found.");
      if (now < assignment.opensAt || now > assignment.closesAt) {
        throw new ConflictError("This assignment is not currently accepting questions.");
      }
      return;
    }
  }
}

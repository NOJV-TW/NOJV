import {
  assessmentRepo,
  clarificationRepo,
  contestRepo,
  examRepo,
  type ClarificationRow
} from "@nojv/db";
import { SSE_CLARIFICATION, type ClarificationSSEEvent } from "@nojv/core";
import { pubsub } from "@nojv/redis";

import * as notificationDomain from "../notification";
import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import {
  canAnswerInContext,
  canAskClarification,
  canSeeAuthor,
  type ClarificationContextType
} from "./authz";

export {
  canAnswerInContext,
  canAskClarification,
  canSeeAuthor,
  assertCanAnswerInContext,
  assertCanAskClarification
} from "./authz";
export type { ClarificationContextType } from "./authz";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_COUNT = 5;
const QUESTION_MIN = 10;
const QUESTION_MAX = 1000;
const ANSWER_MIN = 1;
const ANSWER_MAX = 1000;

export interface AskInput {
  contextType: ClarificationContextType;
  contextId: string;
  problemId?: string | null;
  questionText: string;
}

export interface AnswerInput {
  answerText: string;
}

export interface ProjectedClarification extends Omit<
  ClarificationRow,
  "askedBy" | "answeredBy" | "askedByUserId"
> {
  askedByUserId: string | null;
  askedBy: { id: string; username: string; name: string } | null;
  answeredBy: { id: string; username: string; name: string } | null;
}

function normalizeUser(
  u: { id: string; username: string | null; name: string } | null
): { id: string; username: string; name: string } | null {
  if (!u) return null;
  return { id: u.id, username: u.username ?? "", name: u.name };
}

/**
 * Anonymity projection. `askedByUserId` and `askedBy` are masked to
 * `null` for non-staff viewers — including the asker themselves, by
 * design: identifying your own threads on the public board would leak
 * identity to peers watching your screen. Askers recover their own
 * threads via the `clarification_answered` bell notification.
 */
function projectRow(row: ClarificationRow, isStaff: boolean): ProjectedClarification {
  return {
    ...row,
    askedByUserId: isStaff ? row.askedByUserId : null,
    askedBy: isStaff ? normalizeUser(row.askedBy) : null,
    answeredBy: normalizeUser(row.answeredBy)
  };
}

export async function ask(
  actor: ActorContext,
  input: AskInput
): Promise<ProjectedClarification> {
  const text = input.questionText;
  if (text.length < QUESTION_MIN || text.length > QUESTION_MAX) {
    throw new ConflictError("Question must be 10-1000 characters.");
  }
  if (!(await canAskClarification(actor, input.contextType, input.contextId))) {
    throw new ForbiddenError("Only participants may ask clarifications.");
  }
  await assertContextActiveForAsk(input.contextType, input.contextId);

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await clarificationRepo.countInWindow(
    actor.userId,
    input.contextType,
    input.contextId,
    windowStart
  );
  if (recent >= RATE_LIMIT_COUNT) {
    throw new ConflictError("Too many questions in the last 10 minutes.");
  }

  const row = await clarificationRepo.create({
    contextType: input.contextType,
    contextId: input.contextId,
    problemId: input.problemId ?? null,
    askedByUserId: actor.userId,
    questionText: text
  });
  await publishClarificationEvent("created", row);
  // Asker is not staff — even on their own POST they get the masked
  // projection. They recover identity via the bell notification.
  const isStaff = await canSeeAuthor(actor, input.contextType, input.contextId);
  return projectRow(row, isStaff);
}

export async function answer(
  actor: ActorContext,
  id: string,
  input: AnswerInput
): Promise<ProjectedClarification> {
  const text = input.answerText;
  if (text.length < ANSWER_MIN || text.length > ANSWER_MAX) {
    throw new ConflictError("Answer must be 1-1000 characters.");
  }
  const row = await clarificationRepo.findById(id);
  if (!row) throw new NotFoundError("Clarification not found.");
  if (!(await canAnswerInContext(actor, row.contextType, row.contextId))) {
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
    answeredAt: row.answeredAt ?? new Date()
  });
  await publishClarificationEvent("updated", updated);

  // Fire notification only on the first pending → answered transition.
  // Subsequent edits (answered → answered) do not re-notify.
  if (wasPending) {
    try {
      await notificationDomain.createNotification({
        userId: row.askedByUserId,
        type: "clarification_answered",
        params: {
          contextType: row.contextType,
          contextId: row.contextId,
          clarificationId: row.id,
          questionPreview: row.questionText.slice(0, 80)
        },
        linkUrl: buildClarificationLink(row.contextType, row.contextId, row.id)
      });
    } catch {
      // Notification delivery is best-effort; the answer has already
      // landed and the asker can see it via the public board.
    }
  }
  // Answerer is always staff — they see the full row.
  return projectRow(updated, true);
}

export async function dismiss(
  actor: ActorContext,
  id: string
): Promise<ProjectedClarification> {
  const row = await clarificationRepo.findById(id);
  if (!row) throw new NotFoundError("Clarification not found.");
  if (!(await canAnswerInContext(actor, row.contextType, row.contextId))) {
    throw new ForbiddenError("Not permitted to dismiss clarifications in this context.");
  }
  if (row.state === "answered") {
    throw new ConflictError("Answered clarifications cannot be dismissed.");
  }
  const updated = await clarificationRepo.updateState(id, "dismissed");
  await publishClarificationEvent("dismissed", updated);
  return projectRow(updated, true);
}

export async function listForViewer(
  viewer: ActorContext,
  contextType: ClarificationContextType,
  contextId: string,
  since?: Date
): Promise<ProjectedClarification[]> {
  const rows = await clarificationRepo.listForContext(contextType, contextId, since);
  const isStaff = await canSeeAuthor(viewer, contextType, contextId);
  return rows.map((r) => projectRow(r, isStaff));
}

/**
 * Build a deep link for the `clarification_answered` notification. Uses
 * cuid URLs per the CUID URL unification convention (contestId / examId
 * / assessmentId, never slug).
 */
export function buildClarificationLink(
  contextType: ClarificationContextType,
  contextId: string,
  id: string
): string {
  switch (contextType) {
    case "contest":
      return `/contests/${contextId}#clarification-${id}`;
    case "exam":
      return `/exams/${contextId}#clarification-${id}`;
    case "assignment":
      return `/assignments/${contextId}#clarification-${id}`;
  }
}

async function publishClarificationEvent(
  action: ClarificationSSEEvent["action"],
  row: ClarificationRow
): Promise<void> {
  try {
    // Publish the staff projection; the SSE bridge re-masks per-subscriber
    // in a later task (Task 11). For now subscribers receive the full
    // payload — that is acceptable because only /api/events/stream with
    // the correct subscription filters delivers these messages, and the
    // HTTP API list/detail endpoints still enforce per-request projection.
    const staff = projectRow(row, true);
    const event: ClarificationSSEEvent = {
      type: SSE_CLARIFICATION,
      action,
      payload: {
        id: staff.id,
        contextType: staff.contextType,
        contextId: staff.contextId,
        problemId: staff.problemId,
        questionText: staff.questionText,
        answerText: staff.answerText,
        state: staff.state,
        askedByUserId: staff.askedByUserId,
        askedBy: staff.askedBy,
        answeredByUserId: staff.answeredByUserId,
        answeredAt: staff.answeredAt ? staff.answeredAt.toISOString() : null,
        createdAt: staff.createdAt.toISOString()
      }
    };
    await pubsub.publishClarification(row.contextType, row.contextId, event);
  } catch {
    // Best-effort; the DB write has already happened.
  }
}

/**
 * Reject POST outside the context's active window. Reads remain open
 * so historical review works after the context ends.
 */
async function assertContextActiveForAsk(
  contextType: ClarificationContextType,
  contextId: string
): Promise<void> {
  const now = new Date();
  switch (contextType) {
    case "contest": {
      const contest = await contestRepo.findById(contextId);
      if (!contest) throw new NotFoundError("Contest not found.");
      if (now < contest.startsAt || now > contest.endsAt) {
        throw new ConflictError("This contest is not currently accepting questions.");
      }
      return;
    }
    case "exam": {
      const exam = await examRepo.findById(contextId);
      if (!exam) throw new NotFoundError("Exam not found.");
      if (now < exam.startsAt || now > exam.endsAt) {
        throw new ConflictError("This exam is not currently accepting questions.");
      }
      return;
    }
    case "assignment": {
      const assessment = await assessmentRepo.findByIdWithCourseId(contextId);
      if (!assessment) throw new NotFoundError("Assignment not found.");
      if (now < assessment.opensAt || now > assessment.closesAt) {
        throw new ConflictError("This assignment is not currently accepting questions.");
      }
      return;
    }
  }
}

import { clarificationRepo, type ClarificationRow } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { assertCanViewClarifications, canSeeAuthor } from "./permissions";
import { toContextDbFields, type ClarificationContext } from "./types";

export interface ProjectedClarification extends Omit<
  ClarificationRow,
  "askedBy" | "answeredBy" | "askedByUserId"
> {
  askedByUserId: string | null;
  askedBy: { id: string; username: string; name: string } | null;
  answeredBy: { id: string; username: string; name: string } | null;
}

function normalizeUser(
  u: { id: string; username: string | null; name: string } | null,
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
export function projectRow(row: ClarificationRow, isStaff: boolean): ProjectedClarification {
  return {
    ...row,
    askedByUserId: isStaff ? row.askedByUserId : null,
    askedBy: isStaff ? normalizeUser(row.askedBy) : null,
    answeredBy: normalizeUser(row.answeredBy),
  };
}

export async function listForViewer(
  viewer: ActorContext,
  context: ClarificationContext,
  since?: Date,
): Promise<ProjectedClarification[]> {
  await assertCanViewClarifications(viewer, context);
  const db = toContextDbFields(context);
  const rows = await clarificationRepo.listForContext(db.contextType, db.contextId, since);
  const isStaff = await canSeeAuthor(viewer, context);
  return rows.map((r) => projectRow(r, isStaff));
}

/**
 * Build a deep link for the `clarification_answered` notification. Uses
 * cuid URLs per the CUID URL unification convention (contestId / examId
 * / assignmentId, never slug).
 */
export function buildClarificationLink(context: ClarificationContext, id: string): string {
  switch (context.type) {
    case "contest":
      return `/contests/${context.contestId}#clarification-${id}`;
    case "exam":
      return `/exams/${context.examId}#clarification-${id}`;
    case "assignment":
      return `/assignments/${context.assignmentId}#clarification-${id}`;
  }
}

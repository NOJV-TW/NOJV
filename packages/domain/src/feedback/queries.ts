import { submissionFeedbackRepo } from "@nojv/db";

import { isContextClosed } from "../shared/context-window";
import { toContextDbFields, type FeedbackContext } from "./types";

/**
 * All feedback rows for a context. Staff read — no close-gate; staff may
 * view feedback while drafting it, before the context closes.
 */
export async function listFeedbackForContext(context: FeedbackContext) {
  return submissionFeedbackRepo.findForContext(toContextDbFields(context));
}

/**
 * Feedback visible to a student. Returns `[]` while the context is still
 * open — students may only see feedback once the context has closed, so we
 * gate on `isContextClosed` and skip the repo entirely while open.
 */
export async function getFeedbackForStudent(studentUserId: string, context: FeedbackContext) {
  if (!(await isContextClosed(context))) {
    return [];
  }
  return submissionFeedbackRepo.findForStudentInContext(
    studentUserId,
    toContextDbFields(context),
  );
}

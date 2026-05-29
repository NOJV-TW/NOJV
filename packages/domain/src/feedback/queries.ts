import { submissionFeedbackRepo } from "@nojv/db";

import { isContextClosed } from "../shared/context-window";
import { toContextDbFields, type FeedbackContext } from "./types";

export async function listFeedbackForContext(context: FeedbackContext) {
  return submissionFeedbackRepo.findForContext(toContextDbFields(context));
}

export async function getFeedbackForStudent(studentUserId: string, context: FeedbackContext) {
  if (!(await isContextClosed(context))) {
    return [];
  }
  return submissionFeedbackRepo.findForStudentInContext(
    studentUserId,
    toContextDbFields(context),
  );
}

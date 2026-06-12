import { describe, expect, it } from "vitest";

import { ForbiddenError, submissionDomain } from "@nojv/domain";

const { assertRejudgeWorkflowId } = submissionDomain;

describe("assertRejudgeWorkflowId — rejudge cancel/progress 前綴守衛 (P0)", () => {
  it.each([
    "submission-pending-sweeper",
    "contest-lifecycle-ctst_1",
    "exam-auto-close-exam_1",
    "judge-sub_1",
    "plagiarism-contest-ctst_1",
    "plagiarism-exam-exam_1",
    "rejudgex-no-boundary",
    "",
  ])("拒絕非 rejudge workflowId: %s", (id) => {
    expect(() => assertRejudgeWorkflowId(id)).toThrow(ForbiddenError);
  });

  it.each(["rejudge-prob_1-0190abcdef", "rejudge-sub_1-deadbeef", "rejudge-exam_1-uuid"])(
    "接受 rejudge workflowId: %s",
    (id) => {
      expect(() => assertRejudgeWorkflowId(id)).not.toThrow();
    },
  );
});

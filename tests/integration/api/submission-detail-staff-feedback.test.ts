import { describe, expect, it } from "vitest";

import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";
import type { Prisma } from "@nojv/db";

import { submissionDomain, type ActorContext } from "@nojv/domain";

const { getSubmissionDetail, listProblemSubmissions } = submissionDomain;

function asActor(user: {
  id: string;
  username: string;
  email: string;
  name: string;
  platformRole: string;
}): ActorContext {
  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    displayName: user.name,
    platformRole: user.platformRole as ActorContext["platformRole"],
  };
}

const VERDICT_WITH_STAFF: Prisma.InputJsonValue = {
  accepted: false,
  feedback: "off by one",
  runtimeMs: 12,
  score: 0,
  verdict: "wrong_answer",
  caseResults: [
    {
      index: 0,
      verdict: "WA",
      timeMs: 5,
      stdout: "1 2",
      staffFeedback: "OPERATOR_SECRET_DIAGNOSTIC",
    },
    { index: 1, verdict: "AC", timeMs: 3, stdout: "3 4" },
  ],
};

describe("getSubmissionDetail — staffFeedback server-side strip", () => {
  it("OWNER (non-staff) viewing their own submission gets NO staffFeedback in any case", async () => {
    const owner = await createTestUser();
    const problem = await createTestProblem({ authorId: owner.id });
    const submission = await createTestSubmission({
      userId: owner.id,
      problemId: problem.id,
      status: "wrong_answer",
      verdictDetail: VERDICT_WITH_STAFF,
    });

    const detail = await getSubmissionDetail(asActor(owner), submission.id);

    expect(detail.viewerIsStaff).toBe(false);
    expect(detail.result).not.toBeNull();
    expect(JSON.stringify(detail.result)).not.toContain("staffFeedback");
    expect(JSON.stringify(detail.result)).not.toContain("OPERATOR_SECRET_DIAGNOSTIC");
    for (const cr of detail.result!.caseResults ?? []) {
      expect(cr).not.toHaveProperty("staffFeedback");
    }
  });

  it("ADMIN (staff) viewing someone else's submission receives staffFeedback unmodified", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser({ platformRole: "admin" });
    const problem = await createTestProblem({ authorId: owner.id });
    const submission = await createTestSubmission({
      userId: owner.id,
      problemId: problem.id,
      status: "wrong_answer",
      verdictDetail: VERDICT_WITH_STAFF,
    });

    const detail = await getSubmissionDetail(asActor(admin), submission.id);

    expect(detail.viewerIsStaff).toBe(true);
    expect(detail.result).not.toBeNull();
    expect(detail.result!.caseResults![0]!.staffFeedback).toBe("OPERATOR_SECRET_DIAGNOSTIC");
  });

  it("ADMIN viewing their OWN submission is not 'staff' for this gate → still stripped", async () => {
    const admin = await createTestUser({ platformRole: "admin" });
    const problem = await createTestProblem({ authorId: admin.id });
    const submission = await createTestSubmission({
      userId: admin.id,
      problemId: problem.id,
      status: "wrong_answer",
      verdictDetail: VERDICT_WITH_STAFF,
    });

    const detail = await getSubmissionDetail(asActor(admin), submission.id);

    expect(detail.viewerIsStaff).toBe(false);
    expect(JSON.stringify(detail.result)).not.toContain("staffFeedback");
  });
});

describe("listProblemSubmissions — staffFeedback server-side strip", () => {
  it("never returns staffFeedback (own submissions only, never a staff view)", async () => {
    const owner = await createTestUser();
    const problem = await createTestProblem({ authorId: owner.id });
    await createTestSubmission({
      userId: owner.id,
      problemId: problem.id,
      status: "wrong_answer",
      verdictDetail: VERDICT_WITH_STAFF,
    });

    const list = await listProblemSubmissions(owner.id, problem.id);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("staffFeedback");
    expect(JSON.stringify(list)).not.toContain("OPERATOR_SECRET_DIAGNOSTIC");
  });
});

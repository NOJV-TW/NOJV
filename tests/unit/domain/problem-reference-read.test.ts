import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Storage from "@nojv/storage";

const h = vi.hoisted(() => ({
  findSubmission: vi.fn(),
  findForActor: vi.fn(),
  findForDetail: vi.fn(),
  detailCandidate: vi.fn(),
  latest: vi.fn(),
  findProblem: vi.fn(),
  staffRead: vi.fn(),
  sources: vi.fn(),
  activeExam: vi.fn(),
}));
vi.mock("@nojv/db", () => ({
  examSessionRepo: { findActiveForUser: h.activeExam },
  gradingRepo: { findAllocation: vi.fn(async () => null) },
  problemRepo: { findById: h.findProblem },
  courseProblemRepo: { hasStaffAccess: h.staffRead },
  submissionRepo: {
    findById: h.findSubmission,
    findByIdForUserRead: h.findForActor,
    findByIdForDetail: h.findForDetail,
    findByIdForStaffDetailCandidate: h.detailCandidate,
    findLatestReferenceForProblem: h.latest,
  },
}));
vi.mock("@nojv/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof Storage>()),
  getSubmissionSources: h.sources,
}));
vi.mock("../../../packages/application/src/shared/storage-singleton", () => ({
  storage: () => ({}),
}));

import {
  getProblemReferenceSolution,
  getSubmissionForActor,
  getSubmissionDetail,
} from "../../../packages/application/src/submission/queries";
import { canOperateOnSubmission } from "../../../packages/application/src/submission/permissions";

const actor = {
  userId: "ta",
  username: "ta",
  platformRole: "student" as const,
  email: "ta@example.com",
  displayName: "TA",
};
const problem = {
  id: "p",
  authorId: "owner",
  visibility: "private",
  storageGeneration: 2,
  referenceSolutionSubmissionId: "ref",
};
const reference = {
  id: "ref",
  userId: "owner",
  problemId: "p",
  contextType: "practice",
  contextId: null,
  isReferenceSolution: true,
  sampleOnly: false,
  assessmentId: null,
  contestId: null,
  courseId: null,
  examId: null,
  participationId: null,
  referenceProblemStorageGeneration: 2,
  sourceStorage: { key: "source", size: 1, sha256: "a".repeat(64) },
  status: "accepted",
  score: 100,
  runtimeMs: 1,
  memoryKb: 1,
  createdAt: new Date(),
  language: "python",
};
beforeEach(() => {
  vi.clearAllMocks();
  h.activeExam.mockResolvedValue(null);
  h.findProblem.mockResolvedValue(problem);
  h.findSubmission.mockResolvedValue(reference);
  h.findForActor.mockResolvedValue(null);
  h.findForDetail.mockResolvedValue(null);
  h.detailCandidate.mockResolvedValue({
    ...reference,
    verdictDetailStorage: null,
    problem: {
      id: "p",
      title: "Problem",
      displayId: 1,
      type: "full_source",
      testcaseSets: [{ weight: 100 }],
      advancedConfig: null,
    },
    user: { username: "owner", name: "Owner" },
    contest: null,
    assessment: null,
    exam: null,
  });
  h.latest.mockResolvedValue(reference);
  h.staffRead.mockResolvedValue(true);
  h.sources.mockResolvedValue([{ path: "main.py", content: "print(1)" }]);
});

describe("problem reference read boundaries", () => {
  it("denies otherwise authorized reference reads during an active exam", async () => {
    h.activeExam.mockResolvedValue({ id: "exam-session" });
    await expect(getSubmissionForActor(actor, "ref")).rejects.toThrow("Submission not found.");
    await expect(getSubmissionDetail(actor, "ref")).rejects.toThrow("Submission not found.");
    expect(h.sources).not.toHaveBeenCalled();
  });
  it("reads verified sources for authorized content staff, including archived-course readers", async () => {
    await expect(getProblemReferenceSolution(actor, "p")).resolves.toMatchObject({
      status: "verified",
      submissionId: "ref",
      sourceFiles: [{ path: "main.py", content: "print(1)" }],
    });
    expect(h.staffRead).toHaveBeenCalledWith("p", "ta");
  });
  it("rechecks resource access before reading the reference or its sources", async () => {
    h.staffRead.mockResolvedValue(false);
    await expect(getProblemReferenceSolution(actor, "p")).rejects.toThrow(/Problem not found/);
    expect(h.findSubmission).not.toHaveBeenCalled();
    expect(h.sources).not.toHaveBeenCalled();
  });
  it("does not treat a former generation as a verified reference", async () => {
    h.findSubmission.mockResolvedValue({ ...reference, referenceProblemStorageGeneration: 1 });
    await expect(getProblemReferenceSolution(actor, "p")).resolves.toMatchObject({
      status: "failed",
      sourceFiles: [],
    });
    expect(h.sources).not.toHaveBeenCalled();
  });
  it.each([
    { problemId: "other" },
    { isReferenceSolution: false },
    { sampleOnly: true },
    { assessmentId: "assessment" },
    { courseId: "course" },
    { contestId: "contest" },
    { examId: "exam" },
    { participationId: "participation" },
  ])("excludes non-reference or unrelated latest/verified candidates: %o", async (fields) => {
    h.findSubmission.mockResolvedValue({ ...reference, ...fields });
    h.latest.mockResolvedValue({ ...reference, ...fields });
    await expect(getProblemReferenceSolution(actor, "p")).resolves.toMatchObject({
      status: "not_configured",
      sourceFiles: [],
      lastSubmission: null,
      submissionId: null,
    });
    expect(h.sources).not.toHaveBeenCalled();
  });
  it("allows reference polling and full detail without granting ordinary rejudge rights", async () => {
    await expect(getSubmissionForActor(actor, "ref")).resolves.toEqual(reference);
    await expect(getSubmissionDetail(actor, "ref")).resolves.toMatchObject({
      id: "ref",
      viewerIsStaff: true,
      sources: [{ path: "main.py", content: "print(1)" }],
    });
    await expect(canOperateOnSubmission(actor, reference)).resolves.toBe(false);
  });
  it.each([
    { isReferenceSolution: false },
    { sampleOnly: true },
    { assessmentId: "assessment" },
    { courseId: "course" },
    { contestId: "contest" },
    { examId: "exam" },
    { participationId: "participation" },
  ])("does not broaden polling access to other submissions: %o", async (fields) => {
    h.findSubmission.mockResolvedValue({ ...reference, ...fields });
    await expect(getSubmissionForActor(actor, "ref")).rejects.toThrow(/Submission not found/);
  });
  it("does not broaden ordinary practice detail access", async () => {
    h.findSubmission.mockResolvedValue({ ...reference, isReferenceSolution: false });
    await expect(getSubmissionDetail(actor, "ref")).rejects.toThrow(/Submission not found/);
    expect(h.sources).not.toHaveBeenCalled();
  });
  it("revoked submitters cannot keep reading reference content through their own submission ID", async () => {
    h.findForActor.mockResolvedValue({ ...reference, userId: actor.userId });
    h.staffRead.mockResolvedValue(false);
    await expect(getSubmissionForActor(actor, "ref")).rejects.toThrow(/Submission not found/);
    await expect(getSubmissionDetail(actor, "ref")).rejects.toThrow(/Submission not found/);
    expect(h.sources).not.toHaveBeenCalled();
  });
});

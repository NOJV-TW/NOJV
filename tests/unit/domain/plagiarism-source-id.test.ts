import { expect, it, vi } from "vitest";

const { findMany, getSources } = vi.hoisted(() => ({
  findMany: vi.fn(),
  getSources: vi.fn(),
}));
vi.mock("@nojv/db", () => ({
  assessmentRepo: {},
  contestRepo: {},
  examRepo: {},
  plagiarismRepo: {},
  plagiarismTriggerLogRepo: {},
  runTransaction: vi.fn(),
  submissionRepo: { findMany },
}));
vi.mock("../../../packages/application/src/submission/queries", () => ({
  getSubmissionSources: getSources,
}));

import { getPlagiarismSourceCode } from "../../../packages/application/src/plagiarism/queries";

it("returns the ID of the submission whose sources are shown", async () => {
  const files = [{ path: "main.cpp", content: "int main() {}" }];
  findMany.mockResolvedValue([{ id: "submission-123" }]);
  getSources.mockResolvedValue(files);
  await expect(
    getPlagiarismSourceCode({ type: "contest", id: "contest-1" }, "u1", "p1"),
  ).resolves.toEqual({ submissionId: "submission-123", files });
  expect(getSources).toHaveBeenCalledWith("submission-123");
  findMany.mockResolvedValue([]);
  await expect(
    getPlagiarismSourceCode({ type: "contest", id: "contest-1" }, "u1", "p1"),
  ).resolves.toBeNull();
});

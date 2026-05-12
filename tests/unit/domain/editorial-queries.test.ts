import { beforeEach, describe, expect, it, vi } from "vitest";

const { submissionCount, editorialUpsert } = vi.hoisted(() => ({
  submissionCount: vi.fn(),
  editorialUpsert: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: { count: submissionCount },
  editorialRepo: { upsert: editorialUpsert },
}));

import { editorialDomain } from "@nojv/domain";

const { hasUserAcProblem, upsertEditorial } = editorialDomain;

beforeEach(() => {
  submissionCount.mockReset();
  editorialUpsert.mockReset();
});

describe("hasUserAcProblem", () => {
  it("returns true when the user has ≥1 accepted non-sample submission", async () => {
    submissionCount.mockResolvedValue(3);
    await expect(hasUserAcProblem("usr_1", "prob_1")).resolves.toBe(true);
  });

  it("returns false when the user has zero accepted non-sample submissions", async () => {
    submissionCount.mockResolvedValue(0);
    await expect(hasUserAcProblem("usr_1", "prob_1")).resolves.toBe(false);
  });

  it("filters on status='accepted' and sampleOnly=false", async () => {
    submissionCount.mockResolvedValue(1);
    await hasUserAcProblem("usr_1", "prob_1");
    expect(submissionCount).toHaveBeenCalledWith({
      userId: "usr_1",
      problemId: "prob_1",
      status: "accepted",
      sampleOnly: false,
    });
  });
});

describe("upsertEditorial", () => {
  it("delegates to editorialRepo.upsert with composite-key payload", async () => {
    const row = { id: "ed_1" };
    editorialUpsert.mockResolvedValue(row);

    const result = await upsertEditorial("usr_1", "prob_1", "markdown body", "cpp");

    expect(result).toBe(row);
    expect(editorialUpsert).toHaveBeenCalledWith("usr_1", "prob_1", {
      content: "markdown body",
      language: "cpp",
    });
  });

  it("permits the same user to post in a different language (separate call)", async () => {
    editorialUpsert.mockResolvedValue({});
    await upsertEditorial("usr_1", "prob_1", "cpp body", "cpp");
    await upsertEditorial("usr_1", "prob_1", "python body", "python");

    expect(editorialUpsert).toHaveBeenNthCalledWith(1, "usr_1", "prob_1", {
      content: "cpp body",
      language: "cpp",
    });
    expect(editorialUpsert).toHaveBeenNthCalledWith(2, "usr_1", "prob_1", {
      content: "python body",
      language: "python",
    });
  });
});

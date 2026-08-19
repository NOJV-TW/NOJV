import { beforeEach, describe, expect, it, vi } from "vitest";

const { listRecentForContext } = vi.hoisted(() => ({
  listRecentForContext: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: { listRecentForContext },
}));

import { submissionDomain } from "@nojv/application";

describe("listRecentContextSubmissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecentForContext.mockResolvedValue([]);
  });

  it("is exposed as the context-scoped live submission query", () => {
    expect(submissionDomain.listRecentContextSubmissions).toBeTypeOf("function");
  });

  it.each([
    ["assignment", "assignment_1"],
    ["exam", "exam_1"],
  ] as const)("scopes recent rows to the %s context", async (type, id) => {
    await submissionDomain.listRecentContextSubmissions({
      context: { type, id },
      limit: 500,
    });

    expect(listRecentForContext).toHaveBeenCalledWith({
      context: { type, id },
      limit: 100,
    });
  });

  it("serializes timestamps for the live feed boundary", async () => {
    listRecentForContext.mockResolvedValue([
      {
        id: "sub_1",
        ipAddress: "203.0.113.42",
        createdAt: new Date("2026-08-19T12:34:56.000Z"),
        language: "cpp17",
        score: 80,
        status: "accepted",
        problem: { id: "p1", title: "A + B" },
        user: { id: "u1", name: "Alice", username: "alice" },
      },
    ]);

    const rows = await submissionDomain.listRecentContextSubmissions({
      context: { type: "assignment", id: "assignment_1" },
    });

    expect(rows[0]).toMatchObject({
      id: "sub_1",
      ipAddress: "203.0.113.42",
      createdAt: "2026-08-19T12:34:56.000Z",
      language: "cpp17",
      score: 80,
      status: "accepted",
      problem: { id: "p1", title: "A + B" },
      user: { id: "u1", name: "Alice", username: "alice" },
    });
  });
});

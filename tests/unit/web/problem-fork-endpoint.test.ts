import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forkProblemRecord: vi.fn(),
  requireApiAuth: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({ requireApiAuth: mocks.requireApiAuth }));
vi.mock("$lib/server/shared/api-handler", () => ({
  writeApiHandler: (handler: (event: RequestEvent) => Promise<Response>) => handler,
}));
vi.mock("@nojv/application", () => ({
  problemDomain: { forkProblemRecord: mocks.forkProblemRecord },
}));

const { POST } = await import("$lib/../routes/api/problems/[id]/fork/+server");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiAuth.mockReturnValue({
    platformRole: "teacher",
    userId: "teacher_1",
    username: "teacher",
  });
  mocks.forkProblemRecord.mockResolvedValue({ id: "fork_1" });
});

describe("POST /api/problems/[id]/fork", () => {
  it("returns the private fork id", async () => {
    const response = await POST({ params: { id: "problem_1" } } as never);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "fork_1" });
    expect(mocks.forkProblemRecord).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "teacher_1" }),
      "problem_1",
    );
  });

  it("requires authentication before forking", async () => {
    mocks.requireApiAuth.mockImplementation(() => {
      throw new Error("Authentication required");
    });
    await expect(POST({ params: { id: "problem_1" } } as never)).rejects.toThrow(
      "Authentication required",
    );
    expect(mocks.forkProblemRecord).not.toHaveBeenCalled();
  });
});

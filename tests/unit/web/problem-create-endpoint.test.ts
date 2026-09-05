import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  canAuthor: vi.fn(),
  canCreateAdvanced: vi.fn(),
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  apiRateLimiter: { consume: async () => "allowed" },
  writeApiRateLimiter: { consume: async () => "allowed" },
  registryTokenRateLimiter: { consume: async () => "allowed" },
}));
vi.mock("$lib/server/auth", async (original) => ({
  ...(await original<typeof import("$lib/server/auth")>()),
  requireApiAuth: () => ({ userId: "teacher_1", platformRole: "teacher" }),
}));
vi.mock("@nojv/application", async (original) => ({
  ...(await original<typeof import("@nojv/application")>()),
  problemDomain: {
    createProblemRecord: mocks.create,
    canAuthorProblems: mocks.canAuthor,
    canCreateAdvancedProblems: mocks.canCreateAdvanced,
  },
}));
const { POST } = await import("$lib/../routes/api/problems/+server");

function event(body: string): RequestEvent {
  return {
    request: new Request("http://localhost/api/problems", { method: "POST", body }),
    url: new URL("http://localhost/api/problems"),
    locals: { sessionUser: { id: "teacher_1" }, requestId: "request_1" },
  } as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "problem_1" });
  mocks.canAuthor.mockResolvedValue(true);
  mocks.canCreateAdvanced.mockResolvedValue(true);
});

describe("POST /api/problems", () => {
  it.each(["{", '{"mode":"typo"}', '{"mode":"standard","unknown":true}', "null"])(
    "rejects invalid body %s without creating a draft",
    async (body) => {
      const response = await POST(event(body));
      expect(response.status).toBe(400);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it("keeps stream overflow a 413 without creating a draft", async () => {
    const response = await POST(event(JSON.stringify({ mode: "x".repeat(1024 * 1024) })));
    expect(response.status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ["{}", "full_source"],
    ['{"mode":"standard"}', "full_source"],
    ['{"mode":"advanced"}', "special_env"],
  ])("creates the explicitly supported mode from %s", async (body, type) => {
    const response = await POST(event(body));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ userId: "teacher_1" }),
      expect.objectContaining({ type }),
    );
  });

  it("preserves advanced authoring permission", async () => {
    mocks.canCreateAdvanced.mockResolvedValue(false);
    const response = await POST(event('{"mode":"advanced"}'));
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

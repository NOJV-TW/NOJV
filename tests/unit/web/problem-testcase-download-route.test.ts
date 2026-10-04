import { error, type RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportTestcaseArchive: vi.fn(),
  requireApiAuth: vi.fn(),
}));

vi.mock("@nojv/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nojv/application")>();
  return {
    ...actual,
    problemDomain: {
      ...actual.problemDomain,
      exportTestcaseArchive: mocks.exportTestcaseArchive,
    },
  };
});
vi.mock("$lib/server/auth", () => ({ requireApiAuth: mocks.requireApiAuth }));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  apiRateLimiter: { consume: async () => "allowed" },
  writeApiRateLimiter: { consume: async () => "allowed" },
  registryTokenRateLimiter: { consume: async () => "allowed" },
}));
vi.mock("$lib/server/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));

import { NotFoundError } from "@nojv/application";
import { GET } from "../../../apps/web/src/routes/api/problems/[id]/testcases/download/+server";

const actor = { userId: "usr_staff", username: "staff", platformRole: "student" as const };

function event(): Parameters<typeof GET>[0] {
  const url = new URL("https://nojv.test/api/problems/prob_1/testcases/download");
  return {
    url,
    params: { id: "prob_1" },
    request: new Request(url),
    locals: { requestId: "testcase-download", sessionUser: { id: actor.userId } },
  } as unknown as RequestEvent as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiAuth.mockReturnValue(actor);
});

describe("GET /api/problems/[id]/testcases/download", () => {
  it("streams the testcase archive as a ZIP attachment", async () => {
    mocks.exportTestcaseArchive.mockResolvedValue({
      fileName: "problem-42-testcases.zip",
      body: new Blob([new Uint8Array([0x50, 0x4b])]).stream(),
    });

    const response = await GET(event());

    expect(mocks.exportTestcaseArchive).toHaveBeenCalledWith(actor, "prob_1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="problem-42-testcases.zip"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b]));
  });

  it("answers not found when the actor cannot read the problem content", async () => {
    mocks.exportTestcaseArchive.mockRejectedValue(
      new NotFoundError("Problem not found: prob_1"),
    );

    const response = await GET(event());

    expect(response.status).toBe(404);
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("requires authentication before reading any testcases", async () => {
    mocks.requireApiAuth.mockImplementation(() => error(401, "Authentication required"));

    const response = await GET(event());

    expect(response.status).toBe(401);
    expect(mocks.exportTestcaseArchive).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Application from "@nojv/application";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  listRequests: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@nojv/application", async (importOriginal) => {
  const actual = await importOriginal<typeof Application>();
  return {
    ...actual,
    problemDomain: {
      ...actual.problemDomain,
      listPublicProblemPublicationRequests: mocks.listRequests,
    },
  };
});

import { load } from "$lib/../routes/(app)/admin/problem-publications/+page.server";

const actor = { userId: "admin-1", username: "admin", platformRole: "admin" };

function requestRecord(
  id: string,
  status: "pending" | "approved" | "rejected",
  createdAt: string,
) {
  return {
    id,
    status,
    reviewNote: null,
    createdAt: new Date(createdAt),
    reviewedAt: status === "pending" ? null : new Date("2026-09-20T00:00:00.000Z"),
    problem: {
      id: `problem-${id}`,
      displayId: 42,
      title: `Problem ${id}`,
      author: { id: "author-1", username: "owner", name: "Owner" },
    },
    requestedBy: { id: "requester-1", username: "ta", name: "Teaching assistant" },
    publishedProblemId: status === "approved" ? `public-${id}` : null,
  };
}

function event(search = "") {
  return { url: new URL(`http://localhost/admin/problem-publications${search}`) } as never;
}

describe("problem publications page loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockReturnValue(actor);
    mocks.listRequests.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("loads pending requests by default", async () => {
    mocks.listRequests.mockResolvedValue({
      items: [requestRecord("pending-1", "pending", "2026-09-19T00:00:00.000Z")],
      nextCursor: null,
    });

    const result = await load(event());

    expect(result.status).toBe("pending");
    expect(result.requests.map((request) => request.status)).toEqual(["pending"]);
    expect(mocks.listRequests).toHaveBeenCalledWith(actor, { status: "pending", limit: 100 });
  });

  it("combines approved and rejected requests in newest-first order for the closed view", async () => {
    mocks.listRequests.mockImplementation(
      async (_actor: unknown, options: { status: "approved" | "rejected" }) => ({
        items:
          options.status === "approved"
            ? [requestRecord("approved-1", "approved", "2026-09-17T00:00:00.000Z")]
            : [requestRecord("rejected-1", "rejected", "2026-09-18T00:00:00.000Z")],
        nextCursor: null,
      }),
    );

    const result = await load(event("?status=closed"));

    expect(result.status).toBe("closed");
    expect(result.requests.map((request) => request.status)).toEqual(["rejected", "approved"]);
    expect(mocks.listRequests).toHaveBeenCalledTimes(2);
    expect(mocks.listRequests).toHaveBeenCalledWith(actor, { status: "approved", limit: 100 });
    expect(mocks.listRequests).toHaveBeenCalledWith(actor, { status: "rejected", limit: 100 });
  });
});

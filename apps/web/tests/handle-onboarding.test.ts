import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const getSession = vi.fn();
const headers = vi.fn(() => Promise.resolve(new Headers()));
const redirect = vi.fn((location: string) => {
  throw new Error(`REDIRECT:${location}`);
});
const getActorContext = vi.fn();

vi.mock("next/headers", () => ({
  headers
}));

vi.mock("next/navigation", () => ({
  redirect
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession
    }
  }
}));

vi.mock("@/lib/auth-onboarding", async () => {
  return await vi.importActual("../src/lib/auth-onboarding");
});

vi.mock("@/lib/server/actor-context", () => ({
  getActorContext
}));

describe("required handle onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("redirects authenticated users without a handle to the completion page", async () => {
    getSession.mockResolvedValue({
      user: {
        email: "oauth-user@nojv.local",
        id: "usr_oauth",
        name: "OAuth User",
        platformRole: "student"
      }
    });

    const { requireAuth } = await import("../src/lib/server/authorization/guards");

    await expect(requireAuth()).rejects.toThrowError("REDIRECT:/auth/complete-profile");
    expect(redirect).toHaveBeenCalledWith("/auth/complete-profile");
  });

  it("returns the actor context once the handle is present", async () => {
    getSession.mockResolvedValue({
      user: {
        email: "complete@nojv.local",
        id: "usr_complete",
        name: "Complete User",
        platformRole: "teacher",
        username: "complete_user"
      }
    });

    const { requireAuth } = await import("../src/lib/server/authorization/guards");

    await expect(requireAuth()).resolves.toEqual({
      displayName: "Complete User",
      email: "complete@nojv.local",
      handle: "complete_user",
      platformRole: "teacher",
      userId: "usr_complete"
    });
  });

  it("rejects protected API requests for authenticated users without a handle", async () => {
    getActorContext.mockResolvedValue({
      displayName: "OAuth User",
      email: "oauth-user@nojv.local",
      handle: null,
      platformRole: "student",
      userId: "usr_oauth"
    });

    const handler = vi.fn(() => Promise.resolve(NextResponse.json({ ok: true })));
    const { withAuth } = await import("../src/lib/server/api-handler");
    const response = await withAuth(handler)(new Request("http://localhost/api/courses"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Complete your NOJV handle before using the API."
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimOnboardingTour, requireApiAuth } = vi.hoisted(() => ({
  claimOnboardingTour: vi.fn(),
  requireApiAuth: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({ requireApiAuth }));
vi.mock("$lib/server/shared/api-handler", () => ({
  writeApiHandler: (handler: (event: RequestEvent) => Promise<Response>) => handler,
}));
vi.mock("@nojv/application", () => ({
  userDomain: { claimOnboardingTour },
}));

const { POST } = await import("$lib/../routes/api/account/onboarding-tour/+server");

function eventFor(platformRole: "admin" | "student" | "teacher") {
  return {
    locals: {
      sessionUser: { id: `usr_${platformRole}`, platformRole },
    },
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApiAuth.mockReturnValue({ userId: "authenticated" });
  claimOnboardingTour.mockResolvedValue(true);
});

describe("onboarding tour claim API", () => {
  it.each(["student", "teacher"] as const)("claims the stored %s tour", async (role) => {
    const response = await POST(eventFor(role));

    expect(await response.json()).toEqual({ show: true });
    expect(claimOnboardingTour).toHaveBeenCalledWith(`usr_${role}`, role);
  });

  it("does not start onboarding for stored admin accounts", async () => {
    const response = await POST(eventFor("admin"));

    expect(await response.json()).toEqual({ show: false });
    expect(claimOnboardingTour).not.toHaveBeenCalled();
  });
});

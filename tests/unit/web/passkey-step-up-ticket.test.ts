import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  consumeTicketMock,
  markAdminSessionMfaMock,
  markStepUpFreshMock,
  markTokenPageMfaMock,
  cookieDeleteMock,
} = vi.hoisted(() => ({
  consumeTicketMock: vi.fn(),
  markAdminSessionMfaMock: vi.fn(),
  markStepUpFreshMock: vi.fn(),
  markTokenPageMfaMock: vi.fn(),
  cookieDeleteMock: vi.fn(),
}));

vi.mock("@nojv/application", () => ({
  consumeStepUpHandoffTicket: consumeTicketMock,
  markAdminSessionMfa: markAdminSessionMfaMock,
  markStepUpFresh: markStepUpFreshMock,
  markTokenPageMfa: markTokenPageMfaMock,
}));

import { consumeStepUpHandoff, STEP_UP_HANDOFF_COOKIE } from "$lib/server/step-up-handoff";

function event(input?: {
  cookie?: string;
  sessionId?: string;
  userId?: string;
  isSuperAdmin?: boolean;
  platformRole?: "admin" | "student";
}): RequestEvent {
  return {
    cookies: {
      get: (name: string) => (name === STEP_UP_HANDOFF_COOKIE ? input?.cookie : undefined),
      delete: cookieDeleteMock,
    },
    locals: {
      session: input?.sessionId ? { id: input.sessionId } : null,
      sessionUser: input?.userId
        ? {
            id: input.userId,
            isSuperAdmin: input.isSuperAdmin ?? false,
            platformRole:
              input.platformRole ?? (input.isSuperAdmin === true ? "admin" : "student"),
          }
        : null,
    },
  } as unknown as RequestEvent;
}

beforeEach(() => {
  consumeTicketMock.mockReset();
  markAdminSessionMfaMock.mockReset().mockResolvedValue(undefined);
  markStepUpFreshMock.mockReset().mockResolvedValue(undefined);
  markTokenPageMfaMock.mockReset().mockResolvedValue(undefined);
  cookieDeleteMock.mockReset();
});

describe("step-up handoff", () => {
  it("does nothing without a ticket cookie", async () => {
    await expect(
      consumeStepUpHandoff(event({ sessionId: "sess_1", userId: "usr_1" })),
    ).resolves.toBe(false);
    expect(consumeTicketMock).not.toHaveBeenCalled();
  });

  it("consumes but rejects a ticket issued for another user", async () => {
    consumeTicketMock.mockResolvedValue("usr_2");

    await expect(
      consumeStepUpHandoff(event({ cookie: "ticket", sessionId: "sess_1", userId: "usr_1" })),
    ).resolves.toBe(false);

    expect(cookieDeleteMock).toHaveBeenCalledWith(STEP_UP_HANDOFF_COOKIE, { path: "/" });
    expect(markStepUpFreshMock).not.toHaveBeenCalled();
  });

  it("binds a valid ticket to the new session and grants superadmin MFA", async () => {
    consumeTicketMock.mockResolvedValue("usr_1");

    await expect(
      consumeStepUpHandoff(
        event({
          cookie: "ticket",
          sessionId: "sess_new",
          userId: "usr_1",
          isSuperAdmin: true,
        }),
      ),
    ).resolves.toBe(true);

    expect(markStepUpFreshMock).toHaveBeenCalledWith("sess_new");
    expect(markTokenPageMfaMock).toHaveBeenCalledWith("sess_new");
    expect(markAdminSessionMfaMock).toHaveBeenCalledWith("sess_new", "usr_1");
  });

  it("grants the same session-bound MFA marker to a regular platform admin", async () => {
    consumeTicketMock.mockResolvedValue("usr_1");

    await expect(
      consumeStepUpHandoff(
        event({
          cookie: "ticket",
          sessionId: "sess_new",
          userId: "usr_1",
          platformRole: "admin",
        }),
      ),
    ).resolves.toBe(true);

    expect(markAdminSessionMfaMock).toHaveBeenCalledWith("sess_new", "usr_1");
  });
});

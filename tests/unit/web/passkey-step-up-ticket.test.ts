import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { consumeTicketMock, markVerifiedSessionMock, cookieDeleteMock } = vi.hoisted(() => ({
  consumeTicketMock: vi.fn(),
  markVerifiedSessionMock: vi.fn(),
  cookieDeleteMock: vi.fn(),
}));

vi.mock("@nojv/application", () => ({
  consumeStepUpHandoffTicket: consumeTicketMock,
  markVerifiedSession: markVerifiedSessionMock,
}));

import { consumeStepUpHandoff, STEP_UP_HANDOFF_COOKIE } from "$lib/server/step-up-handoff";

function event(input?: {
  cookie?: string;
  sessionId?: string;
  userId?: string;
  isSuperAdmin?: boolean;
  platformRole?: "admin" | "student";
  securityGeneration?: number;
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
            securityGeneration: input.securityGeneration ?? 7,
          }
        : null,
    },
  } as unknown as RequestEvent;
}

beforeEach(() => {
  consumeTicketMock.mockReset();
  markVerifiedSessionMock.mockReset().mockResolvedValue(true);
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
    consumeTicketMock.mockResolvedValue({ userId: "usr_2", securityGeneration: 7 });

    await expect(
      consumeStepUpHandoff(event({ cookie: "ticket", sessionId: "sess_1", userId: "usr_1" })),
    ).resolves.toBe(false);

    expect(cookieDeleteMock).toHaveBeenCalledWith(STEP_UP_HANDOFF_COOKIE, { path: "/" });
    expect(markVerifiedSessionMock).not.toHaveBeenCalled();
  });

  it("binds a valid ticket to the new session and grants superadmin MFA", async () => {
    consumeTicketMock.mockResolvedValue({ userId: "usr_1", securityGeneration: 7 });

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

    expect(markVerifiedSessionMock).toHaveBeenCalledWith(
      "sess_new",
      { userId: "usr_1", securityGeneration: 7 },
      true,
    );
  });

  it("grants the same session-bound MFA marker to a regular platform admin", async () => {
    consumeTicketMock.mockResolvedValue({ userId: "usr_1", securityGeneration: 7 });

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

    expect(markVerifiedSessionMock).toHaveBeenCalledWith(
      "sess_new",
      { userId: "usr_1", securityGeneration: 7 },
      true,
    );
  });

  it("rejects a ticket from an older security generation", async () => {
    consumeTicketMock.mockResolvedValue({ userId: "usr_1", securityGeneration: 6 });

    await expect(
      consumeStepUpHandoff(event({ cookie: "ticket", sessionId: "sess_new", userId: "usr_1" })),
    ).resolves.toBe(false);

    expect(markVerifiedSessionMock).not.toHaveBeenCalled();
  });
});

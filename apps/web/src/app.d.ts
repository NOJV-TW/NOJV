import type { Session, User } from "better-auth";
import type { SessionUser } from "@nojv/core";
import type { ActorContext } from "$lib/server/auth";
import type { VerifiedApiTokenContext, proctoringDomain } from "@nojv/application";

declare global {
  namespace App {
    interface Locals {
      session: Session | null;
      sessionUser: SessionUser | null;
      user: User | null;
      apiToken: VerifiedApiTokenContext | null;
      apiTokenActor: ActorContext | null;
      /** True when an admin account has toggled into elevated "admin mode" this session. */
      adminModeActive: boolean;
      /** Per-request correlation ID — read from inbound `X-Request-Id` or generated. */
      requestId: string;
      examGate: {
        entityId: string;
        verdict: proctoringDomain.ProctoringVerdict;
      } | null;
    }
  }
}

export {};

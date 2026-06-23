import type { Session, User } from "better-auth";
import type { SessionUser } from "@nojv/core";
import type { ActorContext } from "$lib/server/auth";
import type { VerifiedApiTokenContext } from "@nojv/application";

declare global {
  namespace App {
    interface Locals {
      session: Session | null;
      sessionUser: SessionUser | null;
      user: User | null;
      apiToken: VerifiedApiTokenContext | null;
      apiTokenActor: ActorContext | null;
      /** Per-request correlation ID — read from inbound `X-Request-Id` or generated. */
      requestId: string;
    }
  }
}

export {};

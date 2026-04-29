/// <reference types="@sveltejs/kit" />

import type { Session, User } from "better-auth";
import type { SessionUser } from "@nojv/core";

declare global {
  namespace App {
    interface Locals {
      session: Session | null;
      sessionUser: SessionUser | null;
      user: User | null;
      /** Per-request correlation ID — read from inbound `X-Request-Id` or generated. */
      requestId: string;
    }
  }
}

export {};

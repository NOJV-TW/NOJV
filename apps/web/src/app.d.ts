import type { Session, User } from "better-auth";
import type { SessionUser } from "@nojv/core";

declare global {
  namespace App {
    interface Locals {
      session: Session | null;
      sessionUser: SessionUser | null;
      user: User | null;
      requestId: string;
    }
  }
}

export {};

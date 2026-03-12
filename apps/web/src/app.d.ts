/// <reference types="@sveltejs/kit" />

import type { Session, User } from "better-auth";

declare global {
  namespace App {
    interface Locals {
      session: Session | null;
      user: User | null;
    }
  }
}

export {};

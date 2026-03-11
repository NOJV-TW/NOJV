import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { ZodError } from "zod";

import { hasActorHandle } from "$lib/auth-onboarding";

import { getActorContext, type CompletedActorContext } from "./actor-context";
import { HttpError } from "./api-errors";

type AuthenticatedHandler = (
  event: RequestEvent,
  actor: CompletedActorContext
) => Promise<Response>;

function handleError(error: unknown) {
  if (error instanceof ZodError) {
    return json({ issues: error.issues, message: "Validation failed." }, { status: 400 });
  }

  if (error instanceof HttpError) {
    return json({ message: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Internal server error.";

  return json({ message }, { status: 500 });
}

export function withAuth(handler: AuthenticatedHandler) {
  return async (event: RequestEvent) => {
    try {
      const actor = await getActorContext(event);

      if (!actor) {
        return json({ message: "Authentication required." }, { status: 401 });
      }

      if (!hasActorHandle(actor)) {
        return json(
          { message: "Complete your NOJV handle before using the API." },
          { status: 403 }
        );
      }

      return await handler(event, actor);
    } catch (error) {
      return handleError(error);
    }
  };
}

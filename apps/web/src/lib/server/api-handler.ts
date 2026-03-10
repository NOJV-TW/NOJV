import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { hasActorHandle } from "@/lib/auth-onboarding";

import { getActorContext, type CompletedActorContext } from "./actor-context";
import { HttpError } from "./api-errors";

type AuthenticatedHandler = (
  request: Request,
  actor: CompletedActorContext
) => Promise<NextResponse>;

type AuthenticatedParamsHandler<P> = (
  request: Request,
  actor: CompletedActorContext,
  params: P
) => Promise<NextResponse>;

function handleError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { issues: error.issues, message: "Validation failed." },
      { status: 400 }
    );
  }

  if (error instanceof HttpError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Internal server error.";

  return NextResponse.json({ message }, { status: 500 });
}

export function withAuth(handler: AuthenticatedHandler) {
  return async (request: Request) => {
    try {
      const actor = await getActorContext();

      if (!actor) {
        return NextResponse.json({ message: "Authentication required." }, { status: 401 });
      }

      if (!hasActorHandle(actor)) {
        return NextResponse.json(
          { message: "Complete your NOJV handle before using the API." },
          { status: 403 }
        );
      }

      return await handler(request, actor);
    } catch (error) {
      return handleError(error);
    }
  };
}

export function withAuthParams<P>(handler: AuthenticatedParamsHandler<P>) {
  return async (request: Request, context: { params: Promise<P> }) => {
    try {
      const actor = await getActorContext();

      if (!actor) {
        return NextResponse.json({ message: "Authentication required." }, { status: 401 });
      }

      if (!hasActorHandle(actor)) {
        return NextResponse.json(
          { message: "Complete your NOJV handle before using the API." },
          { status: 403 }
        );
      }

      const params = await context.params;

      return await handler(request, actor, params);
    } catch (error) {
      return handleError(error);
    }
  };
}

import { isHttpError, isRedirect, redirect, type RequestEvent } from "@sveltejs/kit";
import type { ErrorStatus } from "sveltekit-superforms";
import { ZodError } from "zod";
import { ServiceUnavailableError } from "@nojv/application";

import { HttpError } from "../auth";
import { createLogger } from "../logger";

const logger = createLogger("request-error");

interface ClassifiedError {
  message: string;
  status: ErrorStatus;
  type: "http" | "unknown" | "validation";
}

export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const path = first?.path.map(String).join(".");
    const message = first?.message ?? "Invalid request.";
    return { status: 400, message: path ? `${path}: ${message}` : message, type: "validation" };
  }

  if (error instanceof HttpError || isHttpError(error)) {
    const status =
      error.status >= 400 && error.status <= 599 ? (error.status as ErrorStatus) : 500;
    let message = error instanceof HttpError ? error.message : error.body.message;
    if (status >= 500) {
      message =
        status === 503
          ? "Service temporarily unavailable. Please try again."
          : "Internal server error.";
    }
    if (error instanceof ServiceUnavailableError) message = error.message;
    return { status, message, type: "http" };
  }

  return { status: 500, message: "Internal server error.", type: "unknown" };
}

export function classifyRequestError(
  error: unknown,
  event: Pick<RequestEvent, "request" | "url" | "locals">,
): ClassifiedError {
  if (isRedirect(error)) redirect(error.status, error.location);
  const classified = classifyError(error);
  if (classified.status >= 500) {
    logger.error("Request failed", {
      err: error,
      method: event.request.method,
      requestId: event.locals.requestId,
      status: classified.status,
      url: event.url.pathname,
    });
  }
  return classified;
}

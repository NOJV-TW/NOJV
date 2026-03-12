import { isRedirect, isHttpError as isSvelteKitError, fail } from "@sveltejs/kit";
import { ZodError } from "zod";

import { HttpError } from "../auth";
import { createLogger } from "../logger";

export interface ClassifiedError {
  message: string;
  status: number;
  type: "http" | "unknown" | "validation";
}

export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof ZodError) {
    return { status: 400, message: "Validation failed.", type: "validation" };
  }

  if (error instanceof HttpError) {
    return { status: error.status, message: error.message, type: "http" };
  }

  return { status: 500, message: "Internal server error.", type: "unknown" };
}

export function actionHandler<T>(handler: () => Promise<T>) {
  const logger = createLogger("action");

  return async () => {
    try {
      return await handler();
    } catch (error) {
      if (isRedirect(error) || isSvelteKitError(error)) {
        throw error;
      }

      const classified = classifyError(error);

      if (classified.type === "unknown") {
        logger.error("Unhandled action error", {
          err: error instanceof Error ? error.message : String(error)
        });
      }

      return fail(classified.status, { message: classified.message });
    }
  };
}

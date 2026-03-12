import { ZodError } from "zod";

import { HttpError } from "../auth";

interface ClassifiedError {
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

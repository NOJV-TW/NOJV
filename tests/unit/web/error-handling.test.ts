import { describe, it, expect, vi } from "vitest";

vi.mock("@nojv/db", () => ({
  problemRepo: {},
  submissionRepo: {},
  courseRepo: {},
  announcementRepo: {},
  assessmentRepo: {},
  assessmentParticipationRepo: {},
  runTransaction: vi.fn()
}));

vi.mock("@nojv/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nojv/core")>();
  return {
    ...actual
  };
});

import { z } from "zod";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { HttpError, NotFoundError, ForbiddenError } from "$lib/server/auth";

describe("classifyError", () => {
  it("classifies ZodError as validation", () => {
    try {
      z.string().parse(42);
    } catch (error) {
      const result = classifyError(error);
      expect(result).toEqual({
        status: 400,
        message: "Validation failed.",
        type: "validation"
      });
    }
  });

  it("classifies HttpError with its status and message", () => {
    const error = new HttpError("Custom error", 422);
    const result = classifyError(error);
    expect(result).toEqual({
      status: 422,
      message: "Custom error",
      type: "http"
    });
  });

  it("classifies NotFoundError as http with 404", () => {
    const error = new NotFoundError();
    const result = classifyError(error);
    expect(result).toEqual({
      status: 404,
      message: "Not found.",
      type: "http"
    });
  });

  it("classifies ForbiddenError as http with 403", () => {
    const error = new ForbiddenError();
    const result = classifyError(error);
    expect(result).toEqual({
      status: 403,
      message: "Forbidden.",
      type: "http"
    });
  });

  it("classifies unknown errors as unknown with 500", () => {
    const result = classifyError(new Error("something broke"));
    expect(result).toEqual({
      status: 500,
      message: "Internal server error.",
      type: "unknown"
    });
  });

  it("classifies non-Error values as unknown", () => {
    const result = classifyError("string error");
    expect(result).toEqual({
      status: 500,
      message: "Internal server error.",
      type: "unknown"
    });
  });
});

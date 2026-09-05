import { beforeEach, describe, it, expect, vi } from "vitest";

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));
vi.mock("$lib/server/logger", () => ({
  createLogger: () => ({ error: loggerError }),
}));
beforeEach(() => loggerError.mockClear());

vi.mock("@nojv/db", () => ({
  problemRepo: {},
  submissionRepo: {},
  courseRepo: {},
  announcementRepo: {},
  assessmentRepo: {},
  assessmentParticipationRepo: {},
  runTransaction: vi.fn(),
}));

vi.mock("@nojv/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nojv/core")>();
  return {
    ...actual,
  };
});

vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: vi.fn().mockResolvedValue(null),
  apiRateLimiter: { consume: vi.fn().mockResolvedValue("allowed") },
  writeApiRateLimiter: { consume: vi.fn().mockResolvedValue("allowed") },
  registryTokenRateLimiter: { consume: vi.fn().mockResolvedValue("allowed") },
}));

import { z } from "zod";
import { error as httpError, redirect, type RequestEvent } from "@sveltejs/kit";
import { IntegrityError, ServiceUnavailableError } from "@nojv/application";
import { apiHandler, readJsonBody } from "$lib/server/shared/api-handler";
import { handleLoad } from "$lib/server/shared/load-wrapper";

function requestEvent(body?: string): RequestEvent {
  return {
    request: new Request(
      "http://localhost/api/test",
      body === undefined ? {} : { method: "POST", body },
    ),
    url: new URL("http://localhost/api/test"),
    locals: { requestId: "request_1", sessionUser: { id: "user_1" } },
  } as RequestEvent;
}
import { classifyError } from "$lib/server/shared/handle-action-error";
import { HttpError, NotFoundError, ForbiddenError } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";

describe("classifyError", () => {
  it("classifies ZodError as validation", () => {
    try {
      z.string().parse(42);
    } catch (error) {
      const result = classifyError(error);
      expect(result).toEqual({
        status: 400,
        message: expect.stringContaining("expected string"),
        type: "validation",
      });
    }
  });

  it("classifies HttpError with its status and message", () => {
    const error = new HttpError("Custom error", 422);
    const result = classifyError(error);
    expect(result).toEqual({
      status: 422,
      message: "Custom error",
      type: "http",
    });
  });

  it("classifies NotFoundError as http with 404", () => {
    const error = new NotFoundError();
    const result = classifyError(error);
    expect(result).toEqual({
      status: 404,
      message: "Not found.",
      type: "http",
    });
  });

  it("classifies ForbiddenError as http with 403", () => {
    const error = new ForbiddenError();
    const result = classifyError(error);
    expect(result).toEqual({
      status: 403,
      message: "Forbidden.",
      type: "http",
    });
  });

  it("classifies unknown errors as unknown with 500", () => {
    const result = classifyError(new Error("something broke"));
    expect(result).toEqual({
      status: 500,
      message: "Internal server error.",
      type: "unknown",
    });
  });

  it("classifies non-Error values as unknown", () => {
    const result = classifyError("string error");
    expect(result).toEqual({
      status: 500,
      message: "Internal server error.",
      type: "unknown",
    });
  });
});

describe("withAction", () => {
  function fakeEvent() {
    return requestEvent();
  }

  it("returns handler result on success", async () => {
    const handler = withAction(async () => ({ success: true }));
    const result = await handler(fakeEvent());
    expect(result).toEqual({ success: true });
  });

  it("converts ZodError to fail(400) with error message", async () => {
    const schema = z.object({ title: z.string().max(5) });
    const handler = withAction(async () => {
      schema.parse({ title: "this title is too long" });
      return { success: true };
    });
    const result = await handler(fakeEvent());
    expect(result).toMatchObject({ status: 400, data: { error: expect.any(String) } });
  });

  it("converts HttpError to fail with its status and message", async () => {
    const handler = withAction(async () => {
      throw new HttpError("Not allowed", 403);
    });
    const result = await handler(fakeEvent());
    expect(result).toMatchObject({ status: 403, data: { error: "Not allowed" } });
  });

  it("converts unknown error to fail(500)", async () => {
    const handler = withAction(async () => {
      throw new Error("db exploded");
    });
    const result = await handler(fakeEvent());
    expect(result).toMatchObject({ status: 500, data: { error: "Internal server error." } });
  });
});

describe("request error boundaries", () => {
  it("returns actionable validation messages in forms and APIs", async () => {
    const schema = z.object({ title: z.string().min(3, "Use at least 3 characters.") });
    const validate = () => schema.parse({ title: "x" });
    const action = await withAction(async () => validate())(requestEvent());
    expect(action).toMatchObject({
      status: 400,
      data: { error: "title: Use at least 3 characters." },
    });
    const response = await apiHandler(async () => {
      validate();
      return new Response();
    })(requestEvent());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: "title: Use at least 3 characters.",
      issues: [expect.objectContaining({ path: ["title"] })],
    });
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("keeps malformed JSON a client error", async () => {
    const response = await apiHandler(async (event) => {
      await readJsonBody(event);
      return new Response();
    })(requestEvent("{"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Invalid request body: expected valid JSON.",
    });
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("logs the original cause and request ID without exposing integrity details", async () => {
    const cause = new Error("private database connection");
    const error = new HttpError("private problem id", 500, { cause });
    const response = await apiHandler(async () => {
      throw error;
    })(requestEvent());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Internal server error." });
    expect(loggerError).toHaveBeenCalledExactlyOnceWith(
      "Request failed",
      expect.objectContaining({ err: error, requestId: "request_1", status: 500 }),
    );
    expect(error.cause).toBe(cause);
  });

  it("preserves a safe service-unavailable message and status for forms", async () => {
    const result = await withAction(async () => {
      throw new ServiceUnavailableError("Unable to load the report. Try again.");
    })(requestEvent());
    expect(result).toMatchObject({
      status: 503,
      data: { error: "Unable to load the report. Try again." },
    });
    expect(loggerError).toHaveBeenCalledOnce();
  });

  it("sanitizes load failures while preserving domain status", async () => {
    await expect(
      handleLoad(async () => {
        throw new IntegrityError("private record");
      })(requestEvent()),
    ).rejects.toMatchObject({ status: 500, body: { message: "Internal server error." } });
    expect(loggerError).toHaveBeenCalledOnce();
  });

  it("preserves redirects and client errors", async () => {
    await expect(
      withAction(async () => redirect(303, "/dashboard"))(requestEvent()),
    ).rejects.toMatchObject({ status: 303, location: "/dashboard" });
    await expect(
      handleLoad(async () => httpError(404, "Problem not found."))(requestEvent()),
    ).rejects.toMatchObject({ status: 404, body: { message: "Problem not found." } });
    expect(loggerError).not.toHaveBeenCalled();
  });
});

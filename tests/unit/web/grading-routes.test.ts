import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOverride: vi.fn(),
  upsertFeedback: vi.fn(),
  actor: { userId: "teacher", platformRole: "teacher" },
}));

vi.mock("@nojv/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nojv/application")>();
  return {
    ...actual,
    scoreOverrideDomain: {
      ...actual.scoreOverrideDomain,
      createOverride: mocks.createOverride,
    },
    feedbackDomain: { ...actual.feedbackDomain, upsertFeedback: mocks.upsertFeedback },
  };
});
vi.mock("$lib/server/auth", () => ({ requireApiAuth: () => mocks.actor }));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  apiRateLimiter: { consume: async () => "allowed" },
  writeApiRateLimiter: { consume: async () => "allowed" },
  registryTokenRateLimiter: { consume: async () => "allowed" },
}));
vi.mock("$lib/server/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));

import { POST } from "../../../apps/web/src/routes/api/overrides/+server";
import { PUT } from "../../../apps/web/src/routes/api/feedback/+server";
import { internalSchemas } from "$lib/server/openapi/internal/schemas";

function event(method: string, body: unknown): RequestEvent {
  const url = new URL(`https://nojv.test/api/${method === "POST" ? "overrides" : "feedback"}`);
  return {
    url,
    request: new Request(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    locals: { requestId: "grading-subjects", sessionUser: { id: "teacher" } },
  } as unknown as RequestEvent;
}

const score = { problemId: "problem", overrideScore: 80, reason: "Manual grading" };
const contexts = [
  { type: "assignment", assignmentId: "assignment" },
  { type: "exam", examId: "exam" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createOverride.mockResolvedValue({
    id: "override",
    userId: null,
    courseMembershipId: "membership",
  });
  mocks.upsertFeedback.mockResolvedValue({ id: "feedback", courseMembershipId: "membership" });
});

describe("grading API subjects", () => {
  it.each(contexts)(
    "passes $type membership identity unchanged to grading",
    async (context) => {
      const body = { ...score, context, courseMembershipId: "membership" };
      const response = await POST(event("POST", body));
      expect(response.status).toBe(201);
      expect(mocks.createOverride).toHaveBeenCalledWith(mocks.actor, body);
    },
  );

  it.each(contexts)("rejects missing, user, or mixed subjects for $type", async (context) => {
    for (const subject of [
      {},
      { userId: "user" },
      { courseMembershipId: "membership", userId: "user" },
      { courseMembershipId: "membership", userId: null },
    ]) {
      expect((await POST(event("POST", { ...score, context, ...subject }))).status).toBe(400);
    }
    expect(mocks.createOverride).not.toHaveBeenCalled();
  });

  it("accepts only an actual user identity for contest overrides", async () => {
    const body = {
      ...score,
      context: { type: "contest", contestId: "contest" },
      userId: "user",
    };
    expect((await POST(event("POST", body))).status).toBe(201);
    expect(mocks.createOverride).toHaveBeenCalledWith(mocks.actor, body);
    mocks.createOverride.mockClear();
    for (const subject of [
      { courseMembershipId: "membership" },
      { userId: "user", courseMembershipId: "membership" },
      { userId: "user", courseMembershipId: null },
    ]) {
      expect(
        (await POST(event("POST", { ...score, context: body.context, ...subject }))).status,
      ).toBe(400);
    }
    expect(mocks.createOverride).not.toHaveBeenCalled();
  });

  it.each(contexts)(
    "uses membership identity for $type feedback and rejects legacy fields",
    async (context) => {
      const input = {
        courseMembershipId: "membership",
        problemId: "problem",
        comment: "Review the boundary case.",
      };
      expect((await PUT(event("PUT", { context, ...input }))).status).toBe(200);
      expect(mocks.upsertFeedback).toHaveBeenCalledWith(mocks.actor, { context, input });
      mocks.upsertFeedback.mockClear();
      expect(
        (await PUT(event("PUT", { context, ...input, studentUserId: "user" }))).status,
      ).toBe(400);
      expect(mocks.upsertFeedback).not.toHaveBeenCalled();
    },
  );

  it("documents membership subjects and nullable users in the public API contract", () => {
    expect(internalSchemas.UpsertGradingFeedbackRequest).toMatchObject({
      required: expect.arrayContaining(["courseMembershipId", "context"]),
      additionalProperties: false,
    });
    const overrideRequest = JSON.stringify(internalSchemas.CreateScoreOverrideRequest);
    expect(overrideRequest).toContain('"courseMembershipId"');
    expect(overrideRequest).toContain('"userId"');
    expect(internalSchemas.ScoreOverrideItem.properties.userId.type).toEqual([
      "string",
      "null",
    ]);
  });
});

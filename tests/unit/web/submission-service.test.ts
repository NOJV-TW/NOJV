import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSubmissionBody,
  executeSubmission,
  SubmissionRequestError,
} from "$lib/services/submission-service";

afterEach(() => vi.unstubAllGlobals());

describe("buildSubmissionBody", () => {
  it("serializes virtual submissions with participationId", () => {
    const body = buildSubmissionBody({
      context: { type: "virtual", participationId: "participation_1" },
      language: "cpp",
      problemId: "problem_1",
      sampleOnly: false,
      sourceCode: "int main() {}",
    });

    expect(body).toMatchObject({
      context: { type: "virtual", participationId: "participation_1" },
      language: "cpp",
      problemId: "problem_1",
      sampleOnly: false,
      sourceCode: "int main() {}",
    });
    expect(body).not.toHaveProperty("participationId");
  });

  it("includes advanced source files without dropping the placeholder source", () => {
    const body = buildSubmissionBody({
      context: { type: "practice" },
      language: "cpp",
      problemId: "problem_1",
      sourceCode: "// advanced-mode upload",
      sourceFiles: [{ path: "main.cpp", content: "int main() {}" }],
    });

    expect(body).toMatchObject({
      context: { type: "practice" },
      sourceCode: "// advanced-mode upload",
      sourceFiles: [{ path: "main.cpp", content: "int main() {}" }],
    });
  });

  it("marks a practice submission as a reference solution", () => {
    const body = buildSubmissionBody({
      context: { type: "practice" },
      language: "python",
      problemId: "problem_1",
      referenceSolution: true,
      sourceCode: "print(1)",
    });

    expect(body).toMatchObject({ referenceSolution: true, sampleOnly: false });
  });
});

describe("executeSubmission", () => {
  it("retries transient poll network failures after dispatch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            submissionId: "submission_1",
            pollUrl: "/poll",
            status: "queued",
          }),
          { status: 202 },
        ),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            submissionId: "submission_1",
            status: "accepted",
            result: {
              accepted: true,
              feedback: "Accepted",
              runtimeMs: 1,
              score: 100,
              verdict: "accepted",
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeSubmission({
        context: { type: "practice" },
        language: "python",
        problemId: "problem_1",
        sourceCode: "print(1)",
      }),
    ).resolves.toMatchObject({ accepted: true, verdict: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports polling API failures as SubmissionRequestError", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              submissionId: "submission_1",
              pollUrl: "/poll",
              status: "queued",
            }),
            { status: 202 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Judge operation unavailable" }), {
            status: 503,
          }),
        ),
    );

    await expect(
      executeSubmission({
        context: { type: "practice" },
        language: "python",
        problemId: "problem_1",
        sourceCode: "print(1)",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SubmissionRequestError>>({
        name: "SubmissionRequestError",
        message: "Judge operation unavailable",
      }),
    );
  });

  it("uses a stable SubmissionRequestError for non-JSON polling failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              submissionId: "submission_1",
              pollUrl: "/poll",
              status: "queued",
            }),
            { status: 202 },
          ),
        )
        .mockResolvedValueOnce(new Response("Service unavailable", { status: 503 })),
    );

    await expect(
      executeSubmission({
        context: { type: "practice" },
        language: "python",
        problemId: "problem_1",
        sourceCode: "print(1)",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SubmissionRequestError>>({
        name: "SubmissionRequestError",
        message: "Polling failed.",
      }),
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  createCheatingSignalJob,
  createSubmissionJob,
  createWorkspaceRunJob,
  queueNames
} from "../src/index";

describe("queueNames", () => {
  it("keeps queue names explicit for routing and dashboarding", () => {
    expect(queueNames.submission).toBe("submission-judge");
    expect(queueNames.workspaceRun).toBe("workspace-run");
    expect(queueNames.cheatingSignal).toBe("cheating-signal");
  });
});

describe("createSubmissionJob", () => {
  it("produces validated payloads for practice submissions", () => {
    const job = createSubmissionJob({
      draft: {
        language: "python",
        mode: "practice",
        problemSlug: "warmup-sum",
        sourceCode: "print(sum(map(int, input().split())))"
      },
      submissionId: "sub_queue_contract_01"
    });

    expect(job.name).toBe(queueNames.submission);
    expect(job.data.draft.problemSlug).toBe("warmup-sum");
  });
});

describe("createWorkspaceRunJob", () => {
  it("preserves file payloads for isolated makefile execution", () => {
    const job = createWorkspaceRunJob({
      request: {
        command: "make run",
        files: [
          {
            content: "run:\n\t@cat src/input.txt\n",
            path: "Makefile"
          },
          {
            content: "42 58\n",
            path: "src/input.txt"
          }
        ],
        mode: "assignment",
        timeoutMs: 5_000,
        workspaceSessionId: "ws_assignment_demo_01"
      },
      workspaceRunId: "run_queue_contract_01"
    });

    expect(job.data.request.files).toHaveLength(2);
    expect(job.data.request.timeoutMs).toBe(5_000);
  });

  it("rejects workspace runs missing their isolated session binding", () => {
    expect(() =>
      createWorkspaceRunJob({
        request: {
          command: "make",
          files: [
            {
              content: "all:\n\t@true\n",
              path: "Makefile"
            }
          ],
          mode: "assignment",
          timeoutMs: 5_000
        },
        workspaceRunId: "run_queue_contract_02"
      })
    ).toThrowError();
  });
});

describe("createCheatingSignalJob", () => {
  it("preserves evidence payloads for later reviewer aggregation", () => {
    const job = createCheatingSignalJob({
      capturedAt: "2026-03-08T08:30:00.000Z",
      confidence: 0.91,
      payload: {
        similarityCluster: ["sub_1", "sub_2"]
      },
      source: "contest_workspace",
      type: "similarity_match",
      userId: "usr_telemetry"
    });

    expect(job.data.type).toBe("similarity_match");
    expect(job.data.source).toBe("contest_workspace");
  });
});

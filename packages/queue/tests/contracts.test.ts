import { describe, expect, it } from "vitest";

import {
  createCheatingSignalJob,
  createSubmissionJob,
  queueNames
} from "../src/index";

describe("queueNames", () => {
  it("keeps queue names explicit for routing and dashboarding", () => {
    expect(queueNames.submission).toBe("submission-judge");
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

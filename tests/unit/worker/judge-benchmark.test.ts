import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import {
  assertTargetAuthorized,
  collectTrial,
  compareTrials,
  fixedInputsHash,
  manifestSchema,
  percentile,
  summarizeTrial,
  trialSchema,
  type Manifest,
  type Trial,
} from "../../../scripts/judge-benchmark.js";

function manifest(): Manifest {
  return manifestSchema.parse({
    schemaVersion: 1,
    target: "http://127.0.0.1:3000",
    targetKind: "isolated-test",
    sandboxImageDigest: `sha256:${"a".repeat(64)}`,
    backgroundServicesSha256: "b".repeat(64),
    machineProfileSha256: "c".repeat(64),
    dedicatedTestAccounts: true,
    accounts: Array.from({ length: 100 }, (_, index) => ({
      userId: `student-${index}`,
      tokenEnv: `BENCH_TOKEN_${index}`,
    })),
    fixtures: (["short", "cpu-heavy", "memory-heavy"] as const).flatMap((workload) =>
      [20, 100].map((cases) => ({
        id: `${workload}-${cases}`,
        workload,
        cases,
        datasetSha256: "d".repeat(64),
        expectedVerdict: "accepted",
        payload: {
          problemId: `bench-${workload}-${cases}`,
          context: { type: "practice" },
          language: "cpp",
          sourceCode: "int main() {}",
        },
      })),
    ),
  });
}

function matrix(factor = 1): Trial[] {
  return manifest().fixtures.flatMap((fixture) =>
    (["single", "steady", "burst"] as const).flatMap((load) =>
      (["cold", "warm"] as const).flatMap((cache) =>
        [1, 2, 3].map((repetition) => {
          const count = load === "single" ? 1 : 100;
          const duration = load === "single" ? 0 : load === "burst" ? 60_000 : 600_000;
          return trialSchema.parse({
            schemaVersion: 1,
            revision: factor === 1 ? "baseline" : "candidate",
            fixtureId: fixture.id,
            workload: fixture.workload,
            cases: fixture.cases,
            load,
            cache,
            repetition,
            fixedInputsSha256: "e".repeat(64),
            cachePreparationEvidence: "maintenance-log/cache-state",
            scheduledDurationMs: duration,
            startedAt: 1000,
            finishedAt: 2_000_000,
            submissions: Array.from({ length: count }, (_, index) => ({
              accountIndex: index,
              submissionId: `trial-${fixture.id}-${load}-${cache}-${repetition}-${index}`,
              requestedAt: 1000 + (index * duration) / count,
              acceptedAt: 1001 + (index * duration) / count,
              completedAt: 1000 + duration + 300_000 * factor,
              verdict: "accepted",
              expectedVerdict: "accepted",
              queueMs: 10,
              cpuSeconds: 1,
              error: null,
            })),
            httpLatencyMs: [10],
            telemetry: {
              evidenceReference: "metrics-and-runtime-inventory",
              cleanupCompletedAt: 1000 + duration + 300_000 * factor,
              webLatencyMs: [10, 20, 30],
              dbLatencyMs: [3, 4],
              oomCount: 0,
              runtimeLeakCount: 0,
              starvationCount: 0,
              falseQueueFailureCount: 0,
              verdictFixturesPassed: true,
            },
          });
        }),
      ),
    ),
  );
}

describe("judge benchmark evidence", () => {
  it("uses interpolated percentiles and reports unavailable measurements as null", () => {
    expect(percentile([100, 0], 0.95)).toBe(95);
    expect(percentile([], 0.5)).toBeNull();
    const trial = matrix()[0]!;
    trial.telemetry = null;
    trial.submissions[0]!.completedAt = null;
    trial.submissions[0]!.cpuSeconds = null;
    expect(summarizeTrial(trial)).toMatchObject({
      drainMs: null,
      cpuSecondsPerSubmission: null,
      webLatencyMs: { p95: null },
    });
  });

  it("passes a complete comparable matrix with sufficient burst improvement", () => {
    const report = compareTrials(matrix(), matrix(0.7));
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.comparisons).toHaveLength(36);
  });

  it("fails closed on missing trials, duplicate trials and absent runtime evidence", () => {
    const baseline = matrix();
    const candidate = matrix(0.7);
    candidate.pop();
    candidate.push(candidate[0]!);
    candidate[0]!.telemetry = null;
    candidate[0]!.submissions[0]!.queueMs = null;
    const report = compareTrials(baseline, candidate);
    expect(report.passed).toBe(false);
    expect(report.failures.join("\n")).toMatch(/108 unique trials/);
    expect(report.failures.join("\n")).toMatch(/incomplete measurements/);
    expect(report.failures.join("\n")).toMatch(/runtime\/correctness evidence/);
    expect(compareTrials([], []).passed).toBe(false);
  });

  it("does not hide a slow workload behind faster ones", () => {
    const candidate = matrix(0.7);
    for (const trial of candidate.filter(
      (item) => item.workload === "memory-heavy" && item.load === "burst",
    )) {
      for (const item of trial.submissions) item.completedAt = 361_000;
    }
    expect(compareTrials(matrix(), candidate).failures.join("\n")).toMatch(
      /memory-heavy.*below 20%/,
    );
  });

  it("includes runtime cleanup in drain time instead of stopping at the verdict", () => {
    const candidate = matrix(0.7);
    for (const trial of candidate.filter((item) => item.load === "burst")) {
      trial.telemetry!.cleanupCompletedAt = 400_000;
    }
    expect(compareTrials(matrix(), candidate).failures.join("\n")).toMatch(/below 20%/);
  });

  it("rejects input drift, unsafe runtime evidence, and latency regression", () => {
    const candidate = matrix(0.7);
    candidate[0]!.fixedInputsSha256 = "f".repeat(64);
    candidate[0]!.telemetry!.runtimeLeakCount = 1;
    candidate[0]!.telemetry!.webLatencyMs = [1000];
    candidate[0]!.submissions[0]!.completedAt = 1_000_000;
    const failures = compareTrials(matrix(), candidate).failures.join("\n");
    expect(failures).toMatch(/fixed inputs/);
    expect(failures).toMatch(/runtime\/correctness/);
    expect(failures).toMatch(/web p95/);
    expect(failures).toMatch(/single submission p95/);
  });

  it("requires distinct students and accepted requests inside the 60 second burst", () => {
    const candidate = matrix(0.7);
    const burst = candidate.find((trial) => trial.load === "burst")!;
    burst.submissions[1]!.accountIndex = 0;
    burst.submissions[0]!.acceptedAt = burst.startedAt + 60_001;
    expect(compareTrials(matrix(), candidate).failures.join("\n")).toMatch(
      /100 accepted submissions within 60 seconds/,
    );
    expect(compareTrials(matrix(), candidate).failures.join("\n")).toMatch(
      /wrong submission\/account count/,
    );
  });

  it("rejects impossible timestamp and queue measurements", () => {
    const trial = matrix()[0]!;
    trial.submissions[0]!.queueMs = 9_000_000;
    expect(() => trialSchema.parse(trial)).toThrow();
  });

  it("requires a remote maintenance window covering drain and all scheduled work", () => {
    const input = manifest();
    assertTargetAuthorized(input, 1000, 60_000);
    input.target = "https://judge.example.test";
    expect(() => assertTargetAuthorized(input, 1000, 60_000)).toThrow(/maintenance/);
    input.maintenance = {
      approvalReference: "approved-window",
      startsAt: new Date(0).toISOString(),
      endsAt: new Date(100_000).toISOString(),
      realJudgeDrained: true,
    };
    assertTargetAuthorized(input, 1000, 60_000);
    expect(() => assertTargetAuthorized(input, 1000, 100_000)).toThrow(/maintenance/);
    input.target = "https://token@judge.example.test";
    expect(() => assertTargetAuthorized(input, 1000, 60_000)).toThrow(/credential-free/);
    input.target = "http://127.0.0.1:3000";
    input.targetKind = "shared-server";
    delete input.maintenance;
    expect(() => assertTargetAuthorized(input, 1000, 60_000)).toThrow(/maintenance/);
  });

  it("hashes immutable workload inputs but excludes credentials and revision", () => {
    const input = manifest();
    const original = fixedInputsHash(input, "short-20");
    input.accounts[0]!.tokenEnv = "ROTATED_TOKEN";
    expect(fixedInputsHash(input, "short-20")).toBe(original);
    input.fixtures[0]!.payload.sourceCode = "int main() {return 1;}";
    expect(fixedInputsHash(input, "short-20")).not.toBe(original);
    input.accounts[0]!.userId = input.accounts[1]!.userId;
    expect(() => manifestSchema.parse(input)).toThrow();
  });

  it("collects through the real HTTP contract without claiming missing telemetry", async () => {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          req.method === "POST"
            ? { submissionId: "test-id", status: "queued" }
            : { submissionId: "test-id", status: "accepted" },
        ),
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const input = manifest();
    input.target = `http://127.0.0.1:${address.port}`;
    const oldToken = process.env.BENCH_TOKEN_0;
    process.env.BENCH_TOKEN_0 = "test-token-not-for-output";
    try {
      const trial = await collectTrial(input, {
        fixtureId: "short-20",
        load: "single",
        cache: "warm",
        repetition: 1,
        revision: "test",
        cachePreparationEvidence: "test-record",
        timeoutMs: 1000,
      });
      expect(requests).toEqual(["POST /api/submissions", "GET /api/submissions/test-id"]);
      expect(trial.submissions[0]).toMatchObject({
        verdict: "accepted",
        queueMs: null,
        cpuSeconds: null,
      });
      expect(trial.telemetry).toBeNull();
      expect(JSON.stringify(trial)).not.toContain("test-token-not-for-output");
    } finally {
      if (oldToken === undefined) delete process.env.BENCH_TOKEN_0;
      else process.env.BENCH_TOKEN_0 = oldToken;
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

import type { V1Pod } from "@kubernetes/client-node";
import { beforeEach, describe, expect, it, vi } from "vitest";

const instruments = vi.hoisted(() => ({
  info: vi.fn(),
  records: [] as { name: string; value: number; labels: Record<string, unknown> }[],
}));
vi.mock("../../../apps/worker/src/logger", () => ({
  createLogger: () => ({ info: instruments.info }),
}));
vi.mock("../../../apps/worker/node_modules/@opentelemetry/api", () => ({
  metrics: {
    getMeter: () => ({
      createHistogram: (name: string) => ({
        record: (value: number, labels: Record<string, unknown>) =>
          instruments.records.push({ name, value, labels }),
      }),
      createCounter: (name: string) => ({
        add: (value: number, labels: Record<string, unknown>) =>
          instruments.records.push({ name, value, labels }),
      }),
    }),
  },
}));

import {
  podPhaseTimings,
  recordJudgePhase,
  recordRunnerResources,
  recordWallClockTimeouts,
} from "../../../apps/worker/src/sandbox/shared/judge-phase-metrics";

const date = (milliseconds: number) => new Date(milliseconds);
function lifecycle(names: string[]): V1Pod {
  return {
    metadata: { creationTimestamp: date(1000) },
    status: {
      conditions: [{ type: "PodScheduled", status: "True", lastTransitionTime: date(2000) }],
      containerStatuses: names.map((name, index) => ({
        name,
        image: "image",
        imageID: "id",
        ready: false,
        restartCount: 0,
        state: {
          terminated: {
            exitCode: 0,
            startedAt: date(3000 + index * 1000),
            finishedAt: date(3500 + index * 1000),
          },
        },
      })),
    },
  };
}

beforeEach(() => {
  instruments.records.length = 0;
  instruments.info.mockReset();
});

describe("recordWallClockTimeouts", () => {
  const run = (errorVerdict: "TLE" | "RE" | undefined, timeMs: number) => ({
    index: 0,
    stdout: "",
    stderr: "",
    exitCode: -1,
    timeMs,
    ...(errorVerdict ? { errorVerdict } : {}),
  });

  it("counts only TLEs whose CPU time stayed under the limit", () => {
    recordWallClockTimeouts(
      [run("TLE", 400), run("TLE", 1200), run("RE", 100), run(undefined, 50)],
      1000,
      "cpp",
    );
    expect(instruments.records).toEqual([
      { name: "judge_wall_clock_timeouts_total", value: 1, labels: { language: "cpp" } },
    ]);
  });

  it("records nothing when every TLE used up its CPU time", () => {
    recordWallClockTimeouts([run("TLE", 1000)], 1000, "python");
    expect(instruments.records).toEqual([]);
  });
});

describe("bounded-cardinality judge phase metrics", () => {
  it.each([
    ["standard", ["run", "judge"], ["execute", "checker"]],
    ["checker", ["run", "judge"], ["execute", "checker"]],
    ["interactive", ["solution", "interactor"], ["execute", "checker"]],
    ["advanced", ["prep", "run", "grader"], ["prepare", "execute", "checker"]],
  ] as const)("uses real lifecycle times for %s", (mode, names, phases) => {
    const timings = podPhaseTimings(lifecycle([...names]), mode);
    expect(timings.schedule).toBe(1000);
    expect(timings.startup).toBe(1000);
    for (const phase of phases) expect(timings[phase]).toBe(500);
    expect(timings).not.toHaveProperty("image_pull");
  });

  it("does not fabricate missing timestamps or count result-emitter waiting as checker time", () => {
    expect(podPhaseTimings({}, "advanced")).toEqual({});
    expect(podPhaseTimings(lifecycle(["transfer", "emit-result"]), "advanced")).toEqual({
      schedule: 1000,
      startup: 1000,
    });
    const pod = lifecycle(["case-0"]);
    pod.status!.containerStatuses![0]!.state!.terminated!.finishedAt = date(0);
    expect(podPhaseTimings(pod)).not.toHaveProperty("execute");
  });

  it("records CPU, throttling and peak memory without using IDs as metric labels", () => {
    const logs = `ordinary output\n${JSON.stringify({ submissionId: "private", nojvResourceUsage: { cpuUsec: 2_500_000, throttledUsec: 125_000, memoryPeakBytes: 1024 } })}`;
    recordRunnerResources(logs, "standard", "cpp", "execute", {
      jobName: "judge-run-wave",
      container: "case-0",
    });
    expect(instruments.info).toHaveBeenCalledWith("Sandbox resource measurements", {
      jobName: "judge-run-wave",
      container: "case-0",
      phase: "execute",
      mode: "standard",
      language: "cpp",
      cpuUsec: 2_500_000,
      throttledUsec: 125_000,
      memoryPeakBytes: 1024,
    });
    expect(instruments.records).toEqual([
      {
        name: "judge_cpu_seconds",
        value: 2.5,
        labels: { phase: "execute", mode: "standard", language: "cpp" },
      },
      {
        name: "judge_cpu_throttled_seconds",
        value: 0.125,
        labels: { phase: "execute", mode: "standard", language: "cpp" },
      },
      {
        name: "judge_memory_peak_bytes",
        value: 1024,
        labels: { phase: "execute", mode: "standard", language: "cpp" },
      },
    ]);
  });

  it("skips unavailable and malformed resource data instead of converting it to zero", () => {
    for (const usage of [
      null,
      {},
      { cpuUsec: null, throttledUsec: null, memoryPeakBytes: null },
      { cpuUsec: -1, throttledUsec: "0", memoryPeakBytes: -100 },
    ])
      recordRunnerResources(
        JSON.stringify({ nojvResourceUsage: usage }),
        "checker",
        "python",
        "checker",
      );
    recordRunnerResources('{"nojvResourceUsage":invalid}', "advanced", "cpp");
    recordRunnerResources('{"nojvResourceUsage":{"cpuUsec":1e999}}', "advanced", "cpp");
    recordRunnerResources('{"nojvResourceUsage":{"cpuUsec":1e300}}', "advanced", "cpp");
    expect(instruments.records).toEqual([]);
  });

  it("labels measured cleanup failures while rejecting invalid durations", () => {
    recordJudgePhase("cleanup", 200, "interactive", "python", "failure");
    for (const value of [-1, Number.NaN, Infinity])
      recordJudgePhase("execute", value, "standard", "cpp");
    expect(instruments.records).toEqual([
      {
        name: "judge_phase_duration_seconds",
        value: 0.2,
        labels: {
          phase: "cleanup",
          mode: "interactive",
          language: "python",
          result: "failure",
        },
      },
    ]);
  });
});

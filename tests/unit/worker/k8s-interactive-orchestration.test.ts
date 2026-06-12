import type { SandboxRequest } from "@nojv/core";
import { describe, expect, it, vi } from "vitest";

import { INTERACTIVE_RUN_MARKER, INTERACTIVE_VALIDATE_MARKER } from "@nojv/core";

import { K8sExecutor } from "../../../apps/worker/src/services/k8s-executor";

function runMarker(report: Record<string, unknown>): string {
  return `\n${INTERACTIVE_RUN_MARKER}${JSON.stringify(report)}\n`;
}

function intMarker(outcome: Record<string, unknown>): string {
  return `\n${INTERACTIVE_VALIDATE_MARKER}${JSON.stringify(outcome)}\n`;
}

function makeRequest(testcaseCount: number): SandboxRequest {
  return {
    submissionId: "sub-int-orch",
    sourceCode: "print(input())",
    language: "python",
    problemType: "full_source",
    testcases: Array.from({ length: testcaseCount }, (_, i) => ({
      index: i,
      input: `in-${String(i)}\n`,
      output: `ans-${String(i)}\n`,
      weight: 1,
      isSample: false,
    })),
    judgeType: "interactive",
    judgeConfig: { interactorScript: "ok\n", interactorLanguage: "python" },
    limits: { timeoutMs: 2_000, memoryMb: 256 },
  };
}

interface CallRecord {
  configMapsCreated: { name: string; namespace: string }[];
  configMapsDeleted: { name: string; namespace: string }[];
  jobsCreated: { name: string; namespace: string }[];
  jobsDeleted: { name: string; namespace: string }[];
  podLogsRead: { name: string; namespace: string; container: string }[];
}

interface FakeOptions {
  perJob?: Map<string, { solution: string; interactor: string }>;
  outcomes?: Map<string, "succeeded" | "failed">;
}

function buildFakeClients(record: CallRecord, opts: FakeOptions = {}) {
  const coreApi = {
    createNamespacedConfigMap: vi.fn(async ({ namespace, body }: any) => {
      record.configMapsCreated.push({ name: body.metadata.name, namespace });
    }),
    deleteNamespacedConfigMap: vi.fn(async ({ name, namespace }: any) => {
      record.configMapsDeleted.push({ name, namespace });
    }),
    listNamespacedPod: vi.fn(async ({ labelSelector }: any) => {
      const jobName = String(labelSelector).split("=")[1];
      return { items: [{ metadata: { name: `${jobName}-pod` } }] };
    }),
    readNamespacedPodLog: vi.fn(async ({ name, namespace, container }: any) => {
      record.podLogsRead.push({ name, namespace, container });
      const jobName = String(name).replace(/-pod$/, "");
      const logs = opts.perJob?.get(jobName);
      if (!logs) return "";
      return container === "solution" ? logs.solution : logs.interactor;
    }),
  } as any;

  const batchApi = {
    createNamespacedJob: vi.fn(async ({ namespace, body }: any) => {
      record.jobsCreated.push({ name: body.metadata.name, namespace });
    }),
    deleteNamespacedJob: vi.fn(async ({ name, namespace }: any) => {
      record.jobsDeleted.push({ name, namespace });
    }),
    readNamespacedJob: vi.fn(async ({ name }: any) => {
      const status = opts.outcomes?.get(name) ?? "succeeded";
      return { status: { [status]: 1 } };
    }),
  } as any;

  return { coreApi, batchApi };
}

function emptyRecord(): CallRecord {
  return {
    configMapsCreated: [],
    configMapsDeleted: [],
    jobsCreated: [],
    jobsDeleted: [],
    podLogsRead: [],
  };
}

const EXEC_CONFIG = {
  namespace: "nojv-sandbox",
  image: "nojv-sandbox:test",
  cpuRequest: "100m",
  cpuLimit: "1",
  memoryRequest: "128Mi",
  memoryLimit: "256Mi",
};

describe("K8sExecutor.executeInteractive — per-case sequential loop + cleanup", () => {
  it("creates two ConfigMaps + one Job per case, sequentially, and cleans all of them up", async () => {
    const record = emptyRecord();
    const request = makeRequest(3);
    const perJob = new Map([
      [
        "judge-sub-int-orch-int-0",
        {
          solution: runMarker({ exitCode: 0, timeMs: 5, errorVerdict: null }),
          interactor: intMarker({ verdict: "AC", score: 100 }),
        },
      ],
      [
        "judge-sub-int-orch-int-1",
        {
          solution: runMarker({ exitCode: 0, timeMs: 5, errorVerdict: null }),
          interactor: intMarker({ verdict: "WA", score: 50, teamMessage: "wrong" }),
        },
      ],
      [
        "judge-sub-int-orch-int-2",
        {
          solution: runMarker({ exitCode: 1, timeMs: 4, errorVerdict: "RE" }),
          interactor: intMarker({ verdict: "AC" }),
        },
      ],
    ]);

    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { perJob }));
    const result = await executor.execute(request);

    expect(record.jobsCreated.map((j) => j.name)).toEqual([
      "judge-sub-int-orch-int-0",
      "judge-sub-int-orch-int-1",
      "judge-sub-int-orch-int-2",
    ]);

    expect(record.configMapsCreated.map((c) => c.name)).toEqual([
      "judge-sub-int-orch-int-0-sol",
      "judge-sub-int-orch-int-0-int",
      "judge-sub-int-orch-int-1-sol",
      "judge-sub-int-orch-int-1-int",
      "judge-sub-int-orch-int-2-sol",
      "judge-sub-int-orch-int-2-int",
    ]);

    expect(
      record.configMapsDeleted.map((c) => c.name).sort((a, b) => Number(a > b) - Number(a < b)),
    ).toEqual(
      record.configMapsCreated.map((c) => c.name).sort((a, b) => Number(a > b) - Number(a < b)),
    );
    expect(
      record.jobsDeleted.map((j) => j.name).sort((a, b) => Number(a > b) - Number(a < b)),
    ).toEqual(
      record.jobsCreated.map((j) => j.name).sort((a, b) => Number(a > b) - Number(a < b)),
    );

    expect(result.testcaseResults).toBeDefined();
    const tcResults = result.testcaseResults!;
    expect(tcResults.length).toBe(3);
    expect(tcResults[0]!.verdict).toBe("AC");
    expect(tcResults[1]!.verdict).toBe("WA");
    expect(tcResults[1]!.score).toBe(50);
    expect(tcResults[2]!.verdict).toBe("RE");
  });

  it("reads each container's logs SEPARATELY (passes the container parameter)", async () => {
    const record = emptyRecord();
    const request = makeRequest(1);
    const perJob = new Map([
      [
        "judge-sub-int-orch-int-0",
        {
          solution: runMarker({ exitCode: 0, timeMs: 5, errorVerdict: null }),
          interactor: intMarker({ verdict: "AC" }),
        },
      ],
    ]);

    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { perJob }));
    await executor.execute(request);

    const containers = record.podLogsRead
      .map((p) => p.container)
      .sort((a, b) => Number(a > b) - Number(a < b));
    expect(containers).toEqual(["interactor", "solution"]);

    for (const call of record.podLogsRead) {
      expect(call.name).toBe("judge-sub-int-orch-int-0-pod");
      expect(call.namespace).toBe("nojv-sandbox");
    }
  });

  it("a per-case failure does not stop subsequent cases; cleanup still runs for the failed case", async () => {
    const record = emptyRecord();
    const request = makeRequest(2);
    const perJob = new Map([
      [
        "judge-sub-int-orch-int-0",
        { solution: "garbled output\n", interactor: intMarker({ verdict: "AC" }) },
      ],
      [
        "judge-sub-int-orch-int-1",
        {
          solution: runMarker({ exitCode: 0, timeMs: 7, errorVerdict: null }),
          interactor: intMarker({ verdict: "AC", score: 100 }),
        },
      ],
    ]);

    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { perJob }));
    const result = await executor.execute(request);

    const tcResults = result.testcaseResults!;
    expect(tcResults[0]!.verdict).toBe("SE");
    expect(tcResults[1]!.verdict).toBe("AC");

    expect(record.jobsCreated).toHaveLength(2);
    expect(record.jobsDeleted).toHaveLength(2);
    expect(record.configMapsDeleted).toHaveLength(4);
  });

  it("a failed Job (e.g. activeDeadline) results in SE for that case", async () => {
    const record = emptyRecord();
    const request = makeRequest(1);
    const outcomes = new Map<string, "succeeded" | "failed">([
      ["judge-sub-int-orch-int-0", "failed"],
    ]);

    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { outcomes }));
    const result = await executor.execute(request);

    expect(result.testcaseResults![0]!.verdict).toBe("SE");
    expect(record.jobsDeleted).toHaveLength(1);
    expect(record.configMapsDeleted).toHaveLength(2);
  });

  it(
    "REGRESSION: Job-failed but both markers present → real verdict, not SE " +
      "(every successful K8s interactive run reports the Job as failed because the " +
      "solution-side socat exits non-zero with 'broken pipe' the moment the " +
      "interactor's socat closes the TCP connection)",
    async () => {
      const record = emptyRecord();
      const request = makeRequest(1);
      const perJob = new Map([
        [
          "judge-sub-int-orch-int-0",
          {
            solution: runMarker({ exitCode: 0, timeMs: 5, errorVerdict: null }),
            interactor: intMarker({
              verdict: "WA",
              score: 0,
              teamMessage: "guess budget exhausted",
            }),
          },
        ],
      ]);
      const outcomes = new Map<string, "succeeded" | "failed">([
        ["judge-sub-int-orch-int-0", "failed"],
      ]);

      const executor = new K8sExecutor(
        EXEC_CONFIG,
        buildFakeClients(record, { perJob, outcomes }),
      );
      const result = await executor.execute(request);

      expect(result.testcaseResults![0]!.verdict).toBe("WA");
      expect(result.testcaseResults![0]!.feedback).toBe("guess budget exhausted");
    },
  );

  it("a forged marker (interactor outcome but no run marker) → SE", async () => {
    const record = emptyRecord();
    const request = makeRequest(1);
    const perJob = new Map([
      [
        "judge-sub-int-orch-int-0",
        {
          solution: "look ma no marker\n",
          interactor: intMarker({ verdict: "AC", score: 100 }),
        },
      ],
    ]);

    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { perJob }));
    const result = await executor.execute(request);

    expect(result.testcaseResults![0]!.verdict).toBe("SE");
  });

  it("a missing interactor marker (run clean but interactor silent) → SE", async () => {
    const record = emptyRecord();
    const request = makeRequest(1);
    const perJob = new Map([
      [
        "judge-sub-int-orch-int-0",
        {
          solution: runMarker({ exitCode: 0, timeMs: 5, errorVerdict: null }),
          interactor: "interactor crashed silently\n",
        },
      ],
    ]);

    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { perJob }));
    const result = await executor.execute(request);

    expect(result.testcaseResults![0]!.verdict).toBe("SE");
  });

  it("returns SE for the whole request when the interactor script is missing", async () => {
    const record = emptyRecord();
    const request = makeRequest(1);
    const broken = {
      ...request,
      judgeConfig: { interactorLanguage: "python" as const },
    };

    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record));
    const result = await executor.execute(broken);

    expect(result.testcaseResults![0]!.verdict).toBe("SE");
    expect(record.jobsCreated).toHaveLength(0);
    expect(record.configMapsCreated).toHaveLength(0);
  });
});

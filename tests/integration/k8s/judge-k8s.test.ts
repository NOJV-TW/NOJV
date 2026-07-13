import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import {
  K8sExecutor,
  type K8sExecutorConfig,
} from "../../../apps/worker/src/services/k8s-executor.js";
import {
  assertK8sIntegrationOptIn,
  assertSafeK8sIntegrationTarget,
} from "../../setup/k8s-integration-target.js";

const require = createRequire(import.meta.url);

const SANDBOX_IMAGE = "nojv-sandbox:local";
const DEMO_RUN_IMAGE = "nojv-demo-advanced-run:local";
const DEMO_GRADE_IMAGE = "nojv-demo-advanced-grade:local";
const DEMO_SERVICE_IMAGE = "nojv-demo-advanced-service:local";

const SUM_SOLUTION = "a, b = map(int, input().split())\nprint(a + b)\n";
const WRONG_SUM_SOLUTION = "a, b = map(int, input().split())\nprint(a - b)\n";
const SERVICE_HEALTH_SUM_SOLUTION = `import json
import os
import urllib.request

service_host = os.environ["NOJV_SERVICE_HOST"]
with urllib.request.urlopen(f"http://{service_host}/health", timeout=5) as response:
    if response.status != 200 or json.load(response) != {"status": "ok"}:
        raise RuntimeError("service health check failed")

a, b = map(int, input().split())
print(a + b)
`;

const EXECUTOR_CONFIG: Omit<K8sExecutorConfig, "namespace"> = {
  image: SANDBOX_IMAGE,
  cpuRequest: "100m",
  cpuLimit: "500m",
  memoryRequest: "128Mi",
  memoryLimit: "256Mi",
};

const STANDARD_TIMEOUT_MS = 180_000;
const INTERACTIVE_TIMEOUT_MS = 240_000;
const ADVANCED_TIMEOUT_MS = 180_000;

let clients: {
  coreApi: k8s.CoreV1Api;
  batchApi: k8s.BatchV1Api;
  networkingApi: k8s.NetworkingV1Api;
} | null = null;
let namespace = "";

const VALIDATOR_SCRIPT = `team = team_output.split()
ans = judge_answer.split()
if team == ans:
    accept("exact match")
elif team and team == ans[:len(team)]:
    wrong("partial prefix")
else:
    wrong("wrong answer")
`;

const INTERACTOR_SCRIPT = `secret = int(judge_input.split()[0])
budget = 7
for attempt in range(budget):
    try:
        guess = int(read())
    except ValueError:
        wrong("non-integer guess")
    if guess == secret:
        write("correct")
        accept("found in " + str(attempt + 1) + " guesses")
    elif guess < secret:
        write("higher")
    else:
        write("lower")
wrong("guess budget exhausted")
`;

const BINARY_SEARCH_SOLUTION = `import sys
lo, hi = 1, 100
while True:
    mid = (lo + hi) // 2
    print(mid, flush=True)
    resp = sys.stdin.readline().strip()
    if resp == "correct":
        break
    elif resp == "higher":
        lo = mid + 1
    else:
        hi = mid - 1
`;

const STUBBORN_SOLUTION = `import sys
for _ in range(20):
    print(0, flush=True)
    sys.stdin.readline()
`;

const createdJobs = new Set<string>();
const createdConfigMaps = new Set<string>();
const createdPvcs = new Set<string>();
const createdPods = new Set<string>();
const createdServices = new Set<string>();
const createdNetworkPolicies = new Set<string>();

function trackSubmission(
  submissionId: string,
  opts: { interactiveCases?: number[]; advanced?: boolean } = {},
): void {
  const base = `judge-${submissionId}`;
  createdJobs.add(base);
  createdConfigMaps.add(base);
  createdJobs.add(`${base}-validate`);
  createdConfigMaps.add(`${base}-validate`);
  createdConfigMaps.add(`${base}-input`);
  if (opts.advanced) {
    createdJobs.add(`${base}-run`);
    createdJobs.add(`${base}-grade`);
    createdConfigMaps.add(`${base}-run-input`);
    createdConfigMaps.add(`${base}-grade-input`);
    createdPvcs.add(`${base}-runout`);
    createdPods.add(`${base}-sidecar`);
    createdServices.add(`${base}-sidecar`);
    createdNetworkPolicies.add(`${base}-run-egress`);
    createdNetworkPolicies.add(`${base}-grade-egress`);
    createdNetworkPolicies.add(`${base}-sidecar-egress`);
  }
  for (const idx of opts.interactiveCases ?? []) {
    const jobName = `${base}-int-${idx}`;
    createdJobs.add(jobName);
    createdConfigMaps.add(`${jobName}-sol`);
    createdConfigMaps.add(`${jobName}-int`);
  }
}

async function deleteJob(name: string): Promise<void> {
  if (!clients) return;
  try {
    await clients.batchApi.deleteNamespacedJob({
      name,
      namespace,
      propagationPolicy: "Background",
    });
  } catch {}
}

async function deleteConfigMap(name: string): Promise<void> {
  if (!clients) return;
  try {
    await clients.coreApi.deleteNamespacedConfigMap({ name, namespace });
  } catch {}
}

async function deletePvc(name: string): Promise<void> {
  if (!clients) return;
  try {
    await clients.coreApi.deleteNamespacedPersistentVolumeClaim({ name, namespace });
  } catch {}
}

async function deletePod(name: string): Promise<void> {
  if (!clients) return;
  try {
    await clients.coreApi.deleteNamespacedPod({
      name,
      namespace,
      propagationPolicy: "Background",
    });
  } catch {}
}

async function deleteService(name: string): Promise<void> {
  if (!clients) return;
  try {
    await clients.coreApi.deleteNamespacedService({ name, namespace });
  } catch {}
}

async function deleteNetworkPolicy(name: string): Promise<void> {
  if (!clients) return;
  try {
    await clients.networkingApi.deleteNamespacedNetworkPolicy({ name, namespace });
  } catch {}
}

beforeAll(async () => {
  assertK8sIntegrationOptIn(process.env);
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  const kc = new k8sLib.KubeConfig();
  kc.loadFromDefault();
  const target = assertSafeK8sIntegrationTarget({
    env: process.env,
    context: kc.getCurrentContext(),
    server: kc.getCurrentCluster()?.server ?? "",
  });
  namespace = target.namespace;

  const coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
  const batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
  const networkingApi = kc.makeApiClient(k8sLib.NetworkingV1Api);
  await coreApi.listNamespacedPod({ namespace });
  clients = { coreApi, batchApi, networkingApi };
}, 30_000);

afterEach(async () => {
  if (!clients) return;
  const jobs = Array.from(createdJobs);
  const cms = Array.from(createdConfigMaps);
  const pvcs = Array.from(createdPvcs);
  const pods = Array.from(createdPods);
  const services = Array.from(createdServices);
  const networkPolicies = Array.from(createdNetworkPolicies);
  createdJobs.clear();
  createdConfigMaps.clear();
  createdPvcs.clear();
  createdPods.clear();
  createdServices.clear();
  createdNetworkPolicies.clear();
  await Promise.all([
    ...jobs.map(deleteJob),
    ...cms.map(deleteConfigMap),
    ...pvcs.map(deletePvc),
    ...pods.map(deletePod),
    ...services.map(deleteService),
    ...networkPolicies.map(deleteNetworkPolicy),
  ]);
}, 60_000);

function makeExecutor(): K8sExecutor {
  if (!clients) throw new Error("clients not initialised");
  return new K8sExecutor({ ...EXECUTOR_CONFIG, namespace }, clients);
}

function sidecarLeaked(pods: k8s.V1Pod[], name: string): boolean {
  const pod = pods.find((p) => p.metadata?.name === name);
  if (!pod) return false;
  return pod.metadata?.deletionTimestamp == null;
}

describe("K8s judge — standard mode", () => {
  it("AC: correct python solution", { timeout: STANDARD_TIMEOUT_MS }, async () => {
    const submissionId = `k8s-std-correct-${Date.now()}`;
    trackSubmission(submissionId);

    const request: SandboxRequest = {
      submissionId,
      sourceCode: "n = int(input()); print(n)\n",
      language: "python",
      problemType: "full_source",
      testcases: [
        { index: 0, input: "1\n", output: "1\n", weight: 1, isSample: false },
        { index: 1, input: "42\n", output: "42\n", weight: 1, isSample: false },
      ],
      judgeType: "standard",
      judgeConfig: {},
      limits: { timeoutMs: 5_000, memoryMb: 128 },
    };

    const result = await makeExecutor().execute(request);
    expect(result.compilationError).toBeUndefined();
    expect(result.pipelineError).toBeUndefined();
    expect(result.testcaseResults.length).toBe(2);
    for (const tc of result.testcaseResults) {
      expect(tc.verdict).toBe("AC");
    }
  });

  it(
    "ISOLATION: exploit reading expected files cannot get AC",
    { timeout: STANDARD_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-std-exploit-${Date.now()}`;
      trackSubmission(submissionId);

      const exploit = `import glob, os
chunks = []
for p in (
    glob.glob("/submission/testcase-*-expected.txt")
    + glob.glob("/submission/testcases/*/expected.txt")
    + glob.glob("/submission/cases/*/answer.txt")
):
    try: chunks.append(open(p).read())
    except OSError: pass
print("".join(chunks))
`;

      const request: SandboxRequest = {
        submissionId,
        sourceCode: exploit,
        language: "python",
        problemType: "full_source",
        testcases: [
          { index: 0, input: "1 2\n", output: "3\n", weight: 1, isSample: false },
          { index: 1, input: "10 20\n", output: "30\n", weight: 1, isSample: false },
        ],
        judgeType: "standard",
        judgeConfig: {},
        limits: { timeoutMs: 5_000, memoryMb: 128 },
      };

      const result = await makeExecutor().execute(request);
      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );

  it(
    "AC: multi_file solution (main.py imports lib.py)",
    { timeout: STANDARD_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-std-multifile-${Date.now()}`;
      trackSubmission(submissionId);

      const request: SandboxRequest = {
        submissionId,
        sourceCode: "",
        sourceFiles: [
          {
            path: "main.py",
            content:
              "from lib import add\na, b = map(int, input().split())\nprint(add(a, b))\n",
          },
          { path: "lib.py", content: "def add(a, b):\n    return a + b\n" },
        ],
        language: "python",
        problemType: "multi_file",
        entryFile: "main.py",
        testcases: [
          { index: 0, input: "1 2\n", output: "3\n", weight: 1, isSample: false },
          { index: 1, input: "10 20\n", output: "30\n", weight: 1, isSample: false },
        ],
        judgeType: "standard",
        judgeConfig: {},
        limits: { timeoutMs: 5_000, memoryMb: 128 },
      };

      const result = await makeExecutor().execute(request);
      expect(result.compilationError).toBeUndefined();
      expect(result.pipelineError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("AC");
      }
    },
  );
});

function checkerRequest(overrides: Partial<SandboxRequest>): SandboxRequest {
  return {
    submissionId: "checker-default",
    sourceCode: "",
    language: "python",
    problemType: "full_source",
    testcases: [
      { index: 0, input: "1 2\n", output: "1 2 3\n", weight: 1, isSample: false },
      { index: 1, input: "10 20\n", output: "10 20 30\n", weight: 1, isSample: false },
    ],
    judgeType: "checker",
    judgeConfig: { checkerScript: VALIDATOR_SCRIPT, checkerLanguage: "python" },
    limits: { timeoutMs: 5_000, memoryMb: 128 },
    ...overrides,
  };
}

describe("K8s judge — checker mode", () => {
  it(
    "AC: correct solution graded by isolated validator",
    { timeout: STANDARD_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-chk-correct-${Date.now()}`;
      trackSubmission(submissionId);

      const result = await makeExecutor().execute(
        checkerRequest({
          submissionId,
          sourceCode: "a, b = map(int, input().split())\nprint(a, b, a + b)\n",
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("AC");
      }
    },
  );

  it(
    "WA: wrong solution graded by isolated validator",
    { timeout: STANDARD_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-chk-wrong-${Date.now()}`;
      trackSubmission(submissionId);

      const result = await makeExecutor().execute(
        checkerRequest({ submissionId, sourceCode: "print('totally wrong')\n" }),
      );

      expect(result.compilationError).toBeUndefined();
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("WA");
      }
    },
  );

  it(
    "WA: prefix-only solution graded by isolated validator (checker is AC/WA only)",
    { timeout: STANDARD_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-chk-partial-${Date.now()}`;
      trackSubmission(submissionId);

      const result = await makeExecutor().execute(
        checkerRequest({
          submissionId,
          sourceCode: "a, b = map(int, input().split())\nprint(a, b)\n",
        }),
      );

      expect(result.compilationError).toBeUndefined();
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("WA");
      }
    },
  );

  it(
    "ISOLATION: exploit reading validator.* or answer files cannot get AC",
    { timeout: STANDARD_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-chk-exploit-${Date.now()}`;
      trackSubmission(submissionId);

      const exploit = `import glob, os
chunks = []
for p in (
    glob.glob("/submission/validator.*")
    + glob.glob("/submission/case-*-answer.txt")
    + glob.glob("/submission/testcase-*-expected.txt")
    + glob.glob("/submission/cases/*/answer.txt")
    + glob.glob("/submission/testcases/*/expected.txt")
):
    try: chunks.append(open(p).read())
    except OSError: pass
print("".join(chunks))
`;

      const result = await makeExecutor().execute(
        checkerRequest({ submissionId, sourceCode: exploit }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );
});

function interactiveRequest(overrides: Partial<SandboxRequest>): SandboxRequest {
  return {
    submissionId: "interactive-default",
    sourceCode: "",
    language: "python",
    problemType: "full_source",
    testcases: [
      { index: 0, input: "42\n", weight: 1, isSample: false },
      { index: 1, input: "73\n", weight: 1, isSample: false },
    ],
    judgeType: "interactive",
    judgeConfig: { interactorScript: INTERACTOR_SCRIPT, interactorLanguage: "python" },
    limits: { timeoutMs: 5_000, memoryMb: 128 },
    ...overrides,
  };
}

describe("K8s judge — interactive mode", () => {
  it(
    "AC: binary search solution with partial score from interactor",
    { timeout: INTERACTIVE_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-int-correct-${Date.now()}`;
      trackSubmission(submissionId, { interactiveCases: [0, 1] });

      const result = await makeExecutor().execute(
        interactiveRequest({ submissionId, sourceCode: BINARY_SEARCH_SOLUTION }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("AC");
      }
    },
  );

  it(
    "stubborn always-zero solution does NOT get AC (budget exhausted)",
    { timeout: INTERACTIVE_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-int-stubborn-${Date.now()}`;
      trackSubmission(submissionId, { interactiveCases: [0, 1] });

      const result = await makeExecutor().execute(
        interactiveRequest({ submissionId, sourceCode: STUBBORN_SOLUTION }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );

  it(
    "ISOLATION: solution container cannot read the secret input",
    { timeout: INTERACTIVE_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-int-exploit-${Date.now()}`;
      trackSubmission(submissionId, { interactiveCases: [0, 1] });

      const exploit = `import sys, glob, os
secret = None
for p in (
    glob.glob("/submission/case-*-input.txt")
    + glob.glob("/submission/testcase-*-input.txt")
    + glob.glob("/submission/cases/*/input.txt")
    + glob.glob("/submission/testcases/*/input.txt")
):
    try:
        secret = open(p).read().split()[0]
        break
    except OSError:
        pass
if secret is None:
    secret = "-1"
for _ in range(20):
    print(secret, flush=True)
    resp = sys.stdin.readline().strip()
    if resp == "correct":
        break
`;

      const result = await makeExecutor().execute(
        interactiveRequest({ submissionId, sourceCode: exploit }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );
});

type AdvancedNetwork = NonNullable<SandboxRequest["advanced"]>["network"];

function advancedRequest(
  submissionId: string,
  mainPy: string,
  network: AdvancedNetwork,
): SandboxRequest {
  return {
    submissionId,
    sourceCode: "",
    sourceFiles: [{ path: "main.py", content: mainPy }],
    language: "python",
    problemType: "full_source",
    testcases: [],
    judgeType: "standard",
    judgeConfig: {},
    limits: { timeoutMs: 30_000, memoryMb: 256 },
    advanced: {
      run: { imageRef: DEMO_RUN_IMAGE, imageSource: "registry" },
      grade: { imageRef: DEMO_GRADE_IMAGE, imageSource: "registry" },
      network,
      totalTimeMs: 60_000,
      memoryMb: 256,
      maxScore: 100,
    },
  };
}

describe("K8s judge — advanced mode", () => {
  it(
    "AC: correct sum solution through run+grade split (network none)",
    { timeout: ADVANCED_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-adv-correct-${Date.now()}`;
      trackSubmission(submissionId, { advanced: true });

      const result = await makeExecutor().execute(
        advancedRequest(submissionId, SUM_SOLUTION, { mode: "none" }),
      );
      expect(result.compilationError).toBeUndefined();
      expect(result.pipelineError).toBeUndefined();
      expect(result.testcaseResults.length).toBeGreaterThanOrEqual(1);
      expect(result.testcaseResults.every((tc) => tc.verdict === "AC")).toBe(true);
      expect(result.customScore).toBe(100);
    },
  );

  it(
    "WA: wrong sum solution through run+grade split (network none)",
    { timeout: ADVANCED_TIMEOUT_MS },
    async () => {
      const submissionId = `k8s-adv-wrong-${Date.now()}`;
      trackSubmission(submissionId, { advanced: true });

      const result = await makeExecutor().execute(
        advancedRequest(submissionId, WRONG_SUM_SOLUTION, { mode: "none" }),
      );
      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBeGreaterThanOrEqual(1);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("WA");
      }
      expect(result.customScore).toBe(0);
    },
  );

  it(
    "AC: service network mode submission reaches the dedicated service /health endpoint",
    { timeout: ADVANCED_TIMEOUT_MS },
    async () => {
      const activeClients = clients;
      if (!activeClients) throw new Error("clients not initialised");

      const submissionId = `k8s-adv-service-${Date.now()}`;
      const base = `judge-${submissionId}`;
      trackSubmission(submissionId, { advanced: true });

      const result = await makeExecutor().execute(
        advancedRequest(submissionId, SERVICE_HEALTH_SUM_SOLUTION, {
          mode: "service",
          service: { imageRef: DEMO_SERVICE_IMAGE, imageSource: "registry" },
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.pipelineError).toBeUndefined();
      expect(result.testcaseResults.length).toBeGreaterThanOrEqual(1);
      expect(result.testcaseResults.every((tc) => tc.verdict === "AC")).toBe(true);
      expect(result.customScore).toBe(100);

      const svcAfter = await activeClients.coreApi
        .listNamespacedService({ namespace })
        .catch(() => ({ items: [] }));
      expect((svcAfter.items ?? []).some((s) => s.metadata?.name === `${base}-sidecar`)).toBe(
        false,
      );
      const podsAfter = await activeClients.coreApi
        .listNamespacedPod({ namespace })
        .catch(() => ({ items: [] }));
      expect(sidecarLeaked(podsAfter.items ?? [], `${base}-sidecar`)).toBe(false);
    },
  );
});

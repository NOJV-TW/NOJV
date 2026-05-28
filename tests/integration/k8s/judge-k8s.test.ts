/**
 * K8s judge-pipeline integration suite.
 *
 * Drives the production `K8sExecutor` against a REAL local k3d cluster across
 * all four judge modes (standard / checker / interactive / advanced) and
 * verifies BOTH correctness AND the per-mode isolation invariants end-to-end:
 *
 *   - standard mode: the run pod's ConfigMap excludes
 *     `testcase-{i}-expected.txt` → an exploit that reads the answer off disk
 *     cannot get AC.
 *   - checker mode: the validator script + per-case answer files live in a
 *     SEPARATE validate Job's ConfigMap → the run pod cannot exfiltrate the
 *     answer.
 *   - interactive mode: the per-case secret input is mounted ONLY into the
 *     interactor container's ConfigMap, never the solution container.
 *   - advanced mode (registry source): grader pod produces a schema-valid
 *     result.json (read off the native sidecar's stdout) and customScore
 *     propagates. Tarball source on K8s fail-fasts with no Job created.
 *
 * The suite SKIPS CLEANLY if the cluster is unreachable so it never breaks
 * unrelated CI runs. It assumes:
 *   - KUBECONFIG: ~/.kube/config, context k3d-nojv-judge
 *   - Namespace nojv-sandbox already provisioned with NetworkPolicy,
 *     ResourceQuota, LimitRange (managed out-of-band).
 *   - Images already loaded into the cluster: nojv-sandbox:local +
 *     nojv-demo-judge-shell:local.
 *
 * Run:
 *   pnpm vitest run tests/integration/k8s/judge-k8s.test.ts
 */
import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import {
  K8sExecutor,
  type K8sExecutorConfig,
} from "../../../apps/worker/src/services/k8s-executor.js";

const require = createRequire(import.meta.url);

const NAMESPACE = "nojv-sandbox";
const SANDBOX_IMAGE = "nojv-sandbox:local";
const DEMO_JUDGE_IMAGE = "nojv-demo-judge-shell:local";

// Smaller than production limits — k3d-on-laptop runs ResourceQuota
// requests.cpu: 25 / requests.memory: 12Gi across many parallel tests.
const EXECUTOR_CONFIG: K8sExecutorConfig = {
  namespace: NAMESPACE,
  image: SANDBOX_IMAGE,
  cpuRequest: "100m",
  cpuLimit: "500m",
  memoryRequest: "128Mi",
  memoryLimit: "256Mi",
};

// Per-test deadline — image pull on a cold k3d node can take ~30s, plus
// configmap + Job + pod schedule + Node start + runner exec. The interactive
// path serializes per case so doubles up.
const STANDARD_TIMEOUT_MS = 180_000;
const INTERACTIVE_TIMEOUT_MS = 240_000;
const ADVANCED_TIMEOUT_MS = 180_000;

let clients: { coreApi: k8s.CoreV1Api; batchApi: k8s.BatchV1Api } | null = null;
let clusterUnreachableReason: string | null = null;

// DOMjudge validator script: float-tolerant integer compare. Wraps the
// `python-validator.py` runner contract (team_output, judge_answer,
// accept/wrong/set_score/judge_log). Awards 50 partial when the team's output
// is a non-empty prefix of the answer (matches the docker checker test).
const VALIDATOR_SCRIPT = `team = team_output.split()
ans = judge_answer.split()
if team == ans:
    accept("exact match")
elif team and team == ans[:len(team)]:
    set_score(50)
    wrong("partial prefix")
else:
    wrong("wrong answer")
`;

// DOMjudge interactor (1..100 guessing game). Awards 100 - attempt*10.
// Same shape as interactive-isolation.test.ts so a green run here proves the
// K8s pod-shared-network bridge matches the Docker per-container bridge.
const INTERACTOR_SCRIPT = `secret = int(judge_input.split()[0])
budget = 7
for attempt in range(budget):
    try:
        guess = int(read())
    except ValueError:
        wrong("non-integer guess")
    if guess == secret:
        write("correct")
        set_score(100 - attempt * 10)
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

// Names we create across tests; afterEach force-deletes any that exist so a
// failed test never leaks resources into the next.
const createdJobs = new Set<string>();
const createdConfigMaps = new Set<string>();

function trackSubmission(
  submissionId: string,
  opts: { interactiveCases?: number[] } = {},
): void {
  const base = `judge-${submissionId}`;
  createdJobs.add(base);
  createdConfigMaps.add(base);
  // checker pipeline adds a -validate Job + ConfigMap
  createdJobs.add(`${base}-validate`);
  createdConfigMaps.add(`${base}-validate`);
  // advanced uses {base} for the Job and {base}-input for the ConfigMap
  createdConfigMaps.add(`${base}-input`);
  // interactive uses {base}-int-{i} for jobs and -sol / -int suffixes for cms
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
      namespace: NAMESPACE,
      propagationPolicy: "Background",
    });
  } catch {
    // already gone — fine
  }
}

async function deleteConfigMap(name: string): Promise<void> {
  if (!clients) return;
  try {
    await clients.coreApi.deleteNamespacedConfigMap({ name, namespace: NAMESPACE });
  } catch {
    // already gone — fine
  }
}

async function sweepNamespace(): Promise<void> {
  if (!clients) return;
  const [jobs, cms] = await Promise.all([
    clients.batchApi.listNamespacedJob({ namespace: NAMESPACE }).catch(() => ({ items: [] })),
    clients.coreApi
      .listNamespacedConfigMap({ namespace: NAMESPACE })
      .catch(() => ({ items: [] })),
  ]);
  const jobNames = (jobs.items ?? [])
    .map((j: k8s.V1Job) => j.metadata?.name)
    .filter((n): n is string => !!n && (n.startsWith("judge-") || n.startsWith("nojv-")));
  const cmNames = (cms.items ?? [])
    .map((c: k8s.V1ConfigMap) => c.metadata?.name)
    .filter((n): n is string => !!n && (n.startsWith("judge-") || n.startsWith("nojv-")));
  await Promise.all([
    ...jobNames.map((n) => deleteJob(n)),
    ...cmNames.map((n) => deleteConfigMap(n)),
  ]);
}

beforeAll(async () => {
  try {
    const k8sLib = require("@kubernetes/client-node") as typeof k8s;
    const kc = new k8sLib.KubeConfig();
    kc.loadFromDefault();
    const ctx = kc.getCurrentContext();
    if (ctx !== "k3d-nojv-judge") {
      // Allow override but warn loudly — we'd otherwise hit a real prod cluster.
      // eslint-disable-next-line no-console
      console.warn(
        `[k8s-judge-integration] current context is "${ctx}", expected "k3d-nojv-judge"`,
      );
    }
    const coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
    const batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
    // Cheap ping — if the cluster is down or unreachable this throws and we
    // skip the whole suite.
    await coreApi.listNamespacedPod({ namespace: NAMESPACE });
    clients = { coreApi, batchApi };
    await sweepNamespace();
  } catch (err) {
    clusterUnreachableReason = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[k8s-judge-integration] cluster unreachable, skipping suite: ${clusterUnreachableReason}`,
    );
  }
}, 30_000);

afterEach(async () => {
  if (!clients) return;
  const jobs = Array.from(createdJobs);
  const cms = Array.from(createdConfigMaps);
  createdJobs.clear();
  createdConfigMaps.clear();
  await Promise.all([...jobs.map(deleteJob), ...cms.map(deleteConfigMap)]);
}, 60_000);

afterAll(async () => {
  await sweepNamespace();
}, 60_000);

function skipIfUnreachable(ctx: { skip: () => void }): boolean {
  if (clusterUnreachableReason !== null) {
    // eslint-disable-next-line no-console
    console.warn(`[skip] cluster unreachable: ${clusterUnreachableReason}`);
    ctx.skip();
    return true;
  }
  return false;
}

function makeExecutor(): K8sExecutor {
  if (!clients) throw new Error("clients not initialised — beforeAll must have skipped");
  return new K8sExecutor(EXECUTOR_CONFIG, clients);
}

// ---------------------------------------------------------------------------
// Test 1 — Standard mode
// ---------------------------------------------------------------------------

describe("K8s judge — standard mode", () => {
  it("AC: correct python solution", { timeout: STANDARD_TIMEOUT_MS }, async (ctx) => {
    if (skipIfUnreachable(ctx)) return;

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
    // standard mode returns rawRuns from the runner — worker-side
    // comparison turns those into testcaseResults via resolveSandboxResult.
    expect(result.testcaseResults.length).toBe(2);
    for (const tc of result.testcaseResults) {
      expect(tc.verdict).toBe("AC");
      expect(tc.score).toBe(100);
    }
  });

  it(
    "ISOLATION: exploit reading expected files cannot get AC",
    { timeout: STANDARD_TIMEOUT_MS },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;

      const submissionId = `k8s-std-exploit-${Date.now()}`;
      trackSubmission(submissionId);

      // Try every plausible layout: the new k8s flat layout, the docker
      // testcases/ tree, and the docker cases/ tree. Phase 1 strips
      // `testcase-{i}-expected.txt` for standard mode, so /submission has only
      // `testcase-{i}-input.txt` — the glob returns nothing → echo nothing → WA.
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
        // SECURITY INVARIANT — if this becomes AC, the run pod ConfigMap is
        // leaking the answer and Phase 1 has regressed.
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Test 2 — Checker mode (DOMjudge validator in a separate Job)
// ---------------------------------------------------------------------------

describe("K8s judge — checker mode", () => {
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

  it(
    "AC: correct solution graded by isolated validator",
    { timeout: STANDARD_TIMEOUT_MS },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;

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
        expect(tc.score).toBe(100);
      }
    },
  );

  it(
    "WA: wrong solution graded by isolated validator",
    { timeout: STANDARD_TIMEOUT_MS },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;

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
    "partial: validator-supplied set_score flows through",
    { timeout: STANDARD_TIMEOUT_MS },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;

      const submissionId = `k8s-chk-partial-${Date.now()}`;
      trackSubmission(submissionId);

      // Print just the two inputs — a non-empty prefix of the expected
      // "a b a+b" → validator awards set_score(50) on the WA branch.
      const result = await makeExecutor().execute(
        checkerRequest({
          submissionId,
          sourceCode: "a, b = map(int, input().split())\nprint(a, b)\n",
        }),
      );

      expect(result.compilationError).toBeUndefined();
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("WA");
        expect(tc.score).toBe(50);
      }
    },
  );

  it(
    "ISOLATION: exploit reading validator.* or answer files cannot get AC",
    { timeout: STANDARD_TIMEOUT_MS },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;

      const submissionId = `k8s-chk-exploit-${Date.now()}`;
      trackSubmission(submissionId);

      // The validator script + per-case answers live in the SEPARATE validate
      // Job's ConfigMap, not the run pod's. Glob anything that looks like the
      // validator or the answer; print it as the team output. With isolation,
      // the run pod sees neither → echoed text is empty/garbage → validator
      // takes the wrong-answer branch.
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
        // SECURITY INVARIANT.
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Test 3 — Interactive mode (DOMjudge interactor, two-container pod)
// ---------------------------------------------------------------------------

describe("K8s judge — interactive mode", () => {
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

  it(
    "AC: binary search solution with partial score from interactor",
    { timeout: INTERACTIVE_TIMEOUT_MS },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;

      const submissionId = `k8s-int-correct-${Date.now()}`;
      trackSubmission(submissionId, { interactiveCases: [0, 1] });

      const result = await makeExecutor().execute(
        interactiveRequest({ submissionId, sourceCode: BINARY_SEARCH_SOLUTION }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("AC");
        expect(tc.score).toBeGreaterThan(0);
        expect(tc.score).toBeLessThanOrEqual(100);
      }
    },
  );

  it(
    "stubborn always-zero solution does NOT get AC (budget exhausted)",
    { timeout: INTERACTIVE_TIMEOUT_MS },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;

      const submissionId = `k8s-int-stubborn-${Date.now()}`;
      trackSubmission(submissionId, { interactiveCases: [0, 1] });

      const result = await makeExecutor().execute(
        interactiveRequest({ submissionId, sourceCode: STUBBORN_SOLUTION }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        // The CORRECTNESS invariant: a stubborn solution must NOT be AC. The
        // exact verdict (WA from the interactor's "budget exhausted" branch
        // vs. SE from a dropped marker) is intentionally not asserted: on
        // K8s the interactor's socat closes TCP the moment the interactor
        // exits with `wrong(...)`, which races with the solution-side
        // runner's marker emission + containerd's log-file flush. A real
        // production deploy would surface either WA or SE; both correctly
        // refuse to award AC. See apps/worker/src/services/k8s-executor.ts
        // executeInteractive doc for the socat-lifecycle teardown race.
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );

  it(
    "ISOLATION: solution container cannot read the secret input",
    { timeout: INTERACTIVE_TIMEOUT_MS },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;

      const submissionId = `k8s-int-exploit-${Date.now()}`;
      trackSubmission(submissionId, { interactiveCases: [0, 1] });

      // The per-case secret lives in the INTERACTOR container's ConfigMap
      // (case-{i}-input.txt). The solution container's ConfigMap has only the
      // student source + a stripped config.json — no testcase files at all.
      // The exploit tries every known layout; falls through to "-1" which
      // cannot satisfy higher/lower against 1..100 → not AC.
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
        // SECURITY INVARIANT.
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Test 4 — Advanced mode (registry source + tarball fail-fast)
// ---------------------------------------------------------------------------

describe("K8s judge — advanced mode", () => {
  it(
    "AC: demo grader (nojv-demo-judge-shell:local) runs and result.json flows back",
    { timeout: ADVANCED_TIMEOUT_MS },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;

      const submissionId = `k8s-adv-correct-${Date.now()}`;
      trackSubmission(submissionId);

      // The demo grader (infra/docker/demo-judge-shell/judge.sh):
      //   - reads /workspace/submission/main.sh
      //   - bash-runs it; if stdout contains "hello" → score 100, accepted.
      //   - missing main.sh → runtime_error / score 0.
      // We supply main.sh via sourceFiles so the path-aware
      // buildAdvancedConfigMapData drops it at /workspace/submission/main.sh
      // exactly. (language=python here is just for env vars + a stray main.py.)
      const request: SandboxRequest = {
        submissionId,
        sourceCode: "",
        sourceFiles: [{ path: "main.sh", content: "echo hello world\n" }],
        language: "python",
        problemType: "full_source",
        testcases: [],
        judgeType: "standard",
        judgeConfig: {},
        limits: { timeoutMs: 30_000, memoryMb: 256 },
        advanced: {
          imageRef: DEMO_JUDGE_IMAGE,
          imageSource: "registry",
          totalTimeMs: 60_000,
          memoryMb: 256,
        },
      };

      const result = await makeExecutor().execute(request);
      expect(result.compilationError).toBeUndefined();
      expect(result.pipelineError).toBeUndefined();
      // mapAdvancedResult either synthesises a single result from the
      // top-level verdict OR returns the image's per-case array. Either way
      // we expect at least one AC entry and customScore = 100.
      expect(result.testcaseResults.length).toBeGreaterThanOrEqual(1);
      expect(result.testcaseResults.every((tc) => tc.verdict === "AC")).toBe(true);
      expect(result.customScore).toBe(100);
    },
  );

  it(
    "WA: demo grader on a non-matching script → wrong_answer flows back",
    { timeout: ADVANCED_TIMEOUT_MS },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;

      const submissionId = `k8s-adv-wrong-${Date.now()}`;
      trackSubmission(submissionId);

      const request: SandboxRequest = {
        submissionId,
        sourceCode: "",
        sourceFiles: [{ path: "main.sh", content: "echo goodbye\n" }],
        language: "python",
        problemType: "full_source",
        testcases: [],
        judgeType: "standard",
        judgeConfig: {},
        limits: { timeoutMs: 30_000, memoryMb: 256 },
        advanced: {
          imageRef: DEMO_JUDGE_IMAGE,
          imageSource: "registry",
          totalTimeMs: 60_000,
          memoryMb: 256,
        },
      };

      const result = await makeExecutor().execute(request);
      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBeGreaterThanOrEqual(1);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("WA");
      }
      expect(result.customScore).toBe(0);
    },
  );

  it(
    "FAIL-FAST: tarball source on K8s returns SE and creates no Job/ConfigMap",
    { timeout: 30_000 },
    async (ctx) => {
      if (skipIfUnreachable(ctx)) return;
      if (!clients) return;

      const submissionId = `k8s-adv-tarball-${Date.now()}`;
      const jobName = `judge-${submissionId}`;
      const cmName = `${jobName}-input`;
      // Track in case the executor unexpectedly creates them — cleanup still runs.
      trackSubmission(submissionId);

      // Snapshot the namespace before/after to prove no resources were created.
      const before = await clients.batchApi.listNamespacedJob({ namespace: NAMESPACE });
      const beforeNames = new Set((before.items ?? []).map((j) => j.metadata?.name));

      const request: SandboxRequest = {
        submissionId,
        sourceCode: "print('hi')\n",
        language: "python",
        problemType: "full_source",
        testcases: [],
        judgeType: "standard",
        judgeConfig: {},
        limits: { timeoutMs: 30_000, memoryMb: 256 },
        advanced: {
          imageRef: "registry.example.com/ta/grader:1.0",
          imageSource: "tarball",
          totalTimeMs: 60_000,
          memoryMb: 256,
        },
      };

      const result = await makeExecutor().execute(request);
      expect(result.testcaseResults).toHaveLength(1);
      expect(result.testcaseResults[0]!.verdict).toBe("SE");
      const message = result.testcaseResults[0]!.feedback ?? result.testcaseResults[0]!.stderr;
      expect(message).toMatch(/registry/i);
      expect(message).toMatch(/tarball/i);

      // SECURITY INVARIANT: tarball source MUST NOT reach the cluster.
      const after = await clients.batchApi.listNamespacedJob({ namespace: NAMESPACE });
      const newJobs = (after.items ?? []).filter(
        (j) => j.metadata?.name && !beforeNames.has(j.metadata.name),
      );
      expect(newJobs).toHaveLength(0);

      const cmAfter = await clients.coreApi
        .listNamespacedConfigMap({ namespace: NAMESPACE })
        .catch(() => ({ items: [] }));
      expect((cmAfter.items ?? []).some((c) => c.metadata?.name === jobName)).toBe(false);
      expect((cmAfter.items ?? []).some((c) => c.metadata?.name === cmName)).toBe(false);
    },
  );
});

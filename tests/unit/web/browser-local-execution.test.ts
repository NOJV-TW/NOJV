import { expect, it, vi } from "vitest";
import {
  runBrowserCases,
  runBrowserChecker,
  runBrowserInteraction,
  runBrowserLocally,
} from "$lib/services/browser-local-run";

const engine = vi.hoisted(() => ({
  compile: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
    success: true,
    artifact: { id: "compiled", costProfile: "test-profile" },
  }),
  run: vi.fn().mockResolvedValue({
    termination: "exited",
    code: 0,
    stdout: "YES",
    stderr: "",
    durationMs: 1,
    metrics: { logicalTimeNs: 1, memoryBytes: 1024 },
  }),
  interact: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../../../apps/web/node_modules/@wasm-oj/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../apps/web/node_modules/@wasm-oj/browser")>()),
  createBrowserEngine: vi.fn().mockResolvedValue(engine),
}));

it("passes Standard Mode stdin, problem limits and runtime env to the browser engine", async () => {
  const result = await runBrowserLocally({
    request: {
      context: { type: "practice" },
      language: "python",
      problemId: "brackets",
      sourceCode: "print('YES')",
    },
    cases: [{ input: "(())", expectedOutput: "yes" }],
    judgeConfig: {
      type: "standard",
      compare: { caseSensitive: false },
      runtime: { env: { MODE: "strict" } },
    },
    problemId: "brackets",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    signal: new AbortController().signal,
  });
  expect(result?.feedback).toBe("Local browser run completed.");
  expect(engine.run).toHaveBeenCalledWith(
    { id: "compiled", costProfile: "test-profile" },
    expect.objectContaining({
      stdin: "(())",
      env: { MODE: "strict" },
      resources: expect.objectContaining({
        logicalTimeLimitMs: 3000,
        memoryLimitBytes: 256 * 1024 * 1024,
        outputLimitBytes: 16 * 1024 * 1024,
      }),
    }),
  );
  expect(result?.verdict).toBe("accepted");
});

it.each(["", "a", "a\n", "a\r\n", "a\n\n", " \t"])(
  "preserves exact custom input %j across languages",
  async (input) => {
    for (const language of [
      "c",
      "cpp",
      "go",
      "java",
      "javascript",
      "python",
      "rust",
      "typescript",
    ] as const) {
      await runBrowserLocally({
        request: {
          context: { type: "practice" },
          language,
          problemId: "exact-input",
          sourceCode: "source",
        },
        cases: [{ input }],
        judgeConfig: { type: "standard" },
        problemId: "exact-input",
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        signal: new AbortController().signal,
      });
      expect(engine.run).toHaveBeenLastCalledWith(
        { id: "compiled", costProfile: "test-profile" },
        expect.objectContaining({ stdin: input }),
      );
    }
  },
);

it("does not report acceptance when no testcase is provided", async () => {
  const result = await runBrowserLocally({
    request: {
      context: { type: "practice" },
      language: "c",
      problemId: "empty",
      sourceCode: "source",
    },
    cases: [],
    judgeConfig: { type: "standard" },
    problemId: "empty",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    signal: new AbortController().signal,
  });
  expect(result).toMatchObject({ accepted: false, verdict: "system_error", caseResults: [] });
});

it("distinguishes engine failures from compilation rejection", async () => {
  engine.run.mockRejectedValueOnce(new Error("Worker crashed"));
  const args = {
    request: {
      context: { type: "practice" as const },
      language: "c" as const,
      problemId: "failure",
      sourceCode: "source",
    },
    cases: [{ input: "" }],
    judgeConfig: { type: "standard" as const },
    problemId: "failure",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    signal: new AbortController().signal,
  };
  expect(await runBrowserLocally(args)).toMatchObject({ verdict: "system_error" });
  engine.compile.mockResolvedValueOnce({
    success: false,
    stderr: "syntax error",
    stdout: "",
    diagnostics: [],
  });
  expect(await runBrowserLocally(args)).toMatchObject({ verdict: "compile_error" });
});

it.each(["compile", "run"] as const)(
  "discards a completed %s result after cancellation and does not start another case",
  async (phase) => {
    const controller = new AbortController();
    const runsBefore = engine.run.mock.calls.length;
    const cancellationsBefore = engine.cancel.mock.calls.length;
    engine[phase].mockImplementationOnce(async () => {
      controller.abort();
      return phase === "compile"
        ? { success: true, artifact: { id: "compiled", costProfile: "test-profile" } }
        : {
            termination: "exited",
            code: 0,
            stdout: "YES",
            stderr: "",
            durationMs: 1,
            metrics: { logicalTimeNs: 1, memoryBytes: 1024 },
          };
    });
    const result = await runBrowserLocally({
      request: {
        context: { type: "practice" },
        language: "c",
        problemId: "cancelled",
        sourceCode: "source",
      },
      cases: [{ input: "first" }, { input: "second" }],
      judgeConfig: { type: "standard" },
      problemId: "cancelled",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      signal: controller.signal,
    });
    expect(result).toBeNull();
    expect(engine.run.mock.calls.length - runsBefore).toBe(phase === "compile" ? 0 : 1);
    expect(engine.cancel.mock.calls.length - cancellationsBefore).toBe(1);
  },
);

it("keeps short C wall limits aligned with the native 2x grace, without a browser-only floor", async () => {
  await runBrowserLocally({
    request: {
      context: { type: "practice" },
      language: "c",
      problemId: "short",
      sourceCode: "int main(){}",
    },
    cases: [{ input: "" }],
    judgeConfig: { type: "standard" },
    problemId: "short",
    timeLimitMs: 100,
    memoryLimitMb: 128,
    signal: new AbortController().signal,
  });
  expect(engine.run).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      resources: expect.objectContaining({ logicalTimeLimitMs: 100 }),
    }),
  );
});

it("leaves the clock, instruction budget and host safety deadline to Forge defaults", async () => {
  const costProfile = "java-profile";
  engine.compile.mockResolvedValueOnce({
    success: true,
    artifact: { id: "java", costProfile },
  });
  await runBrowserLocally({
    request: {
      context: { type: "practice" },
      language: "java",
      problemId: "fuel",
      sourceCode: "class Main {}",
    },
    cases: [{ input: "" }],
    judgeConfig: { type: "standard" },
    problemId: "fuel",
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    signal: new AbortController().signal,
  });
  const config = engine.run.mock.calls.at(-1)?.[1] as Record<string, unknown>;
  expect(config).not.toHaveProperty("determinism");
  expect(config.resources).not.toHaveProperty("instructionBudget");
  expect(config.resources).not.toHaveProperty("wallTimeLimitMs");
});

it("keeps the standard Test result for every termination kind", async () => {
  const fixtures = [
    { termination: "exited", code: 0, stdout: "1  2\n", stderr: "", memoryBytes: 2048 },
    { termination: "exited", code: 0, stdout: "wrong", stderr: "", memoryBytes: 4096 },
    { termination: "exited", code: 0, stdout: "free", stderr: "", memoryBytes: undefined },
    { termination: "exited", code: 1, stdout: "partial", stderr: "", memoryBytes: 1024 },
    {
      termination: "trap",
      code: 1,
      stdout: "",
      stderr: "",
      trapMessage: "unreachable executed",
      memoryBytes: 1024,
    },
    { termination: "logical-time-limit", code: 0, stdout: "", stderr: "", memoryBytes: 1024 },
    {
      termination: "memory-limit",
      code: 0,
      stdout: "",
      stderr: "\u001b[31mout of memory\u001b[0m",
      memoryBytes: 8_000_000,
    },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    engine.run.mockResolvedValueOnce({
      termination: fixture.termination,
      code: fixture.code,
      stdout: fixture.stdout,
      stderr: fixture.stderr,
      ...(fixture.trapMessage ? { trapMessage: fixture.trapMessage } : {}),
      durationMs: 1,
      metrics: { logicalTimeNs: (index + 1) * 1_500_000, memoryBytes: fixture.memoryBytes },
    });
  }
  const result = await runBrowserLocally({
    request: {
      context: { type: "practice" },
      language: "c",
      problemId: "fixtures",
      sourceCode: "source",
    },
    cases: [
      { input: "a", expectedOutput: "1 2" },
      { input: "b", expectedOutput: "right" },
      { input: "c" },
      { input: "d", expectedOutput: "partial" },
      { input: "e" },
      { input: "f", expectedOutput: "" },
      { input: "g" },
    ],
    judgeConfig: { type: "standard", compare: { caseSensitive: true, floatTolerance: null } },
    problemId: "fixtures",
    timeLimitMs: 1000,
    memoryLimitMb: 64,
    signal: new AbortController().signal,
  });
  expect(result).toMatchInlineSnapshot(`
    {
      "accepted": false,
      "caseResults": [
        {
          "index": 0,
          "memoryKb": 2,
          "stdout": "1  2
    ",
          "timeMs": 2,
          "verdict": "AC",
        },
        {
          "index": 1,
          "memoryKb": 4,
          "stdout": "wrong",
          "timeMs": 3,
          "verdict": "WA",
        },
        {
          "index": 2,
          "stdout": "free",
          "timeMs": 5,
          "verdict": "AC",
        },
        {
          "index": 3,
          "memoryKb": 1,
          "stderr": "Process exited with code 1.",
          "stdout": "partial",
          "timeMs": 6,
          "verdict": "RE",
        },
        {
          "index": 4,
          "memoryKb": 1,
          "stderr": "unreachable executed",
          "stdout": "",
          "timeMs": 8,
          "verdict": "RE",
        },
        {
          "index": 5,
          "memoryKb": 1,
          "stderr": "Time limit exceeded.",
          "stdout": "",
          "timeMs": 9,
          "verdict": "TLE",
        },
        {
          "index": 6,
          "memoryKb": 7813,
          "stderr": "out of memory",
          "stdout": "",
          "timeMs": 11,
          "verdict": "MLE",
        },
      ],
      "feedback": "One or more test cases failed.",
      "memoryKb": 7813,
      "runtimeMs": 11,
      "score": 0,
      "verdict": "wrong_answer",
    }
  `);
});

it("returns each raw run with its exit status and unjudged stdout", async () => {
  engine.run.mockResolvedValueOnce({
    termination: "exited",
    code: 0,
    stdout: "any valid answer",
    stderr: "",
    durationMs: 1,
    metrics: { logicalTimeNs: 2_000_000, memoryBytes: 2048 },
  });
  engine.run.mockResolvedValueOnce({
    termination: "exited",
    code: 3,
    stdout: "",
    stderr: "",
    durationMs: 1,
    metrics: { logicalTimeNs: 1, memoryBytes: 1024 },
  });
  const runs = await runBrowserCases(
    { kind: "wasm", bytes: new Uint8Array([0, 97, 115, 109]) } as never,
    [{ input: "1" }, { input: "2" }],
    { language: "cpp", timeLimitMs: 1000, memoryLimitMb: 64, env: {} },
    new AbortController().signal,
  );
  expect(runs).toEqual([
    {
      verdict: "AC",
      stdout: "any valid answer",
      timeMs: 2,
      memoryKb: 2,
      exitCode: 0,
      termination: "exited",
    },
    {
      verdict: "RE",
      stdout: "",
      stderr: "Process exited with code 3.",
      timeMs: 1,
      memoryKb: 1,
      exitCode: 3,
      termination: "exited",
    },
  ]);
});

function checkerRun(code: number, termination = "exited", teamMessage?: string) {
  return {
    termination,
    code,
    stdout: "",
    stderr: "",
    files:
      teamMessage === undefined
        ? {}
        : { "/judge/feedback/teammessage.txt": new TextEncoder().encode(teamMessage) },
    durationMs: 1,
    metrics: { logicalTimeNs: 1, memoryBytes: 1024 },
  };
}

it("runs a checker on the student's output with the sample as its input and answer", async () => {
  const checker = { id: "checker" } as never;
  engine.run.mockResolvedValueOnce(checkerRun(42, "exited", "Valid pair"));

  const judgement = await runBrowserChecker(
    checker,
    { input: "4 9\n2 7 11 15\n", answer: "0 1\n", output: "1 0\n", timeLimitMs: 1000 },
    new AbortController().signal,
  );

  expect(judgement).toEqual({ verdict: "AC", teamMessage: "Valid pair" });
  expect(engine.run).toHaveBeenLastCalledWith(checker, {
    args: ["/judge/input", "/judge/answer", "/judge/feedback"],
    stdin: "1 0\n",
    files: {
      "/judge/input": "4 9\n2 7 11 15\n",
      "/judge/answer": "0 1\n",
      "/judge/feedback/.keep": "",
    },
    outputPaths: ["/judge/feedback/teammessage.txt"],
    resources: {
      logicalTimeLimitMs: 30_000,
      memoryLimitBytes: 512 * 1024 * 1024,
      wallTimeLimitMs: 60_000,
      outputLimitBytes: 16 * 1024 * 1024,
      filesystemWriteLimitBytes: 64 * 1024 * 1024,
      filesystemEntryLimit: 4096,
    },
  });
});

it("gives a checker the official validator time when the problem's limit is longer", async () => {
  engine.run.mockResolvedValueOnce(checkerRun(43));

  await expect(
    runBrowserChecker(
      { id: "checker" } as never,
      { input: "", answer: "", output: "", timeLimitMs: 45_000 },
      new AbortController().signal,
    ),
  ).resolves.toEqual({ verdict: "WA" });
  expect(engine.run.mock.calls.at(-1)?.[1]).toMatchObject({
    resources: { logicalTimeLimitMs: 45_000, wallTimeLimitMs: 90_000 },
  });
});

it.each([
  ["exits with another code", checkerRun(0, "exited", "ignored")],
  ["runs out of time", checkerRun(0, "wall-time-limit")],
  ["traps", checkerRun(0, "trap")],
])("maps a checker that %s to a judge system error", async (_label, run) => {
  engine.run.mockResolvedValueOnce(run);

  await expect(
    runBrowserChecker(
      { id: "checker" } as never,
      { input: "", answer: "", output: "", timeLimitMs: 1000 },
      new AbortController().signal,
    ),
  ).resolves.toEqual({ verdict: "SE" });
});

function side(termination: string, code: number, stderr = "", logicalTimeNs = 1) {
  return { termination, code, stderr, metrics: { logicalTimeNs, memoryBytes: 1024 } };
}

function interaction(overrides: Record<string, unknown> = {}) {
  return {
    contestant: side("exited", 0),
    interactor: side("exited", 42),
    contestantToInteractor: "50\n",
    interactorToContestant: "1 100\n",
    durationMs: 1,
    ...overrides,
  };
}

const interactionLimits = {
  language: "python",
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  env: { MODE: "strict" },
} as const;

it("runs the contestant against the interactor with the sample's input and official limits", async () => {
  const contestant = { id: "contestant" } as never;
  const interactor = { id: "interactor" } as never;
  engine.interact.mockResolvedValueOnce(
    interaction({ contestant: side("exited", 0, "", 12_300_000) }),
  );

  const result = await runBrowserInteraction(
    contestant,
    interactor,
    { interactorInput: "1 100\n42\n", limits: interactionLimits },
    new AbortController().signal,
  );

  expect(result).toEqual({
    verdict: "AC",
    timeMs: 13,
    transcript: { toInteractor: "50\n", toContestant: "1 100\n" },
  });
  expect(engine.interact).toHaveBeenLastCalledWith(contestant, interactor, {
    contestant: {
      env: { MODE: "strict" },
      resources: {
        logicalTimeLimitMs: 3000,
        memoryLimitBytes: 256 * 1024 * 1024,
        wallTimeLimitMs: 9000,
        outputLimitBytes: 16 * 1024 * 1024,
        filesystemWriteLimitBytes: 64 * 1024 * 1024,
        filesystemEntryLimit: 4096,
      },
    },
    interactor: {
      args: ["/judge/input", "/judge/answer", "/judge/feedback"],
      files: {
        "/judge/input": "1 100\n42\n",
        "/judge/answer": "",
        "/judge/feedback/.keep": "",
      },
      resources: {
        logicalTimeLimitMs: 30_000,
        memoryLimitBytes: 320 * 1024 * 1024,
        wallTimeLimitMs: 9000,
        outputLimitBytes: 16 * 1024 * 1024,
        filesystemWriteLimitBytes: 64 * 1024 * 1024,
        filesystemEntryLimit: 4096,
      },
    },
  });
});

it("keeps short limits at a 3 s wall stop and caps the interactor's memory headroom", async () => {
  engine.interact.mockResolvedValueOnce(interaction());

  await runBrowserInteraction(
    { id: "contestant" } as never,
    { id: "interactor" } as never,
    {
      interactorInput: "",
      limits: { language: "cpp", timeLimitMs: 200, memoryLimitMb: 1500, env: {} },
    },
    new AbortController().signal,
  );

  const config = engine.interact.mock.calls.at(-1)?.[2];
  expect(config.contestant.resources).toMatchObject({
    logicalTimeLimitMs: 200,
    memoryLimitBytes: 1500 * 1024 * 1024,
    wallTimeLimitMs: 3000,
  });
  expect(config.interactor.resources).toMatchObject({
    logicalTimeLimitMs: 30_000,
    memoryLimitBytes: 1536 * 1024 * 1024,
    wallTimeLimitMs: 3000,
  });
});

it.each([
  ["the interactor rejects the replies", interaction({ interactor: side("exited", 43) }), "WA"],
  ["the interactor crashes", interaction({ interactor: side("trap", 1) }), "SE"],
  [
    "the contestant runs out of instructions",
    interaction({ contestant: side("instruction-limit", 0) }),
    "TLE",
  ],
  [
    "the contestant exceeds its memory",
    interaction({ contestant: side("memory-limit", 0) }),
    "MLE",
  ],
  ["the contestant exits with an error", interaction({ contestant: side("exited", 3) }), "RE"],
  [
    "the contestant hits the wall stop and the interactor rejects the closed input",
    interaction({ contestant: side("wall-time-limit", 0), interactor: side("exited", 43) }),
    "TLE",
  ],
  [
    "the contestant runs out of instructions and the interactor dies on the closed pipe",
    interaction({
      contestant: side("instruction-limit", 137),
      interactor: side("exited", 120),
    }),
    "TLE",
  ],
  [
    "the contestant exceeds its memory and the interactor dies on the closed pipe",
    interaction({ contestant: side("memory-limit", 0), interactor: side("exited", 120) }),
    "MLE",
  ],
  [
    "the contestant exits normally and the interactor dies on the closed pipe",
    interaction({ interactor: side("exited", 120) }),
    "SE",
  ],
  [
    "the contestant exits with an error and the interactor crashes",
    interaction({ contestant: side("exited", 3), interactor: side("exited", 120) }),
    "SE",
  ],
  [
    "both sides hit the wall stop",
    interaction({
      contestant: side("wall-time-limit", 0),
      interactor: side("wall-time-limit", 0),
    }),
    "TLE",
  ],
])("maps an interaction where %s", async (_label, run, verdict) => {
  engine.interact.mockResolvedValueOnce(run);

  const result = await runBrowserInteraction(
    { id: "contestant" } as never,
    { id: "interactor" } as never,
    { interactorInput: "", limits: interactionLimits },
    new AbortController().signal,
  );

  expect(result.verdict).toBe(verdict);
});

it("caps each transcript direction at 64 KiB and the contestant's stderr", async () => {
  engine.interact.mockResolvedValueOnce(
    interaction({
      contestant: side("exited", 0, "e".repeat(200_000)),
      contestantToInteractor: "q".repeat(70_000),
      interactorToContestant: `${"a".repeat(65_535)}中`,
    }),
  );

  const result = await runBrowserInteraction(
    { id: "contestant" } as never,
    { id: "interactor" } as never,
    { interactorInput: "", limits: interactionLimits },
    new AbortController().signal,
  );

  expect(result.transcript.toInteractor).toBe("q".repeat(64 * 1024));
  expect(result.transcript.toContestant).toBe("a".repeat(65_535));
  expect(result.stderr).toBe("e".repeat(100_000));
});

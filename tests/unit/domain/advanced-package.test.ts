import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";

import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  spawnMock,
  problemFindById,
  problemUpdate,
  problemStatementUpsert,
  uploadAdvancedImageTarball,
  deleteAdvancedImageTarball,
  gradeResult,
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  problemFindById: vi.fn(),
  problemUpdate: vi.fn(),
  problemStatementUpsert: vi.fn(),
  uploadAdvancedImageTarball: vi.fn(),
  deleteAdvancedImageTarball: vi.fn(),
  gradeResult: { value: { score: 100, verdict: "accepted" } },
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("@nojv/storage", () => ({
  createStorageClient: vi.fn(() => ({})),
  uploadAdvancedImageTarball,
  deleteAdvancedImageTarball,
}));

vi.mock("@nojv/db", () => {
  const withTx = {
    findById: problemFindById,
    update: problemUpdate,
  };
  return {
    Prisma: {},
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
    problemRepo: {
      findById: problemFindById,
      withTx: () => withTx,
    },
    problemStatementRepo: {
      withTx: () => ({
        upsert: problemStatementUpsert,
      }),
    },
    assessmentProblemRepo: {},
    contestProblemRepo: {},
    examProblemRepo: {},
    problemWorkspaceFileRepo: {},
    userRepo: {},
    assessmentRepo: {},
    contestRepo: {},
    courseRepo: {},
  };
});

import { importAdvancedPackage } from "../../../packages/application/src/problem/advanced-package";

const actor = {
  userId: "usr_author",
  username: "author",
  platformRole: "teacher" as const,
};

function dockerChild(args: string[]) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;

  setImmediate(async () => {
    if (args[0] === "save") {
      const out = args[args.indexOf("-o") + 1];
      await writeFile(out!, Buffer.from("fake image tar"));
    }
    if (args[0] === "run") {
      const name = args[args.indexOf("--name") + 1] ?? "";
      const workspaceMount = args.find((arg) => arg.endsWith(":/workspace"));
      const workspace = workspaceMount?.slice(0, -":/workspace".length);
      if (workspace && name.includes("-run-")) {
        await mkdir(`${workspace}/output`, { recursive: true });
        await writeFile(`${workspace}/output/run.json`, JSON.stringify({ cases: [] }));
      }
      if (workspace && name.includes("-grade-")) {
        await mkdir(`${workspace}/output`, { recursive: true });
        await writeFile(`${workspace}/output/result.json`, JSON.stringify(gradeResult.value));
      }
    }
    child.emit("close", 0);
  });

  return child;
}

async function packageZip(): Promise<Buffer> {
  const sample = new JSZip();
  sample.file("main.py", "print(5)\n");

  const zip = new JSZip();
  zip.file(
    "metadata.yaml",
    `version: 1
problem:
  title: Advanced Sum
  difficulty: medium
  visibility: private
  statement: |
    Read two integers and output their sum.
  inputFormat: |
    One line with two integers.
  outputFormat: |
    One integer.
  examples:
    - input: |
        1 2
      output: |
        3
  tags:
    - advanced
scoring:
  maxScore: 100
resources:
  timeLimitMs: 1000
  memoryLimitMb: 128
student:
  requiredPaths:
    - main.py
network:
  mode: none
  allowlist: []
samples:
  - name: full
    submission: samples/full.zip
    expect:
      verdict: accepted
      score: 100
`,
  );
  zip.file("run/Dockerfile", "FROM scratch\n");
  zip.file("grade/Dockerfile", "FROM scratch\n");
  zip.file(
    "samples/full.zip",
    await sample.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

describe("importAdvancedPackage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gradeResult.value = { score: 100, verdict: "accepted" };
    spawnMock.mockImplementation((cmd: string, args: string[]) => {
      expect(cmd).toBe("docker");
      return dockerChild(args);
    });
    problemFindById.mockResolvedValue({
      id: "prob_1",
      authorId: "usr_author",
      advancedConfig: null,
    });
    problemUpdate.mockResolvedValue({ id: "prob_1" });
    problemStatementUpsert.mockResolvedValue({ problemId: "prob_1", locale: "zh-TW" });
    uploadAdvancedImageTarball.mockImplementation(
      (_storage: unknown, _problemId: string, role: string) =>
        Promise.resolve(`problems/prob_1/advanced-images/${role}/image.tar`),
    );
    deleteAdvancedImageTarball.mockResolvedValue(undefined);
  });

  it("runs manifest samples before persisting the advanced config", async () => {
    const result = await importAdvancedPackage(actor, "prob_1", await packageZip());

    expect(result.builtImages).toEqual(["run", "grade"]);
    expect(problemUpdate).toHaveBeenCalledTimes(1);
    const persisted = problemUpdate.mock.calls[0]![1] as {
      advancedConfig: { run: { imageSource: string }; grade: { imageSource: string } };
      advancedRequiredPaths: string[];
      title: string;
      difficulty: string;
      visibility: string;
      samples: { input: string; output: string }[];
      tags: string[];
    };
    expect(persisted.title).toBe("Advanced Sum");
    expect(persisted.difficulty).toBe("medium");
    expect(persisted.visibility).toBe("private");
    expect(persisted.samples).toEqual([{ input: "1 2\n", output: "3\n" }]);
    expect(persisted.tags).toEqual(["advanced"]);
    expect(persisted.advancedConfig.run.imageSource).toBe("tarball");
    expect(persisted.advancedConfig.grade.imageSource).toBe("tarball");
    expect(persisted.advancedRequiredPaths).toEqual(["main.py"]);
    expect(problemStatementUpsert).toHaveBeenCalledWith(
      "prob_1",
      "zh-TW",
      expect.objectContaining({
        bodyMarkdown: "Read two integers and output their sum.",
        inputFormat: "One line with two integers.",
        outputFormat: "One integer.",
        title: "Advanced Sum",
      }),
      expect.objectContaining({
        bodyMarkdown: "Read two integers and output their sum.",
        inputFormat: "One line with two integers.",
        outputFormat: "One integer.",
        title: "Advanced Sum",
      }),
    );
    expect(spawnMock.mock.calls.some(([, args]) => args[0] === "run")).toBe(true);
  });

  it("rejects the package when a sample result differs from the manifest", async () => {
    gradeResult.value = { score: 0, verdict: "wrong_answer" };

    await expect(
      importAdvancedPackage(actor, "prob_1", await packageZip()),
    ).rejects.toMatchObject({
      issue: {
        code: "ADV_SAMPLE_EXPECTATION_MISMATCH",
        phase: "sample",
        file: "samples/full.zip",
      },
    });
    expect(problemUpdate).not.toHaveBeenCalled();
    expect(problemStatementUpsert).not.toHaveBeenCalled();
  });
});

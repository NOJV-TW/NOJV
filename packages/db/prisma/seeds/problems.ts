import { randomUUID } from "node:crypto";

import type { AdvancedConfig } from "@nojv/core";
import { problemTags } from "@nojv/core";
import {
  checkerKey,
  createStorageClient,
  interactorKey,
  putImmutableText,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
} from "@nojv/storage";

import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { StorageObjectPointer } from "@nojv/storage";

const SEED_DIFFICULTIES = ["easy", "medium", "hard"] as const;
type SeedDifficulty = (typeof SEED_DIFFICULTIES)[number];

function isSeedDifficulty(value: string): value is SeedDifficulty {
  return (SEED_DIFFICULTIES as readonly string[]).includes(value);
}

function pickSeedDifficulty(tags: string[] | undefined): SeedDifficulty {
  for (const tag of tags ?? []) {
    if (isSeedDifficulty(tag)) return tag;
  }
  return "medium";
}

function stripDifficultyTags(tags: string[] | undefined): string[] {
  return (tags ?? []).filter((tag) => !isSeedDifficulty(tag));
}

type SeedStatement = {
  body: string;
  inputFormat?: string;
  outputFormat?: string;
};

type SeedTestcase = {
  input: string;
  output: string;
};

type SeedTestcaseSet = {
  cases: SeedTestcase[];
  description?: string;
  weight?: number;
};

type SeedTestcaseSets = {
  sample: SeedTestcaseSet;
  hidden: SeedTestcaseSet;
  hidden2?: SeedTestcaseSet;
};

type SeedProblemType = "full_source" | "multi_file" | "special_env";

type SeedWorkspaceFile = {
  language: "python" | "c" | "cpp" | "go" | "java" | "javascript" | "rust" | "typescript";
  path: string;
  content: string;
  visibility: "editable" | "readonly" | "hidden";
  description?: string;
  orderIndex?: number;
};

type SeedProblemSample = {
  readonly input: string;
  readonly output: string;
};

function toSamplesJson(
  samples: readonly SeedProblemSample[] | undefined,
): Prisma.InputJsonValue | undefined {
  if (!samples) return undefined;
  return samples.map((sample) => ({
    input: sample.input,
    output: sample.output,
  }));
}

export type SeedProblemDef = {
  authorId: string;
  title: string;
  id: string;
  type: SeedProblemType;
  tags?: string[];
  memoryLimitMb: number;
  timeLimitMs: number;
  visibility: "public" | "private";
  statement: SeedStatement;
  testcases?: SeedTestcaseSets;
  judgeConfig?: Record<string, unknown>;
  status?: "draft" | "published";
  samples?: SeedProblemSample[];
  workspaceFiles?: SeedWorkspaceFile[];
  advancedConfig?: AdvancedConfig;
  advancedRequiredPaths?: string[];
};

export type SeedAdvancedDemoImages = {
  run: string;
  grade: string;
};

const PINNED_IMAGE =
  /^(?:[a-z0-9.-]+(?::[0-9]+)?\/)(?:[a-z0-9._-]+\/)*[a-z0-9._-]+:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}@sha256:[a-f0-9]{64}$/u;
const LOCAL_DEMO_IMAGES = {
  run: "nojv-demo-advanced-run:local",
  grade: "nojv-demo-advanced-grade:local",
} as const;

function validateSeedAdvancedDemoImages(images: SeedAdvancedDemoImages): void {
  for (const phase of ["run", "grade"] as const) {
    const image = images[phase];
    if (image !== LOCAL_DEMO_IMAGES[phase] && !PINNED_IMAGE.test(image)) {
      throw new Error(
        `Advanced demo ${phase} image must be ${LOCAL_DEMO_IMAGES[phase]} for an explicit local build or a readable tag pinned by sha256 digest`,
      );
    }
  }
}

const hardenedIds = [
  "problem_stateful-dhcp-parser",
  "problem_memory-leak-forensics",
  "problem_noisy-oracle-hunt",
] as const;

export function validateProblemDefinitions(problemDefs: SeedProblemDef[]): void {
  const ids = new Set<string>();

  for (const def of problemDefs) {
    if (ids.has(def.id)) {
      throw new Error(`Duplicate seed problem id: ${def.id}`);
    }
    ids.add(def.id);

    if (!def.statement?.body) {
      throw new Error(`Missing statement body for problem: ${def.id}`);
    }

    for (const tag of stripDifficultyTags(def.tags)) {
      if (!(problemTags as readonly string[]).includes(tag)) {
        throw new Error(`Unknown problem tag "${tag}" (not in problemTags): ${def.id}`);
      }
    }

    if (def.type === "special_env") {
      if (!def.advancedConfig) {
        throw new Error(`special_env problem must declare advancedConfig: ${def.id}`);
      }
    } else {
      if (!def.testcases) {
        throw new Error(`${def.type} problem must declare testcases: ${def.id}`);
      }
      if (def.testcases.sample.cases.length === 0 || def.testcases.hidden.cases.length === 0) {
        throw new Error(`Sample/hidden testcase sets must be non-empty: ${def.id}`);
      }
    }

    if (def.type === "multi_file") {
      if (!def.workspaceFiles || def.workspaceFiles.length < 2) {
        throw new Error(`multi_file problem must declare >=2 workspace files: ${def.id}`);
      }
    }

    if (def.judgeConfig) {
      const config = def.judgeConfig;
      if (config.type === "checker" && !(config.checkerScript as string)?.trim()) {
        throw new Error(`Checker judge requires checkerScript in judgeConfig: ${def.id}`);
      }
      if (config.type === "interactive" && !(config.interactorScript as string)?.trim()) {
        throw new Error(
          `Interactive judge requires interactorScript in judgeConfig: ${def.id}`,
        );
      }
    }
  }

  for (const id of hardenedIds) {
    const def = problemDefs.find((entry) => entry.id === id);
    if (!def) {
      throw new Error(`Missing hardened seed problem: ${id}`);
    }
    if (pickSeedDifficulty(def.tags) !== "hard") {
      throw new Error(`Hardened problem must have difficulty "hard": ${id}`);
    }
  }
}

export type SeedStorageClient = { send: (command: unknown) => Promise<unknown> };

async function persistJudgeConfig(
  storage: SeedStorageClient,
  problemId: string,
  judgeConfig: Record<string, unknown> | undefined,
): Promise<{
  judgeConfig: Record<string, unknown> | undefined;
  checkerStorage: StorageObjectPointer | null;
  interactorStorage: StorageObjectPointer | null;
}> {
  if (!judgeConfig) {
    return { judgeConfig: undefined, checkerStorage: null, interactorStorage: null };
  }
  const client = storage as ReturnType<typeof createStorageClient>;
  const { checkerScript, interactorScript, ...rest } = judgeConfig;

  if (rest.type === "checker" && typeof checkerScript === "string") {
    const checkerStorage = await putImmutableText(
      client,
      checkerKey(problemId, randomUUID()),
      checkerScript,
    );
    return { judgeConfig: rest, checkerStorage, interactorStorage: null };
  }
  if (rest.type === "interactive" && typeof interactorScript === "string") {
    const interactorStorage = await putImmutableText(
      client,
      interactorKey(problemId, randomUUID()),
      interactorScript,
    );
    return { judgeConfig: rest, checkerStorage: null, interactorStorage };
  }
  return { judgeConfig: rest, checkerStorage: null, interactorStorage: null };
}

export function buildSeedProblemDefs(
  teacherId: string,
  advancedDemoImages: SeedAdvancedDemoImages,
): SeedProblemDef[] {
  validateSeedAdvancedDemoImages(advancedDemoImages);
  return [
    {
      authorId: teacherId,
      title: "Warmup Sum",
      tags: ["easy", "Array", "Math"],
      type: "full_source" as const,
      id: "problem_warmup-sum",
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "經典暖身題。從標準輸入讀取兩個整數，輸出它們的總和。",
        inputFormat: String.raw`一行，包含兩個以空白分隔的整數 $a$ 和 $b$（$-2^{31} \le a, b \le 2^{31}-1$）。`,
        outputFormat: "一行，輸出 $a + b$ 的值。",
      },
      samples: [
        { input: "2 5", output: "7" },
        { input: "0 0", output: "0" },
      ],
      testcases: {
        sample: {
          description: "Public sample cases shown on the problem page.",
          cases: [
            { input: "2 5", output: "7" },
            { input: "0 0", output: "0" },
            { input: "-3 7", output: "4" },
          ],
        },
        hidden: {
          description: "Hidden cases including 32-bit signed integer edges.",
          cases: [
            { input: "1000000 999999", output: "1999999" },
            { input: "-100 -200", output: "-300" },
            { input: "2147483646 1", output: "2147483647" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Binary Search Lower Bound",
      tags: ["medium", "Binary Search", "Array"],
      type: "full_source" as const,
      id: "problem_graph-docking",
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "給定一個由小到大排序的整數陣列，以及若干個查詢值。對每個查詢值 $x$，回答陣列中第一個「大於等於 $x$」的元素之 0-based 索引；若不存在，回答陣列長度 $N$。\n\n每個查詢都應以 $O(\\log N)$ 的二分搜尋回答。",
        inputFormat:
          "第一行一個整數 $N$（$1 \\le N \\le 2 \\times 10^5$），表示陣列長度。\n\n第二行 $N$ 個由小到大排序的整數 $a_0 \\le a_1 \\le \\dots \\le a_{N-1}$（$-10^9 \\le a_i \\le 10^9$）。\n\n第三行一個整數 $Q$（$1 \\le Q \\le 2 \\times 10^5$），表示查詢數。\n\n第四行 $Q$ 個整數，每個是一筆查詢值 $x$。",
        outputFormat: "一行，輸出 $Q$ 個以空白分隔的索引，第 $k$ 個是第 $k$ 筆查詢的答案。",
      },
      samples: [
        { input: "5\n1 3 5 7 9\n3\n4 9 10\n", output: "2 4 5" },
        { input: "4\n2 2 2 2\n2\n2 3\n", output: "0 4" },
      ],
      testcases: {
        sample: {
          description: "Small sorted arrays demonstrating lower-bound semantics.",
          cases: [
            { input: "5\n1 3 5 7 9\n3\n4 9 10\n", output: "2 4 5" },
            { input: "4\n2 2 2 2\n2\n2 3\n", output: "0 4" },
          ],
        },
        hidden: {
          description:
            "Subtask 1: small arrays — below-all, above-all, duplicates, single element.",
          weight: 80,
          cases: [
            { input: "1\n5\n3\n5 4 6\n", output: "0 0 1" },
            { input: "6\n-5 -3 -3 0 4 4\n4\n-3 -10 4 5\n", output: "1 0 4 6" },
            { input: "3\n10 20 30\n2\n10 31\n", output: "0 3" },
          ],
        },
        hidden2: {
          description:
            "Subtask 2: duplicate-heavy arrays, negative ranges, and larger spreads.",
          weight: 120,
          cases: [
            { input: "6\n2 2 2 5 5 8\n5\n2 5 8 9 1\n", output: "0 3 5 6 0" },
            { input: "5\n-10 -5 -5 0 3\n4\n-7 -5 4 -10\n", output: "1 1 5 0" },
            { input: "4\n100 200 300 400\n4\n50 400 401 250\n", output: "0 3 4 2" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Maze Shortest Path",
      tags: ["hard", "Breadth-First Search", "Graph", "Matrix"],
      type: "full_source" as const,
      id: "problem_distributed-labyrinth",
      memoryLimitMb: 512,
      timeLimitMs: 3000,
      visibility: "public" as const,
      statement: {
        body: "給定一個由 `.`（可通行）與 `#`（牆）組成的格狀迷宮。從左上角 $(0,0)$ 出發，每步可往上、下、左、右移動到相鄰的可通行格子，求到達右下角 $(R-1,C-1)$ 的最短步數。\n\n若起點或終點是牆，或無法到達終點，輸出 `-1`。這是一道單源最短路徑（BFS）題。",
        inputFormat:
          "第一行兩個整數 $R$ 和 $C$（$1 \\le R, C \\le 1000$），表示列數與行數。\n\n接下來 $R$ 行，每行 $C$ 個字元，`.` 表示通道，`#` 表示牆壁。",
        outputFormat: "一行，輸出從 $(0,0)$ 到 $(R-1,C-1)$ 的最短步數；若不可達輸出 `-1`。",
      },
      samples: [
        { input: "3 3\n...\n.#.\n...\n", output: "4" },
        { input: "2 2\n..\n..\n", output: "2" },
      ],
      testcases: {
        sample: {
          description: "Tiny mazes used to introduce the format.",
          cases: [
            { input: "3 3\n...\n.#.\n...\n", output: "4" },
            { input: "2 2\n..\n..\n", output: "2" },
          ],
        },
        hidden: {
          description: "Spiral, single cell, and an unreachable goal.",
          cases: [
            { input: "5 5\n.....\n.###.\n.#.#.\n.###.\n.....\n", output: "8" },
            { input: "1 1\n.\n", output: "0" },
            { input: "3 3\n.#.\n.#.\n.#.\n", output: "-1" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Maximum Subarray Sum",
      tags: ["medium", "Dynamic Programming", "Array"],
      type: "full_source" as const,
      id: "problem_process-log-parser",
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "給定一個整數陣列，找出和最大的「連續非空子陣列」，並輸出該最大和。\n\n這是經典的 Kadane 動態規劃題：以線性時間維護「以當前位置結尾的最大子陣列和」。注意陣列可能全為負數，此時答案是最大的單一元素。",
        inputFormat:
          "第一行一個整數 $N$（$1 \\le N \\le 10^5$），表示陣列長度。\n\n第二行 $N$ 個整數 $a_i$（$-10^4 \\le a_i \\le 10^4$）。",
        outputFormat: "一行，輸出最大連續子陣列和。",
      },
      samples: [
        { input: "9\n-2 1 -3 4 -1 2 1 -5 4\n", output: "6" },
        { input: "1\n5\n", output: "5" },
      ],
      testcases: {
        sample: {
          description: "Mixed-sign array and a single element.",
          cases: [
            { input: "9\n-2 1 -3 4 -1 2 1 -5 4\n", output: "6" },
            { input: "1\n5\n", output: "5" },
          ],
        },
        hidden: {
          description: "All-negative, all-positive, and single negative edges.",
          cases: [
            { input: "3\n-3 -1 -2\n", output: "-1" },
            { input: "4\n1 2 3 4\n", output: "10" },
            { input: "1\n-7\n", output: "-7" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "0/1 Knapsack",
      tags: ["hard", "Dynamic Programming", "Array"],
      type: "full_source" as const,
      id: "problem_fork-bomb-safeguard",
      memoryLimitMb: 512,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "有 $N$ 件物品與一個容量為 $W$ 的背包。第 $i$ 件物品的重量為 $w_i$、價值為 $v_i$，每件物品至多選一次。在總重量不超過 $W$ 的前提下，求能取得的最大總價值。\n\n這是經典的 0/1 背包動態規劃，以一維 DP 表 $dp[c]$ 由大到小更新容量即可。",
        inputFormat:
          "第一行兩個整數 $N$ 和 $W$（$1 \\le N \\le 100$，$1 \\le W \\le 10^4$）。\n\n接下來 $N$ 行，每行兩個整數 $w_i$ 和 $v_i$（$1 \\le w_i \\le W$，$1 \\le v_i \\le 10^9$）。",
        outputFormat: "一行，輸出總重量不超過 $W$ 時的最大總價值。",
      },
      samples: [
        { input: "4 10\n2 3\n3 4\n4 5\n5 6\n", output: "13" },
        { input: "3 5\n1 1\n2 2\n3 3\n", output: "5" },
      ],
      testcases: {
        sample: {
          description: "Small instances demonstrating the trade-off.",
          cases: [
            { input: "4 10\n2 3\n3 4\n4 5\n5 6\n", output: "13" },
            { input: "3 5\n1 1\n2 2\n3 3\n", output: "5" },
          ],
        },
        hidden: {
          description: "Exact fit, item that cannot fit, and a forced single pick.",
          cases: [
            { input: "3 7\n3 4\n4 5\n2 3\n", output: "9" },
            { input: "1 4\n5 10\n", output: "0" },
            { input: "2 10\n10 100\n9 90\n", output: "100" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Add Two Numbers",
      tags: ["easy", "Math"],
      type: "full_source" as const,
      id: "problem_add-two-numbers",
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "讀入兩個整數並輸出它們的總和。",
        inputFormat: String.raw`一行，包含兩個以空白分隔的整數 $a$ 和 $b$（$-2^{31} \le a, b \le 2^{31}-1$）。`,
        outputFormat: "一行，輸出 $a + b$ 的值。",
      },
      samples: [
        { input: "1 2", output: "3" },
        { input: "0 0", output: "0" },
      ],
      testcases: {
        sample: {
          description: "Public sample cases.",
          cases: [
            { input: "1 2", output: "3" },
            { input: "0 0", output: "0" },
            { input: "-1 1", output: "0" },
          ],
        },
        hidden: {
          description: "Hidden cases including 32-bit signed integer edges.",
          cases: [
            { input: "1000000 999999", output: "1999999" },
            { input: "-500 -700", output: "-1200" },
            { input: "2147483646 1", output: "2147483647" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Float Compare",
      tags: ["easy", "Math"],
      type: "full_source" as const,
      id: "problem_float-compare",
      memoryLimitMb: 256,
      judgeConfig: {
        type: "checker",
        checkerLanguage: "python",
        checkerScript: `expected = float(judge_answer.strip())
try:
    actual = float(team_output.strip())
except ValueError:
    wrong("output is not a valid number")
if abs(expected - actual) < 1e-6:
    accept()
wrong(f"expected {expected}, got {actual}")
`,
      },
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "計算結果並以浮點數精度輸出。答案與預期值的絕對差必須小於 1e-6。",
        inputFormat: String.raw`一行，包含兩個以空白分隔的正整數 $a$ 和 $b$（$1 \le a, b \le 10^9$）。`,
        outputFormat: "一行，輸出 $a / b$ 的值。答案與預期值的絕對差須小於 $10^{-6}$。",
      },
      samples: [
        { input: "1 3", output: "0.333333" },
        { input: "1 7", output: "0.142857" },
      ],
      testcases: {
        sample: {
          description: "Public sample cases for the floating-point judge.",
          cases: [
            { input: "1 3", output: "0.333333" },
            { input: "1 7", output: "0.142857" },
          ],
        },
        hidden: {
          description: "Hidden cases evaluated by the custom checker.",
          cases: [
            { input: "2 3", output: "0.666667" },
            { input: "355 113", output: "3.141593" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Any Two Sum (Checker)",
      tags: ["medium", "Array", "Hash Table", "Two Pointers"],
      type: "full_source" as const,
      id: "problem_any-two-sum",
      memoryLimitMb: 256,
      judgeConfig: {
        type: "checker",
        checkerLanguage: "python",
        checkerScript: `lines = judge_input.strip().split("\\n")
n, target = map(int, lines[0].split())
arr = list(map(int, lines[1].split()))
exists = judge_answer.strip()

toks = team_output.split()
if not toks:
    wrong("no output")
if toks[0] == "-1":
    if exists == "NO":
        accept("correctly reported no pair")
    wrong("reported no pair but one exists")
if len(toks) < 2:
    wrong("expected two indices")
try:
    i, j = int(toks[0]), int(toks[1])
except ValueError:
    wrong("indices are not integers")
if not (1 <= i <= n and 1 <= j <= n) or i == j:
    wrong(f"invalid index pair {i} {j}")
if arr[i - 1] + arr[j - 1] == target:
    accept(f"valid pair {i} {j}")
wrong(f"a[{i}]+a[{j}] != {target}")
`,
      },
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "這是一道「答案不唯一」的 checker 示範題。給定 $N$ 個整數與一個目標值 $T$，請找出**任意一組**索引 $i$、$j$（$1 \\le i, j \\le N$ 且 $i \\ne j$，1-based），使得 $a_i + a_j = T$，並輸出 `i j`（順序不限）。若不存在任何一組，輸出 `-1`。\n\n判題使用自訂 checker：只要你輸出的索引對確實滿足 $a_i + a_j = T$ 即視為正確，不要求與標準答案完全相同。",
        inputFormat:
          "第一行兩個整數 $N$ 和 $T$（$2 \\le N \\le 2000$，$-10^9 \\le T \\le 10^9$）。\n\n第二行 $N$ 個整數 $a_i$（$-10^9 \\le a_i \\le 10^9$）。",
        outputFormat: "輸出任意一組滿足條件的 1-based 索引 `i j`；若不存在輸出 `-1`。",
      },
      samples: [
        { input: "4 9\n2 7 4 5\n", output: "1 2" },
        { input: "3 100\n1 2 3\n", output: "-1" },
      ],
      testcases: {
        sample: {
          description: "One solvable case and one with no valid pair.",
          cases: [
            { input: "4 9\n2 7 4 5\n", output: "YES" },
            { input: "3 100\n1 2 3\n", output: "NO" },
          ],
        },
        hidden: {
          description:
            "Checker reads judge_answer = YES/NO (whether any pair exists) and validates structurally.",
          cases: [
            { input: "5 0\n-3 1 4 3 -1\n", output: "YES" },
            { input: "2 5\n2 3\n", output: "YES" },
            { input: "4 1000000000\n1 2 3 4\n", output: "NO" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Guess the Number",
      tags: ["medium", "Binary Search"],
      type: "full_source" as const,
      id: "problem_guess-the-number",
      memoryLimitMb: 256,
      judgeConfig: {
        type: "interactive",
        interactorLanguage: "python",
        interactorScript: `secret = int(judge_input.strip())

lo, hi = 1, 1000000
write(f"{lo} {hi}")

for _ in range(20):
    guess = int(read())
    if guess == secret:
        write("correct")
        accept(f"correct: {secret}")
    write("higher" if guess < secret else "lower")

wrong(f"failed to guess {secret} within 20 attempts")
`,
      },
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "這是一道互動題。系統會選定一個秘密數字，你需要透過互動來猜出它。\\n\\n系統首先會輸出範圍 `lo hi`，你每次猜一個數字，系統會回應 `higher`（太小）、`lower`（太大）或 `correct`（猜對）。你最多有 20 次猜測機會。",
        inputFormat: String.raw`第一行包含兩個整數 $lo$ 和 $hi$（$1 \le lo \le hi \le 10^6$），表示數字的範圍。`,
        outputFormat: "每次輸出一個整數作為你的猜測。",
      },
      samples: [
        {
          input: "1 100\nlower\nhigher\nhigher\nlower\ncorrect",
          output: "50\n25\n37\n43\n42",
        },
        {
          input: "1 1000000\ncorrect",
          output: "500000",
        },
      ],
      testcases: {
        sample: {
          description: "Public sample secrets exercised by the interactor.",
          cases: [
            { input: "42", output: "" },
            { input: "500000", output: "" },
          ],
        },
        hidden: {
          description: "Boundary secrets including 1 and 10^6.",
          cases: [
            { input: "1", output: "" },
            { input: "1000000", output: "" },
            { input: "314159", output: "" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Primality Test (Multi-File)",
      tags: ["hard", "Math", "Number Theory"],
      type: "multi_file" as const,
      id: "problem_stateful-dhcp-parser",
      memoryLimitMb: 256,
      timeLimitMs: 1500,
      visibility: "public" as const,
      statement: {
        body: "這是一題多檔實作題。可執行的進入點是 `main.py`：它從標準輸入讀入 $Q$ 個整數，對每個整數 $n$ 呼叫你實作的 `is_prime(n)`，並逐行印出 `YES`（質數）或 `NO`（非質數）。\n\n`main.py` 會 `import` 唯讀的 `iolib.py`（提供 `read_queries()` 解析 stdin）；你只需在 `main.py` 裡實作 `is_prime`。\n\n定義：小於 2 的整數都不是質數。請以試除到 $\\sqrt{n}$ 的方式判定，使每筆查詢都能在時限內完成。",
        inputFormat:
          "第一行一個整數 $Q$（$1 \\le Q \\le 10^4$）。\n\n接下來 $Q$ 行，每行一個整數 $n$（$0 \\le n \\le 10^9$）。",
        outputFormat: "對每個查詢輸出一行：質數輸出 `YES`，否則輸出 `NO`。",
      },
      samples: [
        {
          input: "4\n1\n2\n17\n18\n",
          output: "NO\nYES\nYES\nNO",
        },
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content: `from iolib import read_queries

def is_prime(n: int) -> bool:
    """Return True if n is a prime number, False otherwise."""
    # implement is_prime here
    return False

def main() -> None:
    for n in read_queries():
        print("YES" if is_prime(n) else "NO")

if __name__ == "__main__":
    main()
`,
          visibility: "editable",
          description:
            "The runnable entry. main() reads queries via iolib.read_queries and prints YES/NO per is_prime result. Implement is_prime here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "iolib.py",
          content: `"""Read-only I/O helper for the primality test.

Do NOT modify. main.py imports read_queries to turn the stdin stream
into the list of Q integers to classify.
"""

import sys
from typing import List

def read_queries() -> List[int]:
    """Return the Q query integers from stdin (empty list on bad count)."""
    data = sys.stdin.read().split()
    if not data:
        return []
    q = int(data[0])
    return [int(tok) for tok in data[1 : 1 + q]]
`,
          visibility: "readonly",
          description:
            "Read-only stdin helper. Provides read_queries(), which main.py imports to get the integers. You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "Smallest non-prime, smallest prime, a prime, and a composite.",
          cases: [
            {
              input: "4\n1\n2\n17\n18\n",
              output: "NO\nYES\nYES\nNO",
            },
          ],
        },
        hidden: {
          description: "Zero, large prime, large composite, and a perfect square.",
          cases: [
            {
              input: "5\n0\n97\n100\n7919\n7921\n",
              output: "NO\nYES\nNO\nYES\nNO",
            },
            {
              input: "3\n999999937\n999999938\n3\n",
              output: "YES\nNO\nYES",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Binary Search (Multi-File)",
      tags: ["hard", "Binary Search", "Array"],
      type: "multi_file" as const,
      id: "problem_memory-leak-forensics",
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "這是一題多檔實作題。可執行的進入點是 `main.py`：它讀入一個由小到大排序、且元素互異的整數陣列，以及若干筆查詢。對每筆查詢 $x$，呼叫你實作的 `binary_search(arr, x)`，回傳 $x$ 在陣列中的 0-based 索引；若不存在，回傳 $-1$。\n\n`main.py` 會 `import` 唯讀的 `iolib.py`（提供 `read_problem()` 解析 stdin）；你只需在 `main.py` 裡實作 `binary_search`，且必須使用 $O(\\log N)$ 二分搜尋。",
        inputFormat:
          "第一行一個整數 $N$（$1 \\le N \\le 2 \\times 10^5$）。\n\n第二行 $N$ 個嚴格遞增的整數。\n\n第三行一個整數 $Q$（$1 \\le Q \\le 2 \\times 10^5$）。\n\n第四行 $Q$ 個查詢值。",
        outputFormat: "一行，輸出 $Q$ 個以空白分隔的結果，每個是對應查詢的索引或 $-1$。",
      },
      samples: [
        {
          input: "6\n1 3 5 7 9 11\n3\n7 1 4\n",
          output: "3 0 -1",
        },
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content: `from typing import List

from iolib import read_problem

def binary_search(arr: List[int], x: int) -> int:
    """Return the 0-based index of x in the sorted arr, or -1 if absent."""
    # implement an O(log N) binary search here
    return -1

def main() -> None:
    arr, queries = read_problem()
    print(" ".join(str(binary_search(arr, x)) for x in queries))

if __name__ == "__main__":
    main()
`,
          visibility: "editable",
          description:
            "The runnable entry. main() reads the array + queries via iolib.read_problem and prints each binary_search result. Implement binary_search here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "iolib.py",
          content: `"""Read-only I/O helper for the binary search problem.

Do NOT modify. main.py imports read_problem to turn the stdin stream
into (arr, queries) for binary_search to answer.
"""

import sys
from typing import List, Tuple

def read_problem() -> Tuple[List[int], List[int]]:
    """Return (arr, queries) parsed from stdin."""
    data = sys.stdin.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    arr = [int(data[idx + i]) for i in range(n)]; idx += n
    q = int(data[idx]); idx += 1
    queries = [int(data[idx + i]) for i in range(q)]
    return arr, queries
`,
          visibility: "readonly",
          description:
            "Read-only stdin helper. Provides read_problem(), which main.py imports to get (arr, queries). You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "A hit at the middle, a hit at the front, and a miss.",
          cases: [
            {
              input: "6\n1 3 5 7 9 11\n3\n7 1 4\n",
              output: "3 0 -1",
            },
          ],
        },
        hidden: {
          description: "Last element, below-all, above-all, and a single-element array.",
          cases: [
            {
              input: "6\n1 3 5 7 9 11\n3\n11 0 12\n",
              output: "5 -1 -1",
            },
            {
              input: "1\n42\n2\n42 7\n",
              output: "0 -1",
            },
            {
              input: "5\n-10 -3 0 8 15\n4\n-3 15 -10 1\n",
              output: "1 4 0 -1",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Any Factor Pair (Multi-File Checker)",
      tags: ["medium", "Math", "Number Theory"],
      type: "multi_file" as const,
      id: "problem_multi-checker-stats",
      memoryLimitMb: 256,
      judgeConfig: {
        type: "checker",
        checkerLanguage: "python",
        checkerScript: `n = int(judge_input.strip())
toks = team_output.split()
if len(toks) < 2:
    wrong("expected two integers")
try:
    a, b = int(toks[0]), int(toks[1])
except ValueError:
    wrong("factors are not integers")
if a > 1 and b > 1 and a * b == n:
    accept(f"valid factorization {a} x {b}")
wrong(f"{a} x {b} is not a valid factor pair of {n}")
`,
      },
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "這是一題「多檔 × 自訂 checker、且答案不唯一」示範題。可執行的進入點是 `main.py`：它讀入一個保證為合數的整數 $n$，呼叫你實作的 `any_factor_pair(n)`，並印出兩個整數 `a b`。\n\n你的目標是找出**任意一組**整數 $a, b$，使得 $a > 1$、$b > 1$ 且 $a \\times b = n$。例如 $n = 12$ 時，`2 6`、`3 4`、`6 2` 都算正確。\n\n`main.py` 會 `import` 唯讀的 `numio.py`（提供 `read_n()`）。判題使用自訂 checker，只驗證乘積是否等於 $n$。你只需在 `main.py` 裡實作 `any_factor_pair`。",
        inputFormat: "一行一個整數 $n$（$4 \\le n \\le 10^9$，保證為合數）。",
        outputFormat:
          "一行兩個以空白分隔的整數 `a b`，滿足 $a > 1$、$b > 1$ 且 $a \\times b = n$。",
      },
      samples: [
        { input: "12\n", output: "2 6" },
        { input: "100\n", output: "4 25" },
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content: `from typing import Tuple

from numio import read_n

def any_factor_pair(n: int) -> Tuple[int, int]:
    """Return any (a, b) with a > 1, b > 1, and a * b == n."""
    # implement any_factor_pair here
    return (1, n)

def main() -> None:
    a, b = any_factor_pair(read_n())
    print(a, b)

if __name__ == "__main__":
    main()
`,
          visibility: "editable",
          description:
            "The runnable entry. main() reads n via numio.read_n and prints the factor pair any_factor_pair returns. Implement any_factor_pair here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "numio.py",
          content: `"""Read-only input helper for the factor-pair problem.

Do NOT modify. main.py imports read_n to get the composite integer n.
"""

import sys

def read_n() -> int:
    """Return the single integer n from stdin."""
    return int(sys.stdin.read().split()[0])
`,
          visibility: "readonly",
          description:
            "Read-only helper. Provides read_n(), which main.py imports. You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "Composite numbers; checker accepts any valid factor pair.",
          cases: [
            { input: "12\n", output: "" },
            { input: "100\n", output: "" },
          ],
        },
        hidden: {
          description: "Even, odd composite, prime-squared, and larger composite.",
          cases: [
            { input: "4\n", output: "" },
            { input: "9\n", output: "" },
            { input: "1000000\n", output: "" },
            { input: "999999999\n", output: "" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Multi-File Bisect (Interactive)",
      tags: ["medium", "Binary Search"],
      type: "multi_file" as const,
      id: "problem_multi-interactive-bisect",
      memoryLimitMb: 256,
      judgeConfig: {
        type: "interactive",
        interactorLanguage: "python",
        interactorScript: `secret = int(judge_input.strip())

lo, hi = 1, 1_000_000
write(f"{lo} {hi}")

for _ in range(40):
    guess = int(read())
    if guess == secret:
        write("correct")
        accept(f"correct: {secret}")
    write("higher" if guess < secret else "lower")

wrong(f"failed to find {secret} within the turn budget")
`,
      },
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "這是一題「多檔 × 互動」示範題。可執行的進入點是 `main.py`：它先讀互動器輸出的第一行 `lo hi`，`import` 唯讀的 `proto.py`（提供 `read_range()` / `send_guess(g)` / `read_verdict()` 三個協定函式），再用二分搜尋找出秘密數字。\n\n互動器每回合回應 `higher`（太小）、`lower`（太大）或 `correct`（猜中）。你只需在 `main.py` 裡完成二分搜尋邏輯。",
        inputFormat: "互動器第一行輸出 `lo hi`（$1 \\le lo \\le hi \\le 10^6$）。",
        outputFormat: "每回合輸出一個整數猜測並立即 flush。",
      },
      samples: [
        {
          input: "1 1000000\nlower\nhigher\ncorrect",
          output: "500000\n250000\n375000",
        },
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content: `from proto import read_range, read_verdict, send_guess

def main() -> None:
    lo, hi = read_range()
    # implement the binary search here: narrow [lo, hi] using the
    # interactor's "higher"/"lower" replies until it answers "correct".
    while lo <= hi:
        mid = (lo + hi) // 2
        send_guess(mid)
        verdict = read_verdict()
        if verdict == "correct":
            return
        if verdict == "higher":
            lo = mid + 1
        elif verdict == "lower":
            hi = mid - 1
        else:
            return

if __name__ == "__main__":
    main()
`,
          visibility: "editable",
          description:
            "The runnable entry. main() reads the range via proto.read_range, then binary-searches using send_guess/read_verdict. Implement the search loop here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "proto.py",
          content: `"""Read-only interaction protocol helper for the bisect game.

Do NOT modify. main.py uses these helpers to talk to the judge:
  - read_range()   parses the interactor's opening "lo hi" line.
  - send_guess(g)  prints a guess and flushes so the judge sees it.
  - read_verdict() reads the judge's "higher"/"lower"/"correct" reply.
"""

import sys
from typing import Tuple

def read_range() -> Tuple[int, int]:
    """Read the opening 'lo hi' line from the interactor."""
    lo, hi = sys.stdin.readline().split()
    return int(lo), int(hi)

def send_guess(guess: int) -> None:
    """Print one integer guess and flush immediately."""
    print(guess, flush=True)

def read_verdict() -> str:
    """Read one verdict line: 'higher', 'lower', or 'correct'."""
    return sys.stdin.readline().strip()
`,
          visibility: "readonly",
          description:
            "Read-only interaction helper. Provides read_range/send_guess/read_verdict, which main.py imports. You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "Public sample secrets exercised by the interactor.",
          cases: [
            { input: "42", output: "" },
            { input: "500000", output: "" },
          ],
        },
        hidden: {
          description: "Boundary secrets including 1 and 10^6.",
          cases: [
            { input: "1", output: "" },
            { input: "1000000", output: "" },
            { input: "314159", output: "" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Noisy Oracle Hunt",
      tags: ["hard", "Binary Search", "Math"],
      type: "full_source" as const,
      id: "problem_noisy-oracle-hunt",
      memoryLimitMb: 256,
      judgeConfig: {
        type: "interactive",
        interactorLanguage: "python",
        interactorScript: `secret = int(judge_input.strip())

lo, hi = 1, 1_000_000
max_turns = 35
lie_period = 5

write(f"{lo} {hi} {max_turns} {lie_period}")

for turn in range(1, max_turns + 1):
    guess = int(read())
    if guess == secret:
        write("correct")
        accept(f"correct: {secret}")
    reply = "higher" if guess < secret else "lower"
    if turn % lie_period == 0:
        reply = "lower" if reply == "higher" else "higher"
    write(reply)

wrong(f"failed to find {secret} in {max_turns} turns")
`,
      },
      timeLimitMs: 2500,
      visibility: "public" as const,
      statement: {
        body: "這是一道高難互動題。你要找出區間內秘密數字，但 oracle 並非完全誠實。\n\n互動器第一行輸出：`lo hi maxTurns liePeriod`。\n你每回合輸出一個猜測整數，互動器回應：\n- `higher`：你的猜測太小\n- `lower`：你的猜測太大\n- `correct`：猜中\n\n陷阱：每逢第 `liePeriod` 回合（例如 5,10,15...），若尚未猜中，回應會故意反轉。",
        inputFormat: "互動器先輸出四個整數 `lo hi maxTurns liePeriod`。",
        outputFormat: "每回合輸出一個整數猜測，並立即 flush。",
      },
      samples: [
        {
          input: "1 1000000 35 5\ncorrect",
          output: "500000",
        },
        {
          input: "1 100 35 5\nhigher\nlower\nhigher\nlower\nlower\ncorrect",
          output: "50\n75\n62\n70\n66\n68",
        },
      ],
      testcases: {
        sample: {
          description: "Public sample secrets for the noisy oracle.",
          cases: [
            { input: "42", output: "" },
            { input: "777777", output: "" },
          ],
        },
        hidden: {
          description: "Boundary secrets challenging the lie schedule.",
          cases: [
            { input: "1", output: "" },
            { input: "1000000", output: "" },
            { input: "314159", output: "" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Sum of Two Integers (Advanced Demo)",
      tags: ["medium", "Math", "Bit Manipulation"],
      type: "special_env" as const,
      id: "problem_shell-scripting-lab",
      memoryLimitMb: 512,
      timeLimitMs: 30_000,
      visibility: "public" as const,
      advancedConfig: {
        run: {
          imageRef: advancedDemoImages.run,
          imageSource: "registry",
        },
        grade: {
          imageRef: advancedDemoImages.grade,
          imageSource: "registry",
        },
        network: { mode: "none" },
        maxScore: 100,
      },
      advancedRequiredPaths: ["main.py"],
      statement: {
        body: "這是一道自訂評測環境（Advanced Mode，run/grade 拆分）示範題目。請上傳一個名為 `main.py` 的 Python 程式，系統會把檔案放到 `/workspace/submission/`。\n\n評測環境會用每筆內建測資的 stdin 執行你的 `main.py`，並把輸出交給評分程式（內含標準答案）比對。每行輸入是兩個以空白分隔的整數，請輸出它們的和。全部測資通過即 AC。\n\n範例 `main.py`：\n\n```python\na, b = map(int, input().split())\nprint(a + b)\n```",
        inputFormat: "一行兩個以空白分隔的整數 `a b`。",
        outputFormat: "一個整數：`a + b`。",
      },
    },
    {
      authorId: teacherId,
      id: "problem_palindrome-check",
      title: "Palindrome Check",
      type: "full_source",
      tags: ["easy", "String"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public",
      statement: {
        body: "回文（palindrome）是指從左讀到右和從右讀到左都相同的字串，例如 `level`、`racecar`。\n\n給定一個只由小寫英文字母組成的字串 $s$，判斷它是否為回文。若是，輸出 `Yes`；否則輸出 `No`。",
        inputFormat: "一行，包含一個只由小寫英文字母組成的字串 $s$（$1 \\le |s| \\le 1000$）。",
        outputFormat: "一行，若 $s$ 為回文則輸出 `Yes`，否則輸出 `No`。",
      },
      samples: [
        {
          input: "level",
          output: "Yes",
        },
        {
          input: "hello",
          output: "No",
        },
      ],
      testcases: {
        sample: {
          description: "Public sample cases shown on the problem page.",
          cases: [
            {
              input: "level",
              output: "Yes",
            },
            {
              input: "hello",
              output: "No",
            },
            {
              input: "a",
              output: "Yes",
            },
          ],
        },
        hidden: {
          description:
            "Hidden cases: even/odd palindromes, single character, non-palindromes, and large inputs.",
          cases: [
            {
              input: "abba",
              output: "Yes",
            },
            {
              input: "abcba",
              output: "Yes",
            },
            {
              input: "ab",
              output: "No",
            },
            {
              input: "z",
              output: "Yes",
            },
            {
              input: "abca",
              output: "No",
            },
            {
              input:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              output: "Yes",
            },
            {
              input:
                "abababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababc",
              output: "No",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_fibonacci-number",
      title: "Fibonacci Number",
      type: "full_source",
      tags: ["easy", "Recursion"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public",
      statement: {
        body: "費氏數列（Fibonacci sequence）定義如下：\n\n$$F(0) = 0,\\quad F(1) = 1,\\quad F(n) = F(n-1) + F(n-2)\\ (n \\ge 2)$$\n\n給定一個整數 $n$，輸出第 $n$ 項 $F(n)$。",
        inputFormat: "一行，包含一個整數 $n$（$0 \\le n \\le 90$）。",
        outputFormat: "一行，輸出 $F(n)$ 的值。",
      },
      samples: [
        {
          input: "0",
          output: "0",
        },
        {
          input: "10",
          output: "55",
        },
      ],
      testcases: {
        sample: {
          description: "Public sample cases shown on the problem page.",
          cases: [
            {
              input: "0",
              output: "0",
            },
            {
              input: "1",
              output: "1",
            },
            {
              input: "10",
              output: "55",
            },
          ],
        },
        hidden: {
          description: "Hidden cases: base values, mid-range terms, and the maximum n = 90.",
          cases: [
            {
              input: "2",
              output: "1",
            },
            {
              input: "7",
              output: "13",
            },
            {
              input: "20",
              output: "6765",
            },
            {
              input: "50",
              output: "12586269025",
            },
            {
              input: "90",
              output: "2880067194370816120",
            },
            {
              input: "45",
              output: "1134903170",
            },
            {
              input: "13",
              output: "233",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_max-subarray-kadane",
      title: "Maximum Circular Subarray Sum",
      type: "full_source",
      tags: ["medium", "Dynamic Programming", "Array"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public",
      statement: {
        body: "給定一個長度為 $N$ 的「環狀」整數陣列（$a_N$ 的下一個元素是 $a_1$），找出總和最大的「連續且非空」子陣列，並輸出其總和。子陣列可以跨越尾端接回開頭，但每個元素最多只能取一次（子陣列長度至多為 $N$）。\n\n提示：答案要嘛是一般（不跨界）的最大子陣列和，要嘛是「總和減去最小子陣列和」（跨界情形）。注意陣列可能全為負數，此時答案為最大的單一元素。",
        inputFormat:
          "第一行一個整數 $N$（$1 \\le N \\le 10^5$）。\\n\\n第二行 $N$ 個以空白分隔的整數 $a_i$（$-10^4 \\le a_i \\le 10^4$）。",
        outputFormat: "一行，輸出環狀陣列的最大連續子陣列和。",
      },
      samples: [
        {
          input: "4\n1 -2 3 -2",
          output: "3",
        },
        {
          input: "3\n5 -3 5",
          output: "10",
        },
      ],
      testcases: {
        sample: {
          description: "Public sample cases shown on the problem page.",
          cases: [
            {
              input: "4\n1 -2 3 -2",
              output: "3",
            },
            {
              input: "3\n5 -3 5",
              output: "10",
            },
            {
              input: "3\n-3 -2 -3",
              output: "-2",
            },
          ],
        },
        hidden: {
          description:
            "Hidden cases: single element, all-negative arrays, wrap-around optima, all zeros, and extreme values.",
          cases: [
            {
              input: "1\n7",
              output: "7",
            },
            {
              input: "1\n-7",
              output: "-7",
            },
            {
              input: "5\n3 -2 2 -3 3",
              output: "6",
            },
            {
              input: "4\n-1 -2 -3 -4",
              output: "-1",
            },
            {
              input: "8\n8 -1 3 4 -2 -5 6 2",
              output: "22",
            },
            {
              input: "6\n0 0 0 0 0 0",
              output: "0",
            },
            {
              input: "10\n10000 10000 10000 10000 10000 10000 10000 10000 10000 10000",
              output: "100000",
            },
            {
              input: "4\n-10000 10000 -10000 10000",
              output: "10000",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_grid-bfs-steps",
      title: "Shortest Steps in a Grid",
      type: "full_source",
      tags: ["medium", "Graph", "Breadth-First Search", "Matrix"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public",
      statement: {
        body: "給定一個 $R \\times C$ 的格子圖，每一格是下列字元之一：\n\n- `S`：起點（恰好一個）\n- `G`：終點（恰好一個）\n- `.`：可通行的空格\n- `#`：牆壁，不可進入\n\n從 `S` 出發，每一步可往上、下、左、右移動到相鄰且非牆壁的格子。求到達 `G` 所需的最少步數；若無法到達，輸出 `-1`。",
        inputFormat:
          "第一行兩個整數 $R$ 和 $C$（$1 \\le R, C \\le 500$）。\\n\\n接下來 $R$ 行，每行 $C$ 個字元，描述格子圖。保證恰有一個 `S` 與一個 `G`。",
        outputFormat: "一行，輸出從 `S` 到 `G` 的最少步數，若不可達則輸出 `-1`。",
      },
      samples: [
        {
          input: "3 3\nS..\n.#.\n..G",
          output: "4",
        },
        {
          input: "1 5\nS...G",
          output: "4",
        },
      ],
      testcases: {
        sample: {
          description: "Public sample cases shown on the problem page.",
          cases: [
            {
              input: "3 3\nS..\n.#.\n..G",
              output: "4",
            },
            {
              input: "1 5\nS...G",
              output: "4",
            },
            {
              input: "2 3\nS#G\n...",
              output: "4",
            },
          ],
        },
        hidden: {
          description:
            "Hidden cases: adjacent goal, detours around walls, an unreachable goal, and larger grids.",
          cases: [
            {
              input: "1 2\nSG",
              output: "1",
            },
            {
              input: "5 5\nS....\n####.\n....G\n.####\n.....",
              output: "6",
            },
            {
              input: "3 3\nS.#\n.##\n##G",
              output: "-1",
            },
            {
              input: "4 6\nS.....\n.####.\n.####.\n.....G",
              output: "8",
            },
            {
              input: "2 2\nSG\n..",
              output: "1",
            },
            {
              input: "1 7\nS.....G",
              output: "6",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_sort-and-unique",
      title: "Sort and Deduplicate",
      type: "full_source",
      tags: ["easy", "Sorting"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public",
      statement: {
        body: "給定 $N$ 個整數，將它們去除重複後，由小到大排序，並在一行輸出所有相異的值（以單一空白分隔）。",
        inputFormat:
          "第一行一個整數 $N$（$1 \\le N \\le 10^5$）。\\n\\n第二行 $N$ 個以空白分隔的整數 $a_i$（$-10^9 \\le a_i \\le 10^9$）。",
        outputFormat: "一行，由小到大輸出所有相異的整數，相鄰兩數以單一空白分隔。",
      },
      samples: [
        {
          input: "5\n3 1 2 3 1",
          output: "1 2 3",
        },
        {
          input: "4\n5 5 5 5",
          output: "5",
        },
      ],
      testcases: {
        sample: {
          description: "Public sample cases shown on the problem page.",
          cases: [
            {
              input: "5\n3 1 2 3 1",
              output: "1 2 3",
            },
            {
              input: "4\n5 5 5 5",
              output: "5",
            },
            {
              input: "1\n42",
              output: "42",
            },
          ],
        },
        hidden: {
          description:
            "Hidden cases: negatives, extreme bounds, reverse-sorted, single element, and many duplicates.",
          cases: [
            {
              input: "6\n-1 -1 0 2 2 3",
              output: "-1 0 2 3",
            },
            {
              input: "5\n1000000000 -1000000000 0 1000000000 -1000000000",
              output: "-1000000000 0 1000000000",
            },
            {
              input: "8\n8 7 6 5 4 3 2 1",
              output: "1 2 3 4 5 6 7 8",
            },
            {
              input: "1\n-1000000000",
              output: "-1000000000",
            },
            {
              input: "7\n0 0 0 0 0 0 1",
              output: "0 1",
            },
            {
              input: "10\n5 4 4 3 3 3 2 2 2 2",
              output: "2 3 4 5",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_greatest-common-divisor",
      title: "Greatest Common Divisor",
      type: "full_source",
      tags: ["easy", "Math"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public",
      statement: {
        body: "給定兩個正整數 $a$ 與 $b$，輸出它們的最大公因數 $\\gcd(a, b)$，也就是能同時整除 $a$ 與 $b$ 的最大正整數。\n\n可用歐幾里得（輾轉相除）演算法在 $O(\\log \\min(a,b))$ 時間求解。",
        inputFormat:
          "一行，包含兩個以空白分隔的正整數 $a$ 和 $b$（$1 \\le a, b \\le 10^{18}$）。",
        outputFormat: "一行，輸出 $\\gcd(a, b)$。",
      },
      samples: [
        {
          input: "12 18",
          output: "6",
        },
        {
          input: "7 13",
          output: "1",
        },
      ],
      testcases: {
        sample: {
          description: "Public sample cases shown on the problem page.",
          cases: [
            {
              input: "12 18",
              output: "6",
            },
            {
              input: "7 13",
              output: "1",
            },
            {
              input: "100 10",
              output: "10",
            },
          ],
        },
        hidden: {
          description:
            "Hidden cases: gcd of 1, coprime pairs, divisor relationships, and 18-digit values.",
          cases: [
            {
              input: "1 1",
              output: "1",
            },
            {
              input: "1000000000000000000 999999999999999999",
              output: "1",
            },
            {
              input: "48 36",
              output: "12",
            },
            {
              input: "17 51",
              output: "17",
            },
            {
              input: "1000000007 998244353",
              output: "1",
            },
            {
              input: "999999999999999999 3",
              output: "3",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_balanced-brackets",
      title: "Balanced Brackets",
      type: "full_source",
      tags: ["easy", "Stack"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public",
      statement: {
        body: "給定一個只由六種括號字元 `(`、`)`、`[`、`]`、`{`、`}` 組成的字串，判斷它是否為「合法配對」。\n\n合法的定義是：每個開括號都能與型別相同、且順序正確的閉括號配對，例如 `()[]{}` 與 `{[()]}` 是合法的，而 `([)]` 與 `(]` 不是。\n\n若合法，輸出 `Yes`；否則輸出 `No`。這是經典的堆疊（stack）題。",
        inputFormat: "一行，包含一個只由 `()[]{}` 組成的字串 $s$（$1 \\le |s| \\le 10^5$）。",
        outputFormat: "一行，若括號合法配對則輸出 `Yes`，否則輸出 `No`。",
      },
      samples: [
        {
          input: "()[]{}",
          output: "Yes",
        },
        {
          input: "([)]",
          output: "No",
        },
      ],
      testcases: {
        sample: {
          description: "Public sample cases shown on the problem page.",
          cases: [
            {
              input: "()[]{}",
              output: "Yes",
            },
            {
              input: "([)]",
              output: "No",
            },
            {
              input: "{[()]}",
              output: "Yes",
            },
          ],
        },
        hidden: {
          description:
            "Hidden cases: single unmatched brackets, wrong nesting, deep nesting, and long balanced strings.",
          cases: [
            {
              input: "(",
              output: "No",
            },
            {
              input: ")",
              output: "No",
            },
            {
              input: "(]",
              output: "No",
            },
            {
              input: "(((())))",
              output: "Yes",
            },
            {
              input: "{[}]",
              output: "No",
            },
            {
              input:
                "()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()()",
              output: "Yes",
            },
            {
              input: "([{}])[]{()}",
              output: "Yes",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_knapsack-01",
      title: "Two-Constraint Knapsack",
      type: "full_source",
      tags: ["hard", "Dynamic Programming"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public",
      statement: {
        body: "你有一個背包，同時受到「重量上限 $W$」與「體積上限 $V$」兩個限制，以及 $N$ 件物品。第 $i$ 件物品的重量為 $w_i$、體積為 $c_i$、價值為 $p_i$，每件物品最多只能拿一次。\n\n請選出總重量不超過 $W$ 且總體積不超過 $V$ 的物品組合，使得總價值最大，並輸出這個最大總價值。\n\n這是 0/1 背包的二維限制版本，狀態為 $dp[j][k] =$「重量上限 $j$、體積上限 $k$ 時的最大價值」，兩個維度都要由大到小更新。注意答案可能超過 32 位元整數範圍。",
        inputFormat:
          "第一行三個整數 $N$、$W$ 和 $V$（$1 \\le N \\le 100$，$1 \\le W, V \\le 100$）。\\n\\n接下來 $N$ 行，每行三個整數 $w_i$、$c_i$ 和 $p_i$（$1 \\le w_i, c_i \\le 100$，$1 \\le p_i \\le 10^9$），表示第 $i$ 件物品的重量、體積與價值。",
        outputFormat: "一行，輸出可獲得的最大總價值。",
      },
      samples: [
        {
          input: "3 5 5\n2 3 4\n3 2 5\n4 4 9",
          output: "9",
        },
        {
          input: "1 1 1\n2 2 10",
          output: "0",
        },
      ],
      testcases: {
        sample: {
          description: "Public sample cases shown on the problem page.",
          cases: [
            {
              input: "3 5 5\n2 3 4\n3 2 5\n4 4 9",
              output: "9",
            },
            {
              input: "1 1 1\n2 2 10",
              output: "0",
            },
            {
              input: "3 5 5\n5 1 10\n1 5 10\n3 3 12",
              output: "12",
            },
          ],
        },
        hidden: {
          description:
            "Hidden cases: volume-bound, weight-bound, exact fits, 64-bit totals, and single items.",
          cases: [
            {
              input: "3 3 3\n1 1 1000000000\n1 1 1000000000\n1 1 1000000000",
              output: "3000000000",
            },
            {
              input: "4 4 4\n2 1 3\n1 2 3\n3 3 7\n2 2 4",
              output: "7",
            },
            {
              input: "1 100 100\n1 1 5",
              output: "5",
            },
            {
              input: "2 100 5\n10 10 100\n10 10 100",
              output: "0",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_interval-scheduling",
      title: "Interval Scheduling",
      type: "full_source" as const,
      tags: ["medium", "Greedy", "Sorting"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "校園活動中心收到 $N$ 份活動申請，第 $i$ 份申請希望使用場地的時段為半開區間 $[s_i, e_i)$。場地一次只能舉辦一場活動，因此你必須從中挑選若干場活動，使得任兩場被挑中的活動時段互不重疊。一場活動結束的瞬間即可開始下一場：只要 $e_i \\le s_j$，活動 $i$ 與活動 $j$ 就相容。\n\n請問最多能挑選幾場活動？",
        inputFormat:
          "第一行包含一個整數 $N$（$1 \\le N \\le 10^5$），代表活動數量。\n\n接下來 $N$ 行，每行包含兩個整數 $s_i$、$e_i$（$0 \\le s_i < e_i \\le 10^9$），代表第 $i$ 場活動的開始與結束時間。",
        outputFormat: "輸出一行一個整數，代表最多能挑選的活動數量。",
      },
      samples: [
        { input: "4\n1 3\n2 5\n4 7\n6 8\n", output: "2\n" },
        { input: "3\n0 2\n2 4\n4 6\n", output: "3\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "4\n1 3\n2 5\n4 7\n6 8\n", output: "2\n" },
            { input: "3\n0 2\n2 4\n4 6\n", output: "3\n" },
          ],
        },
        hidden: {
          description: "邊界與手工構造測資",
          weight: 40,
          cases: [
            { input: "1\n5 9\n", output: "1\n" },
            { input: "5\n0 20\n5 15\n9 11\n1 12\n8 19\n", output: "1\n" },
            { input: "6\n0 1\n1 2\n2 3\n3 4\n4 5\n5 6\n", output: "6\n" },
            { input: "4\n0 100\n1 2\n3 4\n5 6\n", output: "3\n" },
            {
              input: "3\n999999998 999999999\n0 1000000000\n999999999 1000000000\n",
              output: "2\n",
            },
          ],
        },
        hidden2: {
          description: "隨機中大型測資",
          weight: 60,
          cases: [
            {
              input:
                "600\n9521 9955\n3190 7608\n5876 9703\n794 9044\n3514 8446\n3632 5996\n7953 9372\n3479 6175\n7175 7464\n4181 5765\n2638 3366\n7294 9495\n6004 6789\n7728 9064\n3912 9134\n6617 8347\n3412 3928\n7047 8963\n4985 6720\n1815 7159\n5382 7572\n6465 9670\n6214 7153\n6929 7244\n6628 9678\n6855 6882\n7603 8491\n8766 8960\n5660 5840\n6076 8963\n5891 5969\n4293 8917\n2512 2796\n7074 7815\n4550 5089\n2470 5786\n5943 9615\n9323 9810\n2725 6809\n8362 9000\n2968 8630\n8692 8705\n1377 2458\n524 9956\n5665 9289\n1947 7484\n9992 10000\n2298 7916\n2929 9422\n3290 9338\n8967 9882\n2284 2950\n2457 9703\n5110 7876\n6144 6421\n976 9964\n9016 9722\n5740 9534\n941 4096\n4565 7249\n1484 6074\n2523 4572\n7636 8474\n6962 7422\n8591 9245\n4003 4787\n4597 9949\n2884 2984\n231 6711\n7517 9850\n728 6241\n3907 6146\n7721 8523\n9049 9657\n8771 9417\n5478 5630\n2191 4552\n5661 8646\n6606 8248\n890 4502\n8459 8595\n3541 4755\n1973 3168\n5611 6606\n6060 6158\n7329 8159\n5969 8071\n9008 9222\n2089 5845\n8943 9595\n4918 7385\n4187 6159\n7129 7963\n7453 8670\n663 4695\n812 6426\n7188 8985\n845 5253\n9056 9784\n3349 3625\n7621 7860\n216 6964\n7406 8529\n2350 6343\n1008 1592\n4357 9309\n1985 7648\n1410 8779\n5553 9817\n1188 3594\n7693 9402\n1780 6125\n104 4012\n5849 7625\n8710 8907\n3806 9816\n3150 8485\n2589 3999\n9622 9963\n3144 6821\n2244 2554\n3101 7333\n8375 8840\n1720 1923\n5455 9621\n2099 6825\n7880 8408\n1797 3608\n670 8016\n9350 9978\n9871 9895\n4511 7812\n2194 7929\n976 2884\n4722 9070\n1012 2590\n4869 7231\n3853 5212\n6363 9050\n9148 9537\n2480 9008\n5448 5714\n3934 6432\n6378 7368\n7691 8688\n3283 6626\n2476 7378\n2690 6750\n7193 9188\n3173 5416\n445 3573\n5393 5709\n3670 6224\n8612 9153\n548 6695\n2104 4189\n9710 9900\n7505 8586\n909 8336\n4945 5695\n2890 8308\n344 6428\n7903 8087\n6296 6475\n5799 6264\n3797 3819\n6224 6738\n8009 8811\n1708 4761\n6895 9712\n7183 8288\n6044 9409\n3514 9121\n9766 9839\n6509 7075\n2691 6921\n7994 8603\n3787 7232\n8610 8706\n882 9573\n1758 1934\n8026 8612\n7485 9013\n4732 5850\n5979 9845\n7863 8857\n2235 8545\n7253 7516\n6366 6781\n7890 8290\n8868 8994\n7434 8549\n5664 8796\n2696 8940\n1253 5082\n8827 9872\n6836 9867\n6857 9982\n2833 8524\n892 7034\n9572 9625\n208 2998\n4183 5480\n8668 8927\n9214 9954\n4706 9041\n9288 9884\n4039 8564\n9227 9976\n1430 4592\n2299 2718\n9165 9358\n7803 8292\n9929 9948\n7900 9948\n4997 6504\n2302 3823\n2597 6686\n6957 8928\n975 3782\n5873 6485\n9330 9587\n2935 8413\n75 192\n5277 5584\n2530 4717\n3774 8965\n2610 8509\n6708 7716\n3250 5876\n2405 8735\n9517 9689\n5741 8892\n5229 7081\n9393 9702\n4823 7165\n8459 9324\n2587 7998\n2385 8233\n181 6369\n1773 8913\n2959 5014\n3469 7119\n8084 9979\n9465 9680\n2053 2911\n1317 8116\n6494 9690\n190 5158\n2874 7938\n2103 6211\n9761 9953\n6648 6898\n5802 6473\n2900 4579\n9111 9993\n5042 5046\n2826 3263\n6323 7818\n8259 8671\n8657 9649\n2464 4359\n5942 6650\n201 8327\n7616 8583\n5069 8682\n5252 5819\n6885 9623\n7183 8637\n636 6335\n7990 8071\n1184 7179\n5695 8377\n1133 2089\n1342 9015\n6187 7416\n3654 5904\n3564 4992\n8791 9206\n2215 6447\n8432 9017\n4388 9150\n1681 4043\n5843 6072\n3007 8012\n6794 9537\n5130 7446\n6112 8444\n5523 6716\n6815 9566\n8333 9394\n3704 7263\n1006 1394\n5055 8094\n3204 5131\n5419 6819\n1220 6286\n1332 6373\n8825 9385\n2492 5332\n296 3918\n3951 9708\n555 9216\n98 4807\n9502 9707\n1351 8889\n5609 6413\n6567 9944\n6270 7857\n5497 8900\n1142 2914\n4246 6761\n8965 9927\n1212 8073\n3256 4520\n333 4025\n8005 8332\n1804 3201\n8531 8861\n8615 9829\n4619 6170\n6233 9574\n7590 7901\n2626 9686\n4650 7402\n2578 3283\n3269 8901\n4558 4894\n3004 5867\n9948 9995\n913 7556\n529 3303\n6908 9621\n8689 8781\n8949 9368\n2130 3722\n7923 8271\n6390 7008\n6937 7659\n6230 9687\n8623 9879\n5418 9516\n1280 2886\n8417 8476\n6704 7315\n8783 9725\n2587 8125\n4167 8477\n9245 9809\n7465 7969\n2980 3845\n7387 8137\n3271 9030\n3672 4130\n8533 9843\n9888 9980\n103 2226\n5082 6752\n5466 7412\n7906 8245\n2010 2404\n3489 8501\n4072 8122\n9133 9592\n1853 9585\n5892 6427\n3968 6576\n4815 6275\n835 8122\n2959 5200\n9839 9859\n174 800\n1977 7802\n1119 2318\n2302 7440\n6488 9895\n4669 9868\n888 1890\n2110 7436\n9117 9230\n8135 9030\n4461 5382\n8009 8684\n2525 8407\n5611 9213\n9468 9712\n5258 9911\n2425 3919\n7289 9032\n4114 9539\n602 9567\n3740 5345\n621 3613\n7305 9270\n5361 9914\n8906 9499\n1836 8486\n7523 8672\n5810 8077\n4148 7601\n4008 7397\n5598 7290\n9770 9946\n5550 5698\n8596 8966\n5233 7133\n1691 8358\n9741 9998\n8077 8442\n5487 7551\n3885 8188\n590 916\n6001 9792\n3568 7040\n8508 9965\n1782 5887\n2924 6709\n146 4735\n2277 7721\n8802 9611\n9236 9937\n4679 9065\n1085 2820\n4726 5821\n9388 9954\n65 3041\n8131 8294\n4043 4183\n5935 7021\n4347 9983\n8070 8209\n3697 7714\n7606 9293\n2432 4036\n4512 8980\n9478 9897\n9210 9866\n5587 7028\n6724 8722\n1863 3868\n6004 9552\n6187 8270\n7622 8007\n430 4936\n7084 9045\n5209 8236\n9906 9981\n8008 9479\n2929 9333\n5252 6336\n9720 9783\n5027 6265\n9202 9775\n8996 9555\n6861 9921\n7790 8825\n5023 9279\n1938 6394\n723 8487\n1002 4815\n6136 7465\n3711 9856\n7459 8505\n4388 7016\n7411 8947\n8904 9856\n957 9426\n6001 8182\n9295 9681\n2515 5980\n4662 7669\n2725 7489\n8402 9722\n6444 8475\n5224 9190\n8328 9871\n8703 9530\n1294 3208\n98 1281\n1581 5252\n7873 8782\n5320 6948\n962 1083\n3645 4121\n3968 9140\n4500 8562\n4130 8955\n4161 7753\n1196 7094\n569 2804\n9376 9923\n761 8851\n2393 9187\n1109 7890\n7841 9497\n2209 7315\n8703 8799\n3376 8379\n2787 3733\n2604 7024\n5026 9138\n8966 9373\n4858 8296\n3835 5268\n1088 7815\n3629 8655\n8143 9390\n2460 6383\n7481 8991\n5220 7665\n9001 9859\n2732 8010\n4578 7407\n4454 9611\n7980 9038\n4271 8386\n9865 9916\n8714 9705\n3163 6581\n867 7589\n1153 8473\n1332 1487\n6029 9393\n7302 8674\n6599 7515\n4598 4819\n4690 6554\n285 5855\n3302 5043\n8069 9289\n9431 9659\n8435 9650\n1127 5885\n8211 8938\n7824 8593\n2624 4055\n2113 2505\n5967 6153\n8222 8945\n5365 8330\n2039 2829\n2356 5319\n9556 9622\n3600 7793\n3061 6449\n7076 7120\n1816 9522\n7887 7958\n4642 7538\n6214 9490\n8537 9624\n9267 9895\n6974 8821\n3331 7061\n7312 7716\n1550 4384\n7322 8800\n674 3736\n5320 6179\n7310 8896\n4524 9414\n9724 9778\n749 1241\n1516 3734\n6657 9377\n6492 9473\n1068 4795\n1302 3237\n5720 7735\n6804 9295\n1615 3346\n5482 9992\n5628 9030\n2958 3606\n3950 4247\n8339 9780\n307 8704\n3001 9187\n7042 9697\n189 9052\n4057 6415\n4724 7625\n1760 5533\n1703 8326\n6360 6409\n5789 7929\n4046 5191\n3214 3947\n8960 9885\n235 8509\n6309 9013\n9168 9281\n4210 6047\n6372 9062\n1413 9140\n5483 8347\n7388 8475\n9749 9851\n8336 8934\n5641 9813\n",
              output: "35\n",
            },
            {
              input:
                "500\n48 50\n41 49\n26 33\n12 38\n3 31\n28 43\n2 36\n20 27\n15 47\n40 50\n48 49\n25 36\n30 35\n27 42\n47 50\n45 46\n33 41\n48 50\n28 44\n31 40\n2 14\n40 42\n2 27\n16 17\n11 25\n12 20\n22 27\n14 27\n27 35\n19 48\n41 47\n12 32\n18 40\n29 37\n22 47\n3 43\n12 37\n25 42\n48 50\n22 36\n10 26\n35 50\n22 34\n7 20\n37 43\n0 6\n42 49\n36 42\n6 25\n47 48\n16 48\n45 48\n41 44\n35 38\n42 50\n8 37\n3 4\n11 34\n46 50\n29 49\n8 10\n31 35\n12 49\n10 11\n3 45\n5 37\n24 25\n23 30\n33 36\n13 40\n29 31\n34 43\n48 50\n31 39\n41 45\n42 50\n38 41\n4 19\n29 45\n39 43\n5 41\n13 15\n2 29\n3 45\n20 37\n40 50\n32 45\n25 44\n31 43\n19 24\n15 28\n6 45\n35 44\n47 50\n28 44\n24 42\n35 37\n16 32\n40 45\n42 50\n35 49\n7 47\n44 47\n14 38\n38 45\n39 47\n9 13\n37 50\n35 39\n30 41\n21 29\n47 50\n37 41\n14 20\n23 45\n16 29\n12 32\n12 23\n28 29\n44 45\n44 47\n18 40\n12 21\n9 35\n0 2\n2 22\n49 50\n20 25\n37 39\n24 26\n42 50\n23 45\n8 27\n16 44\n20 26\n44 46\n16 30\n26 48\n45 48\n28 49\n47 48\n18 31\n1 42\n33 48\n45 47\n13 48\n1 24\n21 45\n13 18\n33 41\n21 31\n12 36\n39 44\n10 39\n37 50\n49 50\n23 37\n24 43\n17 30\n4 10\n23 31\n45 47\n42 45\n44 45\n47 48\n26 45\n16 48\n15 16\n4 10\n31 34\n3 48\n20 33\n21 38\n18 32\n16 18\n46 49\n45 47\n3 16\n21 39\n27 44\n12 45\n21 48\n9 22\n23 44\n41 49\n1 34\n9 10\n7 17\n39 43\n27 43\n35 45\n39 44\n42 48\n19 41\n31 40\n8 10\n21 33\n36 40\n22 38\n3 32\n3 37\n37 46\n27 43\n30 35\n40 44\n8 33\n49 50\n8 42\n48 50\n2 41\n5 23\n26 48\n4 27\n11 22\n14 48\n46 47\n4 27\n34 35\n4 9\n34 43\n41 48\n45 48\n26 43\n13 18\n26 47\n19 20\n1 37\n26 34\n24 32\n5 44\n9 10\n32 43\n26 32\n3 25\n25 43\n40 44\n37 43\n19 25\n23 47\n1 10\n16 24\n13 36\n41 48\n12 19\n16 25\n5 34\n35 42\n28 30\n28 46\n18 34\n49 50\n22 44\n1 3\n2 41\n24 44\n9 29\n30 40\n19 39\n30 44\n39 48\n7 40\n30 32\n27 31\n8 26\n10 34\n24 39\n24 35\n37 43\n11 38\n1 23\n44 50\n11 39\n46 47\n40 50\n5 24\n37 45\n14 18\n3 45\n13 36\n25 44\n41 45\n48 50\n6 17\n10 47\n19 27\n32 38\n45 50\n36 44\n27 32\n33 47\n31 44\n13 17\n16 47\n42 50\n1 34\n37 49\n25 38\n19 22\n47 49\n45 46\n42 44\n38 47\n40 50\n47 49\n38 48\n10 12\n31 48\n48 50\n11 40\n44 50\n7 49\n31 35\n26 28\n15 45\n19 37\n38 44\n41 47\n45 47\n17 30\n16 30\n13 37\n10 38\n26 32\n41 43\n39 42\n38 45\n4 31\n23 48\n14 39\n6 14\n22 46\n21 31\n11 44\n49 50\n10 29\n38 48\n14 32\n49 50\n20 37\n10 12\n12 48\n26 27\n19 33\n4 32\n34 50\n35 50\n3 7\n48 50\n48 50\n39 49\n10 49\n29 38\n21 49\n3 43\n46 49\n49 50\n42 46\n30 41\n48 49\n46 47\n2 10\n4 45\n42 44\n39 40\n37 45\n17 30\n46 49\n15 43\n4 11\n14 29\n40 44\n28 35\n35 43\n11 13\n22 26\n12 25\n24 43\n49 50\n14 31\n7 11\n5 29\n35 37\n32 45\n49 50\n24 29\n33 41\n30 48\n49 50\n3 35\n20 32\n4 6\n8 12\n32 44\n27 31\n19 49\n38 39\n31 44\n3 34\n48 49\n6 22\n43 44\n14 21\n27 36\n18 49\n31 40\n41 46\n26 41\n35 37\n27 46\n30 42\n26 40\n28 48\n8 30\n7 42\n20 46\n11 49\n46 49\n7 15\n21 47\n21 42\n38 47\n9 46\n48 50\n4 33\n17 20\n19 40\n13 47\n19 37\n38 39\n0 44\n42 44\n35 39\n40 50\n35 46\n8 23\n18 24\n36 43\n29 44\n34 35\n35 38\n49 50\n42 47\n46 47\n22 33\n35 50\n2 23\n11 40\n9 39\n21 26\n42 48\n41 43\n12 14\n39 44\n36 44\n27 48\n14 40\n43 49\n22 32\n38 48\n18 42\n8 29\n46 47\n45 48\n13 28\n34 38\n48 50\n28 47\n7 23\n2 46\n24 43\n24 38\n26 34\n49 50\n24 47\n9 37\n35 40\n33 46\n22 38\n45 47\n6 47\n44 45\n39 45\n26 38\n25 28\n36 46\n10 42\n44 45\n35 49\n39 44\n17 19\n27 32\n35 40\n0 27\n29 34\n14 35\n22 34\n3 26\n47 48\n8 29\n30 43\n",
              output: "28\n",
            },
            {
              input:
                "300\n33991955 291886277\n795062888 847382461\n98656130 706607715\n669080818 807956537\n608521607 885690032\n427649190 596978313\n439921828 947645779\n847919155 871618565\n275457110 842976913\n584021667 998425290\n736596867 745237623\n637658970 702866562\n746194286 851183288\n148317378 677548318\n311286929 315724192\n883075458 966320127\n724586381 946191935\n300847136 342142215\n246119927 477294612\n362739335 522304565\n168540687 391877574\n632443398 790152689\n854307982 883236757\n753566857 820299178\n888203737 983847913\n754233255 894831663\n701310458 836325706\n564357005 698205063\n862250755 867949424\n948705026 966979114\n941958695 992747949\n295619166 975378532\n137048034 982168819\n899051309 996629354\n378411090 455658775\n691139605 955977481\n181039719 471398024\n594122787 669520277\n940310028 948565858\n902850385 992084545\n784676918 956873949\n864214893 910960290\n520604993 570860300\n196157347 599283276\n41295564 387648613\n617624906 960825861\n253442904 431694150\n769810051 937813399\n77621546 835084396\n462831946 465107243\n114549966 462583645\n144812197 326149280\n269973308 475905072\n700809741 715269004\n668465876 944280800\n676689856 678917447\n277388892 852113163\n767170226 774612352\n67698456 339769806\n207597977 748662813\n739655396 968961421\n196170977 921184957\n404565189 447251345\n531295979 799874090\n165348768 785605238\n198142827 898177026\n620448257 654717304\n75588452 596734848\n441258534 602548545\n227146214 781736427\n483822695 843751796\n375142275 913678887\n451935767 817003877\n41504232 556734808\n977646102 999699359\n501966146 727613503\n27312541 595149980\n847864189 927496727\n943437351 970103586\n464860341 506648721\n216394456 708089422\n975107078 992024522\n803173383 845982906\n960019417 981317061\n579276904 877977268\n932504652 997734603\n577282140 916088841\n91514091 366270099\n736490415 956574536\n167072190 326919299\n850043317 941373220\n904761541 940972956\n691061883 871400630\n699791898 825910159\n386195906 884650389\n857539809 929135285\n47158653 676269989\n872703235 981257518\n274890459 512210819\n358816231 664491250\n546239240 629712298\n592443062 953754307\n343945798 618961293\n421948114 994028454\n987627841 988069894\n167201123 189352333\n697213827 741479340\n887707474 922108901\n701946319 847893019\n645364176 659417289\n450190155 868969274\n854761557 907175876\n923719848 929346982\n323491353 499140212\n968986748 977912839\n922095034 991843437\n190577170 623026022\n340946400 472255258\n172283395 888400810\n792095659 919182190\n770930214 945925439\n296881291 838199162\n389313416 577559045\n766808856 880526930\n896146777 941858264\n589806866 689100288\n836509896 990119478\n981573572 995859209\n76059528 97666264\n51091724 304609377\n522157797 943002083\n353168671 758273201\n817846997 967033865\n785706296 932860174\n235866596 718463469\n829638715 849871925\n497856873 664714910\n821862636 903194701\n145896853 573139221\n805128469 930016895\n488164026 760786256\n948420675 957473167\n967691327 996882270\n712706142 789337277\n738856107 943891706\n845813342 985832192\n255307883 267284854\n755072288 989240278\n803776909 830938665\n529999463 625768524\n122571308 242175879\n487320407 686866053\n611075283 969322056\n450125750 813181404\n5875857 86709721\n129573792 418843051\n491219498 559334315\n83909264 518955129\n815406158 920489319\n672693009 841558167\n32188883 584645227\n716022198 857512567\n268411819 754671514\n672739008 935714762\n366363480 445858934\n669174143 681072245\n73752489 950314646\n131543245 479921213\n152352804 274110589\n851035971 890127001\n721925677 837534001\n221338585 325955815\n85596321 383394789\n289960167 960578945\n655602760 959263744\n330658243 784125903\n637827015 864436828\n871231720 980005940\n199558981 421936438\n853866273 949523510\n518766270 724190946\n819470895 990306225\n911966957 930514621\n475596599 691950555\n390333203 775080874\n202809854 550631433\n774696874 852871777\n377569278 871184782\n168453387 400644068\n551721222 896449815\n387699029 765322379\n882168106 997833164\n410877833 721513104\n39126911 410762142\n289260073 946073114\n572854048 786571757\n679271668 748171564\n636143043 987831027\n452328053 477464997\n511308753 984597356\n946894309 999012207\n141969869 687561559\n681326019 792463949\n38611492 394366969\n514741572 940169464\n113930563 933715896\n758770436 872359555\n148084892 870569837\n333052838 429914702\n784232311 802713973\n195472992 846499160\n734539031 987121687\n548990127 576601272\n242109698 619396206\n219219213 526453920\n436069500 546201287\n182545280 833401662\n516199570 790690924\n638345596 678207221\n307379092 493722040\n617616363 864627441\n932940810 951289128\n708704428 825805393\n64413964 403333909\n921093560 972360025\n55517686 552542860\n693297238 832464518\n317369779 478228241\n295340300 490544284\n867594250 874380174\n600930965 993221954\n1949152 917030690\n548303482 781393372\n681604616 701572230\n353428620 802868922\n474465874 484167333\n896905022 898396540\n621470610 662181966\n894752676 910827282\n12553124 959350805\n715448202 980014061\n269150458 554355336\n85423582 178168844\n32791088 252876488\n461444509 944533159\n874387142 995558219\n200268007 615483924\n538433220 840184853\n636840188 957476398\n842791202 899030940\n269108135 531380474\n360511813 590560512\n899079726 946488478\n797586935 964487600\n673121949 898660113\n574743822 935941809\n655774173 773440820\n791292525 881221282\n370951076 390061466\n934476998 960851579\n970038215 985772965\n802075540 846117789\n705207305 736140278\n324015412 723576741\n403332578 972813161\n276281702 580653402\n753830321 968612631\n4549925 384364123\n500359506 504451308\n96280494 959714324\n752389557 903298804\n633389687 677637308\n595893287 774527188\n740455541 979181394\n159206330 778255449\n992896944 999575762\n937333800 986502156\n284146828 723632940\n611960460 977566987\n574565681 932836177\n978479416 999531438\n553536894 817013379\n226468311 430595542\n544925885 704246114\n915302667 984681053\n506934488 507803562\n772092824 866972108\n881836396 928076351\n884915893 973213354\n176770083 884007039\n653616178 703835731\n841905179 920668636\n353871879 412339292\n867150792 916207513\n286715969 391924827\n604376782 748768794\n121885812 600555966\n908570385 918112038\n764355549 928802418\n915149390 986258284\n",
              output: "28\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_min-merge-cost",
      title: "Minimum Merge Cost",
      type: "full_source" as const,
      tags: ["medium", "Greedy", "Heap"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "工地上有 $N$ 堆石子，第 $i$ 堆的重量為 $a_i$。每次操作你可以任選兩堆石子合併成一堆，合併的代價為兩堆重量之和，新堆的重量也是兩堆重量之和。你必須不斷合併，直到只剩下一堆為止。\n\n請求出把所有石子合併成一堆所需的最小總代價。若一開始就只有一堆（$N = 1$），不需要任何操作，總代價為 $0$。",
        inputFormat:
          "第一行包含一個整數 $N$（$1 \\le N \\le 10^5$），代表石子堆數。\n\n第二行包含 $N$ 個整數 $a_1, a_2, \\ldots, a_N$（$1 \\le a_i \\le 10^9$），代表每堆石子的重量。",
        outputFormat: "輸出一行一個整數，代表最小總代價。",
      },
      samples: [
        { input: "4\n4 3 1 2\n", output: "19\n" },
        { input: "3\n1 2 3\n", output: "9\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "4\n4 3 1 2\n", output: "19\n" },
            { input: "3\n1 2 3\n", output: "9\n" },
          ],
        },
        hidden: {
          description: "邊界與手工構造測資",
          weight: 40,
          cases: [
            { input: "1\n7\n", output: "0\n" },
            { input: "2\n1000000000 1000000000\n", output: "2000000000\n" },
            { input: "8\n5 5 5 5 5 5 5 5\n", output: "120\n" },
            { input: "10\n1 2 3 4 5 6 7 8 9 10\n", output: "173\n" },
            { input: "5\n1000000000 999999999 1 2 999999998\n", output: "6000000003\n" },
          ],
        },
        hidden2: {
          description: "隨機中大型測資",
          weight: 60,
          cases: [
            {
              input:
                "600\n91695 976692 425555 933946 3409 542953 97999 714756 625739 99856 348901 140464 415264 104943 22377 925359 687943 700200 884317 503303 95089 557886 7951 187784 691556 614063 786210 694741 192636 199883 148146 961604 530670 766200 138871 316865 428236 780805 280036 583240 48102 290665 356166 979617 855912 933943 572503 619588 218244 78263 54913 285466 98736 445727 461998 799034 450182 631488 170112 573734 902779 892650 405520 115702 531931 817246 224957 870075 736696 310349 31097 766061 548095 335964 365561 695251 986150 263961 719114 206518 438819 847231 222085 487366 251281 458172 270866 266201 530814 322484 206609 548145 44913 149756 371524 77659 479468 11745 506086 456678 119202 108251 538858 367677 614440 830877 928977 931730 44259 992369 694388 708191 284975 578221 310560 596346 458268 296377 683275 984472 210284 490955 18233 745832 719112 195614 598520 89856 650536 578348 95205 275095 449820 101498 265529 126885 428228 865915 131890 237757 171445 430196 814376 727673 208048 263631 494028 705240 219562 434850 855666 71432 100525 95059 142110 737141 427935 145348 797035 554559 831270 859233 974985 614001 451733 830140 114935 478042 539571 124913 784614 592616 488908 718634 711983 703744 492753 500382 550343 933323 957706 906679 407968 217650 550836 704274 506193 444364 945990 958702 294631 381887 85642 468162 384137 385807 526255 113890 47732 443145 873133 621253 968139 380298 828936 537447 36877 157368 613292 947869 45380 733486 514188 15218 197164 320193 986298 742617 604123 929395 939024 613964 8505 81171 930483 553078 610667 36152 926969 148730 6514 261790 113181 659781 250525 351214 37931 129207 657870 513165 446735 763584 518019 257777 5315 830016 727828 4763 807245 521919 764125 15104 480866 745412 214703 236791 954076 951060 484769 851004 595334 413612 880744 17865 275886 148159 588326 754774 507311 756847 893733 736068 953164 808796 274845 88099 713909 461062 561346 980675 603127 771962 368149 389793 445523 503209 709217 750319 453137 532870 374129 426819 39381 429633 143698 467543 799029 708513 189429 651422 373623 792150 461259 845106 332278 167320 730722 786144 428252 620683 713964 488324 170051 818778 513323 147625 617132 650781 289966 766291 93714 515764 623175 94234 230558 420799 579513 280536 912814 20636 161504 507278 205474 302699 638752 957906 161611 760818 162820 12904 252484 650428 509077 135047 531432 324027 256698 160732 108536 665205 583948 567754 180486 422436 279854 667963 975081 855317 922446 14542 982489 880170 710639 426887 219114 727732 560085 327281 851387 560223 219028 563696 124049 748338 359632 509856 717166 586968 447785 864768 173242 681272 327987 603165 307299 911689 406523 439582 576429 279345 85575 148427 822770 578508 655155 324585 666993 834369 338412 495547 240537 130539 894610 406273 169930 678330 421712 862514 110141 719508 161439 98866 743609 781766 770463 651414 757029 800429 387639 534406 913057 578802 272339 535893 108096 511318 598399 343718 757857 765105 754240 950423 929677 218881 772111 713465 272489 251952 299052 228483 674832 13687 810006 168830 958680 519755 395473 208947 866871 708531 672876 75523 117112 67311 724862 338863 374973 43506 100787 823985 456200 405140 560269 660791 633065 80218 410123 829032 691176 372402 190488 578349 470215 468684 910059 139620 616753 381586 796850 221831 940992 673260 14798 312747 129408 684317 287141 335478 480054 261736 881003 512373 94318 798092 326911 255448 178031 28528 993997 582393 36533 566855 581971 442900 892445 88829 358096 388253 646181 11685 95480 797337 105704 401025 890447 79171 637757 401356 498571 793849 326723 953075 854186 526965 60373 464719 157177 795427 809666 261179 415764 658580 913135 268770 355503 949302 397213 948824 297558 112135 909607 495226 465124 629177 559461 28970 695609 222496 326532 107230 690197 164696 304634 784285 682687 518224 422498 591818 954470 338122 660000 820792 606072 363402 190342 518637 901118 208545 886464 179261 718118 435884 205953 482016 130385 462751 133419 875583 76955 428319 416971 76258 8437 240738 502023 644005 433300 502592 98667 323265 519733 22919 764229 618246 481109 845851 15696 749855 487186 744502\n",
              output: "2585235584\n",
            },
            {
              input:
                "350\n160639121 275797428 906571027 321494229 301186034 362952013 753393140 504977670 315558318 573104884 853638563 572860268 692093112 376158868 64953116 436843570 879837245 905111207 656068233 434241505 637320872 575112566 697257802 775086550 106517576 801446545 957201546 903628903 357976821 592407213 490296567 267636482 130497644 21384121 317907647 301086073 154312044 228733159 131024642 819408761 463336394 828025706 955700899 846225861 920232055 564616730 834308763 290900167 776150360 796665772 57118773 410223358 321808401 854751693 312735475 882942534 923523037 334903886 264799364 392766270 198868385 594225695 77499972 404393804 784420085 969621972 862212948 863531544 756770753 623814427 930835929 975876145 459701200 432192118 400336338 299700195 8430582 168739956 183279902 654590929 727545242 338769559 449771771 960811125 692917629 11064475 560932854 933656789 824835461 872850066 999514512 670332462 362613499 665486824 303685631 686803488 73876179 353652584 421920369 884707527 589600861 542970505 611945279 120651157 554975769 480692156 88272068 685406809 726130876 419134088 364149580 268686403 519729013 245268579 595849651 572303883 150862913 696773962 535367838 545924285 836740646 685644317 127550789 752257701 280971484 564456608 410754074 5506543 865886078 957076605 194019087 359964932 301200427 870448114 901487886 22742567 296839988 101092834 776491574 533935648 76694826 490477360 521842454 223103072 130542822 585825885 421255668 187452401 745144696 120197313 46942982 981759889 932287568 777009717 719448428 555239988 281282388 60364675 831655856 517423817 355238705 527863 879886764 815362073 535781169 583374561 142433826 87231069 475444248 954443254 906248853 11722709 992108459 511475370 541441954 203868427 688530102 581582313 403062446 68951415 788466768 599354037 472762131 203799026 969693727 126424631 674080636 199908681 140821335 734346873 415922170 584654918 927249242 354793593 158019084 665337007 638672297 263875297 705078402 62904863 193588093 580837228 426807493 501271519 193151370 27395630 46122349 886907629 498092634 849200178 11482746 174046524 841908206 552679760 562445537 421833575 334067465 944739276 304674240 383532113 433091079 572844653 993632916 78219079 789190643 108726229 175846737 752960298 367170349 988492019 923695939 917361519 259507266 792531464 530199062 825233834 355374541 156762811 325900982 436322290 109450592 327659659 430156958 26100416 719382623 946004833 135611437 33160285 729733093 259215072 885831524 97027956 815001406 578187315 202735182 709238000 246682486 483727006 225183072 263912667 253103623 345023607 570635971 955951387 749796660 300542872 120263835 974325667 612432820 107460481 983197535 338232416 550982449 279711808 275037294 625782502 644559987 76357799 926953655 74318013 923058587 11832254 183987880 808402798 417418947 588236998 465155404 525873808 155688611 600567718 885053991 537279041 573889581 771961818 658325272 344795731 688421247 269990122 368551426 737111661 110793292 66434884 913625515 502073939 278627096 264203822 349001200 303994076 95012159 876053357 248745499 913997401 499702106 532377453 801669146 467636810 245057771 811336661 888577474 276797390 380366831 329363188 278504016 69241385 983885065 867963744 725542178 100327505 886262773 362522683 897862142 750481814 397535237 759884581 231021340 250119766 91474037 660233307 862403525 535425675 618129211 158208961 793565065 774599953 615927580 871275475 578490952 185774067 734813915 324819491\n",
              output: "1440741790904\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_pair-sum-count",
      title: "Pairs Under Threshold",
      type: "full_source" as const,
      tags: ["easy", "Two Pointers", "Sorting"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "給定 $N$ 個整數 $a_1, a_2, \\ldots, a_N$ 與一個門檻值 $T$。\n\n請計算有多少對索引 $(i, j)$ 滿足 $i < j$ 且 $a_i + a_j \\le T$。",
        inputFormat:
          "第一行包含兩個整數 $N$、$T$（$2 \\le N \\le 10^5$，$-2 \\times 10^9 \\le T \\le 2 \\times 10^9$）。\n\n第二行包含 $N$ 個整數 $a_1, a_2, \\ldots, a_N$（$-10^9 \\le a_i \\le 10^9$）。",
        outputFormat: "輸出一行一個整數，代表滿足條件的數對數量。",
      },
      samples: [
        { input: "5 6\n1 5 2 4 3\n", output: "6\n" },
        { input: "3 -5\n-1 -2 -3\n", output: "1\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "5 6\n1 5 2 4 3\n", output: "6\n" },
            { input: "3 -5\n-1 -2 -3\n", output: "1\n" },
          ],
        },
        hidden: {
          description: "邊界與手工構造測資",
          weight: 40,
          cases: [
            { input: "4 100\n1 2 3 4\n", output: "6\n" },
            { input: "4 3\n2 2 2 2\n", output: "0\n" },
            { input: "2 0\n1000000000 -1000000000\n", output: "1\n" },
            { input: "2 2000000000\n1000000000 1000000000\n", output: "1\n" },
            { input: "2 -2000000000\n-1000000000 -1000000000\n", output: "1\n" },
            { input: "6 0\n-5 3 -2 7 0 2\n", output: "6\n" },
          ],
        },
        hidden2: {
          description: "隨機中大型測資",
          weight: 60,
          cases: [
            {
              input:
                "550 578745286\n888795681 -878880836 -221472569 430803544 -67556812 417110112 -247888790 -713568848 -24802394 19340408 -27542082 -648693552 433551974 921825736 -614061288 405839003 -352063989 -959446362 839994884 613114462 -285322022 -112928679 -274167046 -791312593 596611487 -163241193 -804880337 -108527760 156279175 614074565 -851077477 63328475 -539658964 84978231 662966524 -926973790 205841488 -538702999 -691306365 391912353 -77267035 -84904606 314808746 374675145 -304551478 576883926 614354863 559640182 -722686031 345587264 907093492 -84744701 236605167 -997821701 -840608469 -617639832 146973781 -63552937 -764855617 -219122267 -214451697 -831114202 -228476225 791531251 -841244277 691085724 -893902309 -303379619 666243685 -349247500 -514761980 -302477677 -262912784 -497825372 70113165 -587654647 -319101318 -795641590 396053102 776115897 -49495769 345734117 753668221 298972530 -36299972 78107317 -949050068 -954896730 -879594691 840549508 -896503833 -22674986 -637959240 567312799 -997015956 277194617 -875576079 118252718 -357968798 -278141470 -948955240 -853590023 -85132021 902129952 163895336 644199292 843056811 -949358274 -701647335 546748635 644358289 -229008375 -500425029 -46497196 663684792 501911884 720744842 -704589103 -991291236 -384406093 269939382 513782545 -313918540 5497642 -159948348 202957662 -10277623 -193508336 -466812697 -103130258 923988982 -813038425 131852971 296208770 -607092776 712039323 -115703371 131617652 -99326897 519256614 957012246 621362767 -233221441 329053890 -843778091 -539830347 -233206860 699416621 392655124 121124393 -162422642 -665944926 478899138 798565065 779274621 -303814147 420265050 -271079843 425561379 598249158 -949790650 954343168 -929554040 -977172804 -499399210 -939298833 139469555 832029753 269678524 929165369 331190607 -862410625 230708598 -576014935 396114504 61354298 -883243857 -6612321 344204527 -583224013 112946229 419687860 -765104888 -850955010 334944765 79863817 967213448 -68668108 -966762679 -783439645 558133683 164648410 363493700 44548821 -931212622 717360997 632497749 -381722896 325459783 519942117 774675530 344765071 -320432097 147014332 -76097690 596442960 18124420 668719148 572920589 614602950 800429475 633240136 -135726803 383068525 -517596297 215540772 120813180 -174175326 823578328 -490744311 593713585 -667913112 620827832 876338989 446271424 559891681 -613565150 229936540 792759867 901331130 -573348559 -356776139 639667023 -899025751 94201819 -154594556 -415852793 246731952 72993078 -945594873 655794512 -846938813 -918380432 881476593 656928253 270451365 478745817 954886772 -376935083 -114171644 -8603776 771863068 222991531 -199418521 -50157707 -244438030 -392155040 210174141 -140295992 124451896 -500397429 353132797 -812917947 547500862 -256231893 821509697 425021503 707386077 629289693 508559329 -877356629 29422975 -839899297 473838147 -21739894 -931544705 -485607350 -779592287 -861197653 -708152081 -15519953 -316898208 692715628 127118514 -132177316 98881938 973915935 102365230 -718379789 97820972 -917112619 -573183271 -803810460 551117447 282069051 69493893 257146962 936668558 -501848340 -594559985 -323630459 393083755 -561495026 -559173992 -374251965 -798307182 202860321 820428925 -42852623 -917887265 -114808790 -237522502 995939272 209355297 -133332249 891069913 -504451247 724222937 -854894005 131700919 -302496614 622128985 -258411887 720219378 14277613 773951863 535790399 12805270 -909059650 -316336352 -740270810 33041522 -92426630 89419857 968459404 996960264 329861962 194108977 778066022 733144099 187498564 730130553 909929406 180590075 348054357 883809316 567008356 947932348 -920171290 -607116605 -465713166 74222858 103678612 -129138485 20778398 -69844500 88466580 495215085 66676701 842156523 941061069 -20466025 -467845690 -424361803 -571318048 -359679956 -371292257 -166339455 171177421 -819766080 359096099 156053886 -280276903 -971892129 -447071958 -192763790 905904020 204394487 -415481349 -684135246 -438707742 136335955 459543789 976970463 345888951 221593055 788197892 -552707921 486480152 988265316 -707128866 -974107652 -972211330 164553751 -309133684 615536621 -654069389 118834928 -278340650 471198120 382821776 154753699 -112692767 106503394 255956137 864386306 -221807312 204036338 838427320 -537213145 890774273 537956828 766698769 -194160204 420616145 -202107586 -297568164 -581772274 -829287844 -503396391 -706082895 -189477966 -4767951 -455281373 964772547 474376079 -29757077 -856820333 -662147414 -366511088 -267839 -960204971 -812909964 743697410 195873344 39889859 856893217 395949379 475631027 261040276 878700746 -4992955 -709307568 696917821 541827759 52741857 -80403439 -372854301 9897206 457797769 -659889540 729309568 -331709254 386500039 -854036296 227143409 -672141936 -539406213 989929941 -957202772 657567706 -349968017 454673245 -188244129 -549387021 -970276405 780000480 423206226 -334350071 -639644675 -915790933 417885152 78133459 -901628448 -483255832 -560682662 602915461 396553080 -914753345 277951814 493352711 71021678 706343509 888146353 -387136946 698726029 -302555412 -500225143 -884938726 -316224377 -854264633 -382504942 -871630560 47803928 94488312 678446670 -285228406 340622987 -10650801 -685310622 831210074 711887970 -48365885 536425617 -669386615 -143518985 -936641653 298684582 -179820504 -509731540 582835644 397482941 -301977375 557234840 783021137 -612062885 6531252 -548375142 -190679822 -712184614 -573906582 524853580 -369364014 919170523 -225976967 -109214000 554465101 833840862 -885923753 -478360251 -974084382 -961095476 721321911 700361537 -25917026 158486203 849001112 -357501321 331623815 377793648 -903705070 679842934 -946044518 768507622 365329285 -129681264 203924846 405765324 -962586869 -605009860\n",
              output: "113183\n",
            },
            {
              input:
                "400 0\n-96 55 61 -15 31 91 36 18 69 -100 29 35 42 68 -22 -72 25 19 -90 62 -83 -29 96 10 -76 53 75 -30 65 12 -30 80 67 17 13 -39 41 2 -6 56 -29 26 13 -75 5 58 16 -80 18 23 -2 56 28 -55 -98 16 60 70 -14 -23 53 -26 -99 -12 34 -28 18 3 -86 6 -23 -68 -60 -19 37 -50 37 -49 37 11 12 62 74 -74 100 52 94 68 -99 -90 20 61 -28 -91 37 -42 71 -90 82 89 -20 52 -76 -26 -19 -43 -46 -7 -54 46 -11 -9 -19 53 49 26 -48 -49 -91 -25 -16 31 -12 56 -79 -14 -82 98 -91 -90 57 -78 -84 -97 15 -74 -63 -62 -2 -94 74 39 99 -15 -26 -97 67 -22 -79 37 87 -89 46 -28 -16 -42 70 -74 -15 10 54 -27 72 28 -23 -26 -91 95 7 -47 -24 38 -41 85 81 -5 -17 0 6 98 -56 -100 -97 78 -66 -24 8 -99 -49 72 56 -93 -28 66 79 33 37 -96 11 24 94 -25 -46 18 -12 38 68 8 89 53 -8 -37 -82 -54 51 38 -7 17 49 77 64 83 79 -88 -8 -94 49 -15 -77 -86 23 -34 -64 -65 89 -75 5 62 40 69 24 40 -78 65 38 82 14 8 -46 91 8 13 -73 62 -94 19 -88 -52 -60 -74 73 1 4 66 98 57 89 34 92 -7 -16 -94 -58 21 18 45 91 -3 100 49 -72 18 -87 28 81 78 -19 32 45 75 -14 10 -66 -93 0 30 -27 -51 92 -16 12 -85 51 10 -74 -92 24 31 98 12 -57 28 -23 91 -75 -88 -17 49 33 -53 12 36 -84 -36 87 90 -3 -3 60 67 49 76 -65 -80 23 54 66 47 79 52 25 14 25 40 68 -5 33 -9 45 93 5 -84 -92 69 -37 16 -28 71 -16 -11 99 -42 -79 -58 -9 -75 73 94 -31 -91 25 -71 95 -21 58 5 -24 -21 8 78 56 4 63 37 26 13 62 -67 33 16 -14 30 -43 59 25 -55 -42 -45 36 -46\n",
              output: "37302\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_meeting-rooms",
      title: "Meeting Rooms",
      type: "full_source" as const,
      tags: ["medium", "Greedy", "Sorting"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "公司行事曆上排定了 $N$ 場會議，第 $i$ 場會議的時段為半開區間 $[s_i, e_i)$。一間會議室在同一時刻只能舉辦一場會議；若前一場會議的結束時刻恰好等於下一場會議的開始時刻（$e_i = s_j$），則兩場會議可以在同一間會議室接續舉行。\n\n請問最少需要準備幾間會議室，才能讓所有會議如期舉行？",
        inputFormat:
          "第一行包含一個整數 $N$（$1 \\le N \\le 10^5$），代表會議數量。\n\n接下來 $N$ 行，每行包含兩個整數 $s_i$、$e_i$（$0 \\le s_i < e_i \\le 10^9$），代表第 $i$ 場會議的開始與結束時間。",
        outputFormat: "輸出一行一個整數，代表最少需要的會議室數量。",
      },
      samples: [
        { input: "3\n0 10\n5 20\n15 25\n", output: "2\n" },
        { input: "2\n1 3\n3 5\n", output: "1\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "3\n0 10\n5 20\n15 25\n", output: "2\n" },
            { input: "2\n1 3\n3 5\n", output: "1\n" },
          ],
        },
        hidden: {
          description: "邊界與手工構造測資",
          weight: 40,
          cases: [
            { input: "1\n3 8\n", output: "1\n" },
            { input: "5\n0 10\n0 10\n0 10\n0 10\n0 10\n", output: "5\n" },
            { input: "4\n0 1\n2 3\n5 8\n10 11\n", output: "1\n" },
            { input: "6\n0 2\n2 4\n4 6\n6 8\n8 10\n10 12\n", output: "1\n" },
            { input: "4\n0 100\n10 90\n20 80\n30 40\n", output: "4\n" },
            {
              input: "4\n0 1000000000\n999999999 1000000000\n0 1\n500000000 500000001\n",
              output: "2\n",
            },
          ],
        },
        hidden2: {
          description: "隨機中大型測資",
          weight: 60,
          cases: [
            {
              input:
                "600\n5970 7825\n4657 5718\n7212 8183\n5748 8925\n7978 9571\n4013 8390\n2997 3092\n4392 4952\n5774 6114\n9498 9553\n9742 9850\n8525 9083\n9261 9902\n1251 9640\n547 1156\n9058 9807\n2707 9519\n4010 8670\n8303 8589\n9395 9892\n146 3984\n2555 8795\n6347 8883\n8369 9727\n1760 4486\n8404 9074\n6761 7115\n9675 9746\n8559 9665\n9130 9565\n8356 8754\n8356 9518\n5577 5627\n8936 9831\n9385 9879\n1105 8743\n2297 8296\n3716 4604\n3402 5940\n8813 9990\n9826 9912\n3702 8750\n6198 7704\n8772 9432\n7206 9208\n5046 9739\n7849 8441\n297 9554\n5855 9241\n2817 4501\n2028 2485\n5041 5866\n2991 3039\n1162 9351\n4373 9005\n5686 8618\n2142 7648\n4052 8547\n5539 5576\n5965 8323\n4033 4242\n1552 3079\n8294 9633\n9849 9965\n2930 7986\n3790 9628\n6289 8978\n2434 6645\n8061 9399\n6121 6449\n9970 9986\n5352 5496\n3945 8097\n8389 8832\n3653 7531\n2660 6632\n5847 8746\n2818 7915\n1856 6607\n642 9321\n4320 7707\n6630 9971\n8903 9515\n446 4617\n9868 9891\n3121 7056\n4073 5764\n2069 5406\n8084 8149\n497 9047\n2941 9306\n6468 8394\n4095 7963\n4332 4557\n169 3728\n4330 5549\n1053 5660\n9717 9868\n4601 9059\n4357 8842\n3454 8348\n5549 8646\n5766 8227\n5501 8642\n2828 3596\n9841 9934\n8441 9767\n5187 6932\n3314 4061\n559 2574\n9974 9977\n7258 7985\n9076 9341\n4343 9661\n8794 9792\n4759 9318\n5849 8377\n3487 6926\n6473 8459\n2834 3884\n3875 5097\n2332 5132\n1529 5379\n2646 5206\n4165 6485\n806 3048\n4696 8030\n6355 9353\n487 8754\n2547 9009\n2487 8818\n9232 9513\n5286 5680\n822 2061\n9942 9945\n2327 6869\n3028 4972\n3053 3804\n5819 7720\n9635 9672\n1325 4823\n4942 9990\n144 3934\n4652 9288\n5246 7920\n2884 7467\n245 1743\n5294 6133\n9019 9580\n6511 8987\n9613 10000\n3872 7752\n1620 7781\n4661 6814\n8654 9672\n4800 9622\n7363 9167\n5350 9624\n6281 8069\n580 8804\n712 7253\n8162 8924\n2 8916\n5488 8455\n8112 9414\n9367 9988\n7487 9057\n1593 2831\n9999 10000\n2014 8527\n5409 9877\n1489 7109\n5630 8801\n356 3113\n4018 9926\n6528 8568\n7068 9863\n4906 8174\n1414 6169\n7936 8637\n3665 5911\n5976 9652\n648 5715\n3272 4525\n3482 6201\n3269 9751\n4740 9576\n6120 8910\n1643 6407\n4948 5100\n3413 4218\n1991 5503\n8012 8657\n9941 9954\n3263 9476\n2458 8987\n3942 6521\n7221 9015\n3681 4020\n3764 6955\n682 4809\n8006 9964\n9542 9624\n3254 5986\n8573 9253\n6648 8223\n624 3639\n1817 6813\n4914 5523\n9119 9770\n662 3331\n9284 9907\n2039 5819\n2537 3523\n4074 4345\n1471 5951\n9998 9999\n5738 6284\n7099 7886\n8328 9429\n1382 7240\n1668 3189\n8428 9517\n2179 8849\n2392 5812\n2133 4371\n3941 7895\n8562 8654\n88 6287\n4142 7828\n6892 7356\n5098 6086\n3373 5280\n2387 3868\n1498 6793\n9081 9523\n6605 6662\n4230 9292\n6784 8589\n1976 2407\n8987 9113\n700 7963\n3702 4200\n7167 9458\n295 9513\n803 9771\n1815 9479\n8956 9461\n5201 8351\n4595 5899\n8273 9721\n8171 9594\n94 2182\n1110 1572\n9937 9972\n6501 7822\n1380 4221\n9598 9869\n4038 6468\n5208 6874\n2877 8757\n4559 9538\n9686 9743\n5139 5589\n5218 9512\n5637 6491\n7690 9572\n7819 7894\n4459 5261\n9284 9465\n5394 6374\n4569 8507\n6649 9781\n4644 9566\n2406 4537\n1237 4846\n1467 3052\n5899 8131\n5896 5919\n4701 8080\n3337 8810\n7641 9268\n2832 3381\n4099 9041\n9349 9988\n3290 5859\n393 1713\n356 2668\n2074 5791\n6806 7657\n3811 4420\n2609 7186\n9678 9728\n4369 7303\n2541 8448\n455 6045\n1029 6992\n6252 9988\n97 3828\n4136 4251\n6053 6182\n1414 7957\n2834 8163\n3759 4550\n2552 4670\n4969 7275\n9307 9539\n4710 4733\n7823 8086\n2506 7227\n4582 5881\n2417 2631\n100 2954\n551 7219\n3717 8127\n2289 9354\n7568 8334\n8492 9542\n1417 2743\n959 6443\n3942 4674\n5208 5569\n9004 9522\n6241 6299\n2802 7850\n3658 9740\n1961 6567\n4868 6788\n3957 4198\n3251 6234\n6106 6359\n9500 9639\n4011 7352\n2098 9382\n6059 6151\n4386 7025\n3006 3892\n9227 9440\n245 4379\n6728 8696\n8410 9377\n1904 8495\n5766 8334\n1740 2008\n3856 8036\n2614 3637\n1438 9300\n2000 2067\n9063 9215\n9627 9705\n4044 9228\n4746 9280\n7851 8881\n4040 7236\n9238 9254\n1913 8267\n4485 5875\n258 6780\n2438 9709\n7303 8729\n7018 7167\n1040 7014\n6606 7782\n6872 9197\n3425 6217\n8665 9627\n5523 7251\n2475 5870\n3601 6930\n819 2611\n1284 2191\n2090 3853\n2250 3586\n4246 8364\n8434 8447\n4670 6340\n1928 9629\n6646 7536\n5998 7274\n4054 9725\n2052 2666\n4829 9248\n4905 8248\n8727 9533\n4346 5560\n2161 2714\n8831 9992\n3221 6261\n1677 5979\n790 7911\n2036 2409\n6733 9356\n9568 9794\n8684 9902\n3853 7787\n9106 9680\n8069 9422\n3889 9012\n4063 6253\n9692 9805\n2747 4799\n3923 7456\n9364 9780\n5790 6133\n8598 9181\n465 8890\n7829 9705\n3142 8688\n7518 8619\n2752 4237\n1530 3247\n5143 9750\n4777 6413\n7648 7967\n4249 7743\n5026 8380\n2714 5367\n5057 9989\n4463 4856\n491 8318\n5081 5571\n7256 7919\n2120 2673\n5995 7323\n6248 7903\n6867 9299\n8003 8103\n6540 7579\n2139 9368\n3040 7577\n489 9467\n3714 9503\n1616 4981\n7223 9398\n9930 9931\n2254 7196\n45 5912\n1935 4549\n8631 9094\n786 9709\n5220 6640\n7606 9955\n4039 9146\n9490 9525\n1067 3073\n2607 6242\n8450 9534\n5766 8202\n9822 9922\n688 6666\n9526 9909\n8703 9776\n7126 9676\n4792 6981\n432 5610\n4236 9247\n1053 4709\n8303 8981\n325 7975\n9333 9777\n7611 9611\n1704 3607\n5050 7053\n5426 5460\n9578 9960\n1287 6439\n7429 7676\n9015 9562\n1679 4763\n5475 9175\n9586 9611\n3750 9831\n7184 8017\n8650 9299\n8626 9559\n6851 7237\n5707 8272\n8269 9826\n7306 8969\n919 4568\n5753 7267\n9876 9910\n5117 8945\n205 2732\n8793 9195\n4077 6750\n8336 9289\n951 6640\n3931 6574\n6027 9167\n7221 8582\n5075 7573\n847 6150\n9659 9745\n8179 9899\n5993 8092\n1654 5331\n5811 7825\n5363 6061\n2346 7872\n7536 8891\n3159 6795\n8983 9547\n5828 8174\n2546 8549\n3194 4912\n6482 9807\n6290 9703\n2472 6961\n8818 9763\n4158 9594\n9108 9281\n7306 9344\n716 3433\n6072 6985\n721 9424\n2426 6837\n6359 7309\n7358 7851\n5652 6644\n9404 9935\n7589 7869\n8590 8793\n4081 8041\n4865 5379\n9411 9990\n9993 10000\n9858 9868\n4197 4847\n6796 7422\n4861 7448\n2797 2893\n613 9604\n362 5788\n4778 9160\n9079 9894\n2317 2395\n8930 9423\n8573 8599\n4396 9868\n845 4140\n9762 9978\n7269 9154\n827 5432\n2209 5421\n8992 9289\n6197 6885\n3166 4748\n2093 5968\n6015 8343\n9052 9803\n4557 5380\n1788 5403\n8876 9231\n5559 7476\n7257 7482\n4247 5190\n7998 8345\n2092 8663\n2846 4790\n972 4786\n4575 9371\n5019 5826\n5213 7011\n8977 9437\n2883 7288\n8812 9103\n179 4809\n7897 9097\n6969 7486\n8348 9489\n6753 9542\n3563 5085\n8484 9605\n7264 9971\n4075 5671\n2721 5692\n6135 9956\n7903 9012\n3906 4185\n8996 9936\n3186 9031\n5301 6730\n3074 9319\n5079 8143\n2956 9107\n2025 6275\n7277 8908\n2932 4858\n9264 9753\n4797 7299\n8432 8901\n9548 9738\n5586 9631\n5503 8157\n2999 3832\n54 6179\n5481 7128\n6688 9173\n4164 7919\n",
              output: "235\n",
            },
            {
              input:
                "400\n13 56\n25 39\n15 16\n48 58\n18 43\n43 57\n32 48\n15 45\n39 53\n51 60\n4 47\n39 52\n54 56\n8 59\n9 43\n41 43\n4 5\n37 57\n23 32\n3 49\n17 30\n7 51\n13 22\n2 21\n30 56\n54 57\n24 26\n14 48\n37 59\n12 22\n51 54\n8 9\n0 22\n57 58\n42 51\n26 52\n1 19\n36 46\n25 26\n17 35\n17 59\n16 49\n27 29\n58 60\n37 53\n21 22\n12 53\n9 53\n35 39\n50 51\n7 41\n26 51\n20 56\n50 54\n20 51\n13 33\n54 55\n29 51\n14 23\n9 27\n4 35\n37 49\n55 56\n37 52\n52 59\n15 42\n54 58\n47 50\n6 15\n36 39\n40 41\n41 51\n53 57\n36 60\n9 28\n36 50\n3 52\n23 31\n29 45\n36 45\n46 51\n54 57\n13 32\n53 54\n16 30\n56 59\n17 45\n30 41\n23 45\n51 59\n4 18\n18 58\n0 7\n38 52\n9 37\n35 56\n9 52\n49 60\n10 38\n36 51\n22 40\n1 17\n49 58\n26 50\n37 54\n1 33\n47 48\n55 57\n50 59\n28 38\n13 48\n28 31\n37 55\n32 36\n11 30\n44 60\n16 32\n50 51\n49 60\n58 60\n22 44\n28 45\n46 55\n56 59\n20 26\n2 27\n50 59\n21 38\n41 58\n15 24\n56 60\n59 60\n15 53\n24 39\n34 45\n44 60\n38 45\n49 51\n0 18\n10 38\n11 12\n22 60\n21 27\n22 32\n45 56\n37 48\n56 60\n39 40\n56 57\n30 49\n21 52\n43 55\n9 50\n53 58\n41 45\n46 57\n58 60\n4 55\n44 48\n47 51\n16 27\n29 43\n58 60\n44 49\n42 55\n27 33\n31 42\n29 50\n58 59\n17 60\n19 58\n53 55\n39 55\n13 22\n26 42\n29 47\n53 54\n38 57\n46 60\n35 58\n56 57\n2 59\n33 34\n3 15\n9 14\n2 17\n43 54\n19 24\n53 55\n55 57\n28 31\n18 27\n14 26\n18 32\n23 30\n52 60\n12 50\n27 33\n35 46\n47 58\n1 50\n56 58\n44 52\n25 60\n27 28\n0 18\n17 40\n14 51\n53 56\n1 17\n43 57\n53 60\n36 56\n28 42\n19 46\n42 46\n22 30\n27 57\n33 57\n8 15\n37 46\n22 24\n44 45\n53 57\n43 56\n28 53\n21 52\n13 53\n26 49\n39 41\n56 58\n33 54\n1 47\n15 51\n41 44\n29 55\n11 36\n55 60\n54 60\n7 54\n33 60\n34 39\n41 51\n27 38\n17 25\n15 28\n39 42\n4 29\n15 22\n49 55\n25 35\n54 59\n47 58\n56 58\n51 57\n32 46\n51 59\n39 55\n57 58\n58 59\n17 59\n23 35\n46 59\n17 37\n51 53\n7 32\n17 58\n5 11\n50 60\n10 31\n26 41\n55 58\n53 54\n6 7\n57 59\n49 56\n54 59\n38 53\n50 59\n37 58\n42 50\n1 48\n0 32\n34 43\n7 59\n2 55\n18 32\n40 60\n38 46\n16 57\n10 11\n38 54\n36 53\n40 55\n32 38\n28 58\n24 48\n30 45\n1 14\n33 34\n59 60\n53 57\n21 51\n48 54\n16 25\n59 60\n13 14\n46 57\n17 45\n54 59\n22 59\n12 33\n2 45\n22 58\n47 56\n16 19\n50 57\n6 22\n22 29\n36 52\n6 56\n7 51\n20 56\n0 25\n39 55\n16 28\n49 53\n37 50\n45 59\n8 32\n33 39\n40 46\n58 60\n20 58\n34 43\n57 59\n2 36\n30 57\n59 60\n59 60\n23 25\n54 56\n26 35\n3 26\n2 20\n9 57\n52 58\n30 40\n26 36\n3 7\n5 22\n58 59\n16 54\n54 60\n29 31\n27 58\n33 44\n29 37\n3 4\n30 52\n6 15\n11 34\n52 55\n18 27\n59 60\n2 16\n40 41\n1 26\n23 50\n36 49\n9 14\n58 60\n2 5\n27 54\n36 59\n45 51\n10 14\n34 45\n9 54\n50 56\n47 53\n38 56\n54 60\n5 12\n26 33\n32 60\n19 36\n56 59\n46 56\n16 55\n10 45\n22 38\n30 47\n6 16\n13 39\n38 55\n2 14\n10 59\n8 45\n34 37\n",
              output: "149\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_dijkstra-shortest-path",
      title: "Cheapest Route",
      type: "full_source" as const,
      tags: ["medium", "Graph", "Heap"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "王國裡有 $N$ 座城市（編號 $1$ 到 $N$）與 $M$ 條雙向道路。第 $i$ 條道路連接城市 $u_i$ 與 $v_i$，通行一次需繳過路費 $w_i$。同一對城市之間可能有多條道路，也可能出現兩端是同一座城市的道路（自環）。\n\n商人小安住在城市 $1$，要前往城市 $N$ 談生意。請幫他找出一條總過路費最小的路線，輸出這個最小總費用；若無論如何都無法從城市 $1$ 抵達城市 $N$，輸出 `-1`。",
        inputFormat:
          "第一行包含兩個整數 $N$ 與 $M$（$1 \\le N \\le 10^5$，$0 \\le M \\le 2 \\times 10^5$）。\n\n接下來 $M$ 行，每行三個整數 $u_i$、$v_i$、$w_i$（$1 \\le u_i, v_i \\le N$，$1 \\le w_i \\le 10^9$），表示一條連接城市 $u_i$ 與 $v_i$、過路費為 $w_i$ 的雙向道路。",
        outputFormat:
          "輸出一行一個整數：從城市 $1$ 到城市 $N$ 的最小總過路費；若無法抵達城市 $N$，輸出 `-1`。注意答案可能超過 32 位元整數範圍。",
      },
      samples: [
        { input: "4 5\n1 2 10\n1 3 1\n3 2 1\n2 4 1\n1 2 2\n", output: "3\n" },
        { input: "3 1\n1 2 5\n", output: "-1\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例",
          cases: [
            { input: "4 5\n1 2 10\n1 3 1\n3 2 1\n2 4 1\n1 2 2\n", output: "3\n" },
            { input: "3 1\n1 2 5\n", output: "-1\n" },
          ],
        },
        hidden: {
          description: "小規模與邊界測資：單點、自環、重邊、不連通",
          weight: 40,
          cases: [
            { input: "1 0\n", output: "0\n" },
            { input: "1 1\n1 1 5\n", output: "0\n" },
            { input: "2 3\n1 2 7\n1 2 3\n1 2 9\n", output: "3\n" },
            { input: "4 4\n1 2 10\n1 3 1\n3 2 1\n2 4 1\n", output: "3\n" },
            { input: "5 4\n1 2 3\n2 2 4\n4 5 1\n5 4 2\n", output: "-1\n" },
            {
              input: "8 8\n8 8 17\n4 3 17\n8 3 4\n8 5 5\n2 1 20\n7 8 20\n3 1 17\n2 1 2\n",
              output: "21\n",
            },
            { input: "5 1\n1 5 10\n", output: "10\n" },
          ],
        },
        hidden2: {
          description: "較大規模測資：大權重長鏈與隨機中型圖",
          weight: 60,
          cases: [
            {
              input:
                "300 299\n1 2 1000000000\n2 3 1000000000\n3 4 1000000000\n4 5 1000000000\n5 6 1000000000\n6 7 1000000000\n7 8 1000000000\n8 9 1000000000\n9 10 1000000000\n10 11 1000000000\n11 12 1000000000\n12 13 1000000000\n13 14 1000000000\n14 15 1000000000\n15 16 1000000000\n16 17 1000000000\n17 18 1000000000\n18 19 1000000000\n19 20 1000000000\n20 21 1000000000\n21 22 1000000000\n22 23 1000000000\n23 24 1000000000\n24 25 1000000000\n25 26 1000000000\n26 27 1000000000\n27 28 1000000000\n28 29 1000000000\n29 30 1000000000\n30 31 1000000000\n31 32 1000000000\n32 33 1000000000\n33 34 1000000000\n34 35 1000000000\n35 36 1000000000\n36 37 1000000000\n37 38 1000000000\n38 39 1000000000\n39 40 1000000000\n40 41 1000000000\n41 42 1000000000\n42 43 1000000000\n43 44 1000000000\n44 45 1000000000\n45 46 1000000000\n46 47 1000000000\n47 48 1000000000\n48 49 1000000000\n49 50 1000000000\n50 51 1000000000\n51 52 1000000000\n52 53 1000000000\n53 54 1000000000\n54 55 1000000000\n55 56 1000000000\n56 57 1000000000\n57 58 1000000000\n58 59 1000000000\n59 60 1000000000\n60 61 1000000000\n61 62 1000000000\n62 63 1000000000\n63 64 1000000000\n64 65 1000000000\n65 66 1000000000\n66 67 1000000000\n67 68 1000000000\n68 69 1000000000\n69 70 1000000000\n70 71 1000000000\n71 72 1000000000\n72 73 1000000000\n73 74 1000000000\n74 75 1000000000\n75 76 1000000000\n76 77 1000000000\n77 78 1000000000\n78 79 1000000000\n79 80 1000000000\n80 81 1000000000\n81 82 1000000000\n82 83 1000000000\n83 84 1000000000\n84 85 1000000000\n85 86 1000000000\n86 87 1000000000\n87 88 1000000000\n88 89 1000000000\n89 90 1000000000\n90 91 1000000000\n91 92 1000000000\n92 93 1000000000\n93 94 1000000000\n94 95 1000000000\n95 96 1000000000\n96 97 1000000000\n97 98 1000000000\n98 99 1000000000\n99 100 1000000000\n100 101 1000000000\n101 102 1000000000\n102 103 1000000000\n103 104 1000000000\n104 105 1000000000\n105 106 1000000000\n106 107 1000000000\n107 108 1000000000\n108 109 1000000000\n109 110 1000000000\n110 111 1000000000\n111 112 1000000000\n112 113 1000000000\n113 114 1000000000\n114 115 1000000000\n115 116 1000000000\n116 117 1000000000\n117 118 1000000000\n118 119 1000000000\n119 120 1000000000\n120 121 1000000000\n121 122 1000000000\n122 123 1000000000\n123 124 1000000000\n124 125 1000000000\n125 126 1000000000\n126 127 1000000000\n127 128 1000000000\n128 129 1000000000\n129 130 1000000000\n130 131 1000000000\n131 132 1000000000\n132 133 1000000000\n133 134 1000000000\n134 135 1000000000\n135 136 1000000000\n136 137 1000000000\n137 138 1000000000\n138 139 1000000000\n139 140 1000000000\n140 141 1000000000\n141 142 1000000000\n142 143 1000000000\n143 144 1000000000\n144 145 1000000000\n145 146 1000000000\n146 147 1000000000\n147 148 1000000000\n148 149 1000000000\n149 150 1000000000\n150 151 1000000000\n151 152 1000000000\n152 153 1000000000\n153 154 1000000000\n154 155 1000000000\n155 156 1000000000\n156 157 1000000000\n157 158 1000000000\n158 159 1000000000\n159 160 1000000000\n160 161 1000000000\n161 162 1000000000\n162 163 1000000000\n163 164 1000000000\n164 165 1000000000\n165 166 1000000000\n166 167 1000000000\n167 168 1000000000\n168 169 1000000000\n169 170 1000000000\n170 171 1000000000\n171 172 1000000000\n172 173 1000000000\n173 174 1000000000\n174 175 1000000000\n175 176 1000000000\n176 177 1000000000\n177 178 1000000000\n178 179 1000000000\n179 180 1000000000\n180 181 1000000000\n181 182 1000000000\n182 183 1000000000\n183 184 1000000000\n184 185 1000000000\n185 186 1000000000\n186 187 1000000000\n187 188 1000000000\n188 189 1000000000\n189 190 1000000000\n190 191 1000000000\n191 192 1000000000\n192 193 1000000000\n193 194 1000000000\n194 195 1000000000\n195 196 1000000000\n196 197 1000000000\n197 198 1000000000\n198 199 1000000000\n199 200 1000000000\n200 201 1000000000\n201 202 1000000000\n202 203 1000000000\n203 204 1000000000\n204 205 1000000000\n205 206 1000000000\n206 207 1000000000\n207 208 1000000000\n208 209 1000000000\n209 210 1000000000\n210 211 1000000000\n211 212 1000000000\n212 213 1000000000\n213 214 1000000000\n214 215 1000000000\n215 216 1000000000\n216 217 1000000000\n217 218 1000000000\n218 219 1000000000\n219 220 1000000000\n220 221 1000000000\n221 222 1000000000\n222 223 1000000000\n223 224 1000000000\n224 225 1000000000\n225 226 1000000000\n226 227 1000000000\n227 228 1000000000\n228 229 1000000000\n229 230 1000000000\n230 231 1000000000\n231 232 1000000000\n232 233 1000000000\n233 234 1000000000\n234 235 1000000000\n235 236 1000000000\n236 237 1000000000\n237 238 1000000000\n238 239 1000000000\n239 240 1000000000\n240 241 1000000000\n241 242 1000000000\n242 243 1000000000\n243 244 1000000000\n244 245 1000000000\n245 246 1000000000\n246 247 1000000000\n247 248 1000000000\n248 249 1000000000\n249 250 1000000000\n250 251 1000000000\n251 252 1000000000\n252 253 1000000000\n253 254 1000000000\n254 255 1000000000\n255 256 1000000000\n256 257 1000000000\n257 258 1000000000\n258 259 1000000000\n259 260 1000000000\n260 261 1000000000\n261 262 1000000000\n262 263 1000000000\n263 264 1000000000\n264 265 1000000000\n265 266 1000000000\n266 267 1000000000\n267 268 1000000000\n268 269 1000000000\n269 270 1000000000\n270 271 1000000000\n271 272 1000000000\n272 273 1000000000\n273 274 1000000000\n274 275 1000000000\n275 276 1000000000\n276 277 1000000000\n277 278 1000000000\n278 279 1000000000\n279 280 1000000000\n280 281 1000000000\n281 282 1000000000\n282 283 1000000000\n283 284 1000000000\n284 285 1000000000\n285 286 1000000000\n286 287 1000000000\n287 288 1000000000\n288 289 1000000000\n289 290 1000000000\n290 291 1000000000\n291 292 1000000000\n292 293 1000000000\n293 294 1000000000\n294 295 1000000000\n295 296 1000000000\n296 297 1000000000\n297 298 1000000000\n298 299 1000000000\n299 300 1000000000\n",
              output: "299000000000\n",
            },
            {
              input:
                "250 480\n217 99 6891\n11 67 8377\n125 104 4970\n248 123 5867\n150 229 3579\n130 36 4618\n36 194 1554\n159 205 4105\n233 137 9862\n231 38 5082\n26 187 1209\n231 218 5410\n121 144 1650\n91 112 5181\n157 164 3351\n248 142 7816\n114 222 8542\n67 16 8990\n235 4 1529\n185 216 6535\n182 212 19\n157 127 5459\n63 187 5329\n181 223 1032\n49 235 9299\n57 62 2335\n206 140 7340\n24 21 5244\n225 131 8017\n28 78 9032\n75 181 2045\n141 86 8853\n53 247 9883\n141 151 4713\n114 24 9770\n205 99 5195\n148 62 4757\n48 49 3060\n9 157 4261\n122 18 1472\n174 194 2134\n225 39 634\n216 21 8858\n175 101 8595\n71 134 3859\n218 56 9664\n212 244 6872\n149 71 7383\n127 170 5856\n22 84 1890\n125 151 5494\n217 49 3982\n5 188 4441\n30 181 3613\n96 204 2794\n86 110 1019\n26 201 2398\n219 179 3585\n12 210 9403\n163 233 8753\n155 175 1213\n7 32 3089\n156 213 9437\n31 101 1500\n95 214 1902\n10 156 355\n50 247 3031\n184 32 7852\n54 187 1001\n240 174 374\n140 109 1663\n214 67 1147\n57 19 4933\n90 112 2955\n16 129 7654\n11 153 1654\n180 101 3267\n67 92 7705\n215 231 9336\n44 179 3333\n248 197 952\n202 174 2593\n217 42 5609\n136 65 1921\n153 236 7247\n171 45 217\n121 175 6716\n231 146 8333\n235 80 5852\n100 215 4112\n40 144 204\n118 190 1296\n86 190 749\n140 72 2210\n62 196 7895\n91 157 4717\n173 92 9672\n243 229 2169\n184 80 6358\n192 107 1323\n1 153 3151\n179 86 2623\n62 58 7343\n97 182 9309\n224 107 517\n103 224 9298\n108 198 767\n43 115 1047\n67 180 2584\n115 136 7984\n233 144 9896\n194 1 638\n127 84 5113\n215 120 817\n208 211 6802\n49 141 1368\n215 186 2139\n4 103 6841\n81 1 3499\n4 184 39\n211 173 8657\n157 26 3121\n31 156 3253\n224 78 4588\n177 47 1642\n122 219 6500\n161 21 358\n71 234 7422\n205 203 1897\n221 66 2186\n168 134 5687\n30 224 2531\n72 218 305\n11 11 3371\n175 67 9149\n81 243 6012\n241 146 689\n217 192 9955\n168 127 7515\n164 112 6103\n224 138 2922\n54 97 9620\n75 3 2269\n39 70 5463\n87 203 6017\n184 24 5542\n200 159 585\n11 70 2685\n39 150 4744\n93 102 8987\n34 76 1883\n123 188 3928\n240 13 5045\n46 220 8570\n187 19 4959\n104 214 5383\n77 107 1781\n26 144 7884\n122 87 5631\n32 123 1901\n180 128 6989\n10 78 5490\n189 176 2551\n236 43 9249\n97 207 1425\n17 207 1388\n51 192 3622\n16 99 129\n26 101 9118\n133 75 7349\n236 126 9583\n183 174 3560\n109 22 6035\n57 67 9589\n199 43 7066\n50 92 1885\n17 211 453\n232 135 7400\n193 174 3305\n31 128 6521\n66 54 690\n243 205 3538\n160 38 1715\n51 118 6194\n93 140 2480\n27 153 7994\n38 145 6651\n164 175 6935\n225 134 8117\n174 235 5284\n214 128 8170\n163 172 3310\n139 157 3585\n3 88 5215\n210 83 582\n135 38 4209\n155 201 2555\n216 98 9552\n76 184 7708\n17 205 1387\n133 223 646\n17 58 2139\n11 77 251\n195 217 7350\n85 221 2633\n205 39 7549\n248 96 8274\n98 231 8681\n129 9 9403\n24 174 8487\n195 154 1252\n192 110 3377\n75 138 9808\n107 212 7901\n217 203 6367\n156 151 3827\n218 222 336\n169 227 4\n190 47 4956\n130 146 4170\n86 17 8086\n221 68 4962\n198 105 6295\n208 99 1021\n42 165 2087\n62 74 5473\n15 242 589\n124 107 2309\n126 228 9863\n184 21 2481\n208 91 6737\n10 157 7640\n99 118 771\n26 121 2481\n6 9 9803\n159 34 5307\n27 180 8998\n167 89 3195\n99 201 8034\n29 226 986\n157 180 7655\n158 162 5536\n167 32 4856\n202 218 2083\n246 234 6352\n205 76 1992\n133 221 3099\n10 201 6423\n114 96 3121\n117 92 1235\n245 12 656\n125 66 437\n242 134 9327\n147 225 3539\n59 24 8232\n179 135 6884\n130 79 1859\n38 110 9274\n109 237 1377\n240 27 6810\n17 26 6803\n199 40 504\n203 115 7063\n176 107 494\n128 236 5317\n185 65 1287\n91 19 1989\n92 178 482\n89 90 2915\n3 213 3777\n210 94 1156\n153 229 2348\n54 1 3356\n169 173 2019\n192 2 4805\n95 177 404\n239 155 3816\n220 37 3064\n117 29 7811\n89 182 4231\n34 8 3410\n93 86 7756\n246 75 4856\n240 225 9064\n163 84 3016\n152 21 1681\n137 149 5043\n41 97 2408\n243 33 3651\n81 131 3979\n61 194 3014\n75 96 6878\n170 12 2167\n154 6 6453\n20 180 1200\n34 108 4906\n141 107 2332\n152 109 4883\n164 91 1386\n64 114 6050\n164 243 8671\n15 97 6695\n3 107 5254\n113 53 6089\n76 244 7716\n24 244 3039\n204 28 4538\n29 143 9922\n177 40 7310\n238 103 3038\n197 108 7074\n45 64 7430\n88 240 8575\n37 91 7577\n162 164 1418\n124 194 3337\n76 1 7358\n159 119 128\n56 77 1876\n197 162 4935\n140 156 2560\n109 181 7724\n24 174 8154\n195 246 3808\n140 196 6641\n72 162 355\n31 70 665\n1 66 6528\n135 228 9530\n182 102 7285\n27 192 4139\n91 73 3212\n153 22 581\n19 203 4301\n79 137 5569\n31 136 4081\n229 236 2680\n18 107 4747\n73 134 2203\n147 134 3446\n137 27 6731\n245 163 8906\n104 190 4565\n75 114 6092\n146 161 2258\n41 32 1975\n98 103 9684\n120 36 9169\n172 77 5801\n162 122 6802\n56 123 8010\n178 129 5215\n127 167 987\n114 77 2340\n191 127 859\n228 160 3535\n7 91 7726\n101 228 166\n217 135 1089\n176 222 1334\n176 244 6474\n2 93 675\n30 159 62\n70 224 4793\n187 231 3715\n37 193 9386\n74 49 1728\n112 118 5410\n99 44 5419\n108 166 7132\n38 115 2417\n135 81 2118\n54 234 3061\n114 90 6372\n110 207 8061\n100 187 3608\n204 51 7198\n241 53 9610\n182 13 6363\n9 60 1388\n223 48 5958\n15 191 2841\n60 157 4875\n157 23 8391\n193 73 5785\n106 118 884\n162 179 8457\n171 245 8966\n239 189 7056\n149 117 8032\n66 181 7794\n56 87 4357\n11 12 862\n42 90 64\n75 168 117\n36 17 7009\n175 57 9972\n102 143 3621\n117 50 5563\n156 27 9935\n227 22 5227\n83 138 7467\n229 84 4187\n8 134 727\n49 95 1313\n54 223 8594\n89 49 3304\n65 173 4937\n80 133 6303\n66 124 5636\n224 183 3932\n12 79 9044\n19 3 7552\n127 186 7180\n13 235 6753\n127 118 7211\n31 22 1335\n62 26 2520\n106 227 3498\n113 157 1264\n210 110 9159\n194 227 6464\n11 246 2956\n64 126 3606\n33 216 4572\n240 91 5237\n112 28 9127\n231 74 9996\n139 202 3297\n183 76 7239\n132 155 7571\n138 163 4277\n70 60 272\n31 158 1621\n45 188 6794\n64 56 4663\n226 189 106\n190 138 8443\n110 220 816\n32 99 4465\n31 249 9252\n92 59 8957\n170 73 3631\n190 213 3935\n17 133 5039\n173 84 3828\n96 161 7869\n74 150 2808\n36 208 254\n142 130 5373\n94 150 415\n208 34 6482\n40 250 2897\n131 20 2222\n196 53 8139\n146 197 3498\n61 188 2165\n209 60 6302\n91 156 9684\n34 162 8167\n231 235 1770\n158 214 427\n135 153 5876\n126 117 5058\n4 246 3606\n143 168 2672\n170 226 8106\n208 245 7880\n140 81 1291\n67 36 9901\n103 181 3131\n211 82 4780\n99 242 970\n54 10 5164\n186 192 4090\n88 221 7229\n172 186 3702\n67 89 2660\n79 5 5839\n147 139 954\n",
              output: "12798\n",
            },
            {
              input:
                "600 350\n395 431 664\n266 524 7962\n415 311 7809\n367 598 3579\n517 143 4618\n144 98 4105\n546 151 5082\n102 76 5410\n484 574 1650\n363 445 5181\n210 566 7816\n454 534 4268\n64 562 231\n96 409 19\n506 342 3997\n334 65 3131\n582 228 3910\n146 557 7340\n94 83 5244\n521 502 1787\n309 565 4770\n128 561 5452\n554 209 9883\n561 295 7291\n94 395 5195\n590 248 4757\n189 194 3060\n34 267 7808\n71 92 2134\n154 40 1315\n554 401 8595\n283 535 3859\n221 430 9498\n282 462 8072\n366 85 5314\n119 499 9619\n344 195 3982\n17 278 1920\n226 381 2794\n341 437 1019\n104 150 3585\n47 588 8753\n76 28 2039\n194 590 1962\n401 94 6065\n119 38 9921\n23 200 3031\n127 491 3451\n63 24 8917\n436 104 4259\n72 227 1180\n309 359 7145\n185 63 8252\n479 41 9773\n104 401 3267\n267 368 7705\n584 174 3333\n60 163 2654\n351 543 4108\n121 453 2865\n14 483 6716\n583 521 5103\n366 398 4112\n158 575 204\n469 81 5504\n47 558 4602\n139 246 7895\n361 295 5886\n136 318 6358\n425 83 25\n197 343 2623\n246 229 7343\n388 582 6790\n33 412 9298\n429 48 2715\n457 66 4248\n162 458 8644\n499 575 9896\n1 40 8104\n334 320 7650\n52 426 3081\n562 86 2139\n16 412 6841\n324 4 3499\n15 3 8657\n101 196 1949\n204 310 4588\n187 103 7793\n407 84 358\n282 464 1897\n263 137 8534\n356 118 2531\n286 20 694\n42 211 4255\n572 323 6012\n582 44 9955\n507 470 7135\n382 551 2922\n213 385 9620\n299 10 2269\n155 278 5463\n346 377 1536\n347 37 676\n277 168 2449\n598 297 5914\n405 562 2125\n301 118 7833\n246 50 5045\n184 536 1162\n310 413 5383\n307 425 1781\n102 575 7884\n486 346 5631\n128 491 1901\n510 437 620\n310 344 2551\n171 579 6154\n90 68 1388\n203 227 1002\n395 9 1607\n404 570 8504\n297 460 8006\n599 223 6932\n86 378 3607\n268 600 2730\n442 197 5874\n118 66 453\n539 463 3305\n122 510 6521\n263 213 690\n222 150 1715\n203 470 6194\n371 560 2480\n108 500 2432\n578 416 6935\n534 508 5284\n511 511 3310\n556 225 160\n349 326 5273\n37 538 2431\n264 160 6210\n597 302 7708\n68 87 8463\n41 68 3688\n134 42 4923\n16 460 5417\n165 153 7549\n381 518 6263\n543 515 551\n588 93 8487\n79 437 3377\n297 549 9808\n428 494 6367\n240 21 4\n187 310 8305\n584 261 5451\n68 506 4293\n311 418 6295\n393 64 2684\n131 245 4704\n343 57 589\n493 428 2309\n504 84 2481\n362 422 577\n478 396 7519\n49 104 7716\n156 21 532\n136 332 1726\n563 355 3195\n393 503 1819\n62 479 5536\n128 304 2083\n397 301 1992\n532 194 626\n402 456 6088\n196 467 5842\n78 46 656\n498 262 437\n533 583 9369\n222 236 1532\n515 537 6884\n520 313 1859\n150 437 9274\n433 87 1717\n426 65 1626\n426 160 504\n458 442 6833\n31 509 5317\n259 81 5776\n73 125 5887\n31 354 5700\n183 11 3777\n375 73 9775\n147 213 53\n210 127 118\n301 378 404\n239 146 3064\n465 116 7811\n353 265 2133\n29 214 5935\n344 485 4795\n304 567 5358\n189 83 1681\n547 595 5043\n161 386 2408\n129 229 5176\n521 249 3878\n189 299 6103\n430 48 2167\n22 404 1277\n75 136 6886\n307 564 6829\n146 433 4883\n364 87 4065\n456 379 8671\n60 386 6695\n9 428 5254\n452 209 6089\n301 483 1492\n190 112 4538\n115 572 9922\n158 457 6534\n190 432 7074\n179 254 7430\n349 536 2336\n364 474 1418\n495 209 4829\n2 460 7570\n8 224 4892\n118 309 8933\n160 435 7724\n95 510 3808\n557 416 4589\n23 124 4425\n42 1 4204\n408 539 9530\n406 456 1672\n259 363 4644\n201 88 581\n73 269 5008\n547 349 1937\n543 256 2680\n70 425 4747\n290 533 2203\n588 536 3446\n545 108 6731\n557 414 4565\n300 453 6092\n582 142 2574\n127 124 6250\n411 480 2287\n574 307 5801\n485 426 3572\n489 501 8218\n326 505 987\n455 308 2340\n508 54 3535\n27 364 7726\n401 11 8632\n69 84 6474\n7 370 675\n119 4 4430\n300 233 2305\n587 295 3133\n108 445 7552\n339 394 2757\n339 432 7132\n152 459 2417\n537 324 2118\n214 192 7277\n358 399 7001\n504 399 3608\n201 450 3347\n51 398 546\n240 87 3060\n373 59 2841\n239 305 1420\n525 292 5785\n422 470 884\n529 561 7056\n595 466 8032\n261 488 3530\n346 273 692\n45 54 2669\n359 4 4749\n8 144 1044\n439 228 9972\n407 572 3621\n465 198 5563\n105 88 5227\n331 549 7467\n333 262 473\n535 46 3116\n378 83 3434\n538 355 3077\n207 258 4937\n320 530 6303\n261 494 5636\n246 46 5011\n566 75 151\n472 508 7180\n49 423 8087\n472 451 1936\n88 84 3951\n102 158 6784\n219 452 1264\n438 573 6464\n41 185 4092\n502 226 2099\n286 361 5237\n446 110 9127\n293 555 3297\n304 453 8422\n474 550 4277\n280 238 272\n122 102 2828\n425 255 3573\n292 7 8775\n528 439 816\n125 394 4465\n122 579 5881\n236 560 4624\n227 246 1062\n531 315 5363\n240 383 7869\n294 597 2808\n141 16 9063\n517 336 6013\n600 26 2128\n406 159 2897\n523 79 2222\n212 509 9331\n219 241 2165\n240 394 5792\n136 511 1770\n27 540 9767\n368 501 7465\n317 13 3606\n569 167 8106\n493 560 5144\n81 266 2252\n412 196 5185\n299 394 970\n214 40 5164\n256 352 7229\n232 267 5639\n167 313 279\n365 588 8840\n60 155 5791\n23 503 1005\n",
              output: "-1\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_union-find-components",
      title: "Network Connectivity",
      type: "full_source" as const,
      tags: ["medium", "Union Find", "Graph"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "機房裡有 $N$ 台電腦，編號 $1$ 到 $N$。一開始所有電腦之間沒有任何連線。接下來依時間順序發生 $Q$ 個事件，每個事件是下列兩種之一：\n\n- `C u v`：在電腦 $u$ 與電腦 $v$ 之間架設一條直接連線。連線一旦建立就不會拆除；同一對電腦可能被重複架設多次。\n- `Q u v`：詢問此刻電腦 $u$ 與電腦 $v$ 是否連通——也就是能否沿著已建立的連線（直接或間接經過其他電腦）互相傳送資料。每台電腦視為與自己連通。\n\n請依序處理所有事件，並回答每一個詢問。",
        inputFormat:
          "第一行包含兩個整數 $N$ 與 $Q$（$1 \\le N \\le 10^5$，$1 \\le Q \\le 2 \\times 10^5$）。\n\n接下來 $Q$ 行，每行為 `C u v` 或 `Q u v`（$1 \\le u, v \\le N$，$u$ 可能等於 $v$），依時間順序描述事件。",
        outputFormat:
          "對每個 `Q u v` 事件輸出一行：若電腦 $u$ 與 $v$ 此刻連通，輸出 `YES`，否則輸出 `NO`。若輸入中沒有任何詢問，則不輸出任何內容。",
      },
      samples: [
        {
          input: "5 7\nQ 1 2\nC 1 2\nQ 1 2\nC 3 4\nQ 2 5\nC 2 3\nQ 1 4\n",
          output: "NO\nYES\nNO\nYES\n",
        },
        { input: "3 3\nQ 2 2\nC 1 3\nQ 3 1\n", output: "YES\nYES\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例",
          cases: [
            {
              input: "5 7\nQ 1 2\nC 1 2\nQ 1 2\nC 3 4\nQ 2 5\nC 2 3\nQ 1 4\n",
              output: "NO\nYES\nNO\nYES\n",
            },
            { input: "3 3\nQ 2 2\nC 1 3\nQ 3 1\n", output: "YES\nYES\n" },
          ],
        },
        hidden: {
          description: "小規模與邊界測資：自我詢問、無詢問、間接連通、重複連線",
          weight: 40,
          cases: [
            { input: "1 2\nQ 1 1\nC 1 1\n", output: "YES\n" },
            { input: "4 3\nC 1 2\nC 2 3\nC 3 4\n", output: "" },
            { input: "3 5\nC 1 2\nC 2 3\nQ 1 3\nQ 3 3\nQ 1 1\n", output: "YES\nYES\nYES\n" },
            {
              input: "4 6\nC 1 2\nC 1 2\nQ 1 2\nQ 2 4\nC 2 4\nQ 1 4\n",
              output: "YES\nNO\nYES\n",
            },
            {
              input:
                "5 12\nQ 5 1\nQ 2 1\nC 1 3\nQ 2 4\nC 5 2\nC 2 4\nQ 2 4\nC 1 2\nQ 2 2\nC 1 2\nC 2 2\nQ 3 2\n",
              output: "NO\nNO\nNO\nYES\nYES\nYES\n",
            },
            {
              input:
                "7 13\nQ 3 3\nC 7 6\nQ 1 1\nC 4 7\nQ 3 7\nQ 6 7\nQ 2 5\nC 2 7\nC 2 6\nC 3 5\nC 6 6\nC 3 4\nC 5 7\n",
              output: "YES\nYES\nNO\nYES\nNO\n",
            },
          ],
        },
        hidden2: {
          description: "較大規模測資：長鏈合併與隨機中型操作序列",
          weight: 60,
          cases: [
            {
              input:
                "500 504\nC 1 2\nC 2 3\nC 3 4\nC 4 5\nC 5 6\nC 6 7\nC 7 8\nC 8 9\nC 9 10\nC 10 11\nC 11 12\nC 12 13\nC 13 14\nC 14 15\nC 15 16\nC 16 17\nC 17 18\nC 18 19\nC 19 20\nC 20 21\nC 21 22\nC 22 23\nC 23 24\nC 24 25\nC 25 26\nC 26 27\nC 27 28\nC 28 29\nC 29 30\nC 30 31\nC 31 32\nC 32 33\nC 33 34\nC 34 35\nC 35 36\nC 36 37\nC 37 38\nC 38 39\nC 39 40\nC 40 41\nC 41 42\nC 42 43\nC 43 44\nC 44 45\nC 45 46\nC 46 47\nC 47 48\nC 48 49\nC 49 50\nC 50 51\nC 51 52\nC 52 53\nC 53 54\nC 54 55\nC 55 56\nC 56 57\nC 57 58\nC 58 59\nC 59 60\nC 60 61\nC 61 62\nC 62 63\nC 63 64\nC 64 65\nC 65 66\nC 66 67\nC 67 68\nC 68 69\nC 69 70\nC 70 71\nC 71 72\nC 72 73\nC 73 74\nC 74 75\nC 75 76\nC 76 77\nC 77 78\nC 78 79\nC 79 80\nC 80 81\nC 81 82\nC 82 83\nC 83 84\nC 84 85\nC 85 86\nC 86 87\nC 87 88\nC 88 89\nC 89 90\nC 90 91\nC 91 92\nC 92 93\nC 93 94\nC 94 95\nC 95 96\nC 96 97\nC 97 98\nC 98 99\nC 99 100\nC 100 101\nC 101 102\nC 102 103\nC 103 104\nC 104 105\nC 105 106\nC 106 107\nC 107 108\nC 108 109\nC 109 110\nC 110 111\nC 111 112\nC 112 113\nC 113 114\nC 114 115\nC 115 116\nC 116 117\nC 117 118\nC 118 119\nC 119 120\nC 120 121\nC 121 122\nC 122 123\nC 123 124\nC 124 125\nC 125 126\nC 126 127\nC 127 128\nC 128 129\nC 129 130\nC 130 131\nC 131 132\nC 132 133\nC 133 134\nC 134 135\nC 135 136\nC 136 137\nC 137 138\nC 138 139\nC 139 140\nC 140 141\nC 141 142\nC 142 143\nC 143 144\nC 144 145\nC 145 146\nC 146 147\nC 147 148\nC 148 149\nC 149 150\nC 150 151\nC 151 152\nC 152 153\nC 153 154\nC 154 155\nC 155 156\nC 156 157\nC 157 158\nC 158 159\nC 159 160\nC 160 161\nC 161 162\nC 162 163\nC 163 164\nC 164 165\nC 165 166\nC 166 167\nC 167 168\nC 168 169\nC 169 170\nC 170 171\nC 171 172\nC 172 173\nC 173 174\nC 174 175\nC 175 176\nC 176 177\nC 177 178\nC 178 179\nC 179 180\nC 180 181\nC 181 182\nC 182 183\nC 183 184\nC 184 185\nC 185 186\nC 186 187\nC 187 188\nC 188 189\nC 189 190\nC 190 191\nC 191 192\nC 192 193\nC 193 194\nC 194 195\nC 195 196\nC 196 197\nC 197 198\nC 198 199\nC 199 200\nC 200 201\nC 201 202\nC 202 203\nC 203 204\nC 204 205\nC 205 206\nC 206 207\nC 207 208\nC 208 209\nC 209 210\nC 210 211\nC 211 212\nC 212 213\nC 213 214\nC 214 215\nC 215 216\nC 216 217\nC 217 218\nC 218 219\nC 219 220\nC 220 221\nC 221 222\nC 222 223\nC 223 224\nC 224 225\nC 225 226\nC 226 227\nC 227 228\nC 228 229\nC 229 230\nC 230 231\nC 231 232\nC 232 233\nC 233 234\nC 234 235\nC 235 236\nC 236 237\nC 237 238\nC 238 239\nC 239 240\nC 240 241\nC 241 242\nC 242 243\nC 243 244\nC 244 245\nC 245 246\nC 246 247\nC 247 248\nC 248 249\nC 249 250\nQ 1 250\nQ 1 251\nC 250 251\nC 251 252\nC 252 253\nC 253 254\nC 254 255\nC 255 256\nC 256 257\nC 257 258\nC 258 259\nC 259 260\nC 260 261\nC 261 262\nC 262 263\nC 263 264\nC 264 265\nC 265 266\nC 266 267\nC 267 268\nC 268 269\nC 269 270\nC 270 271\nC 271 272\nC 272 273\nC 273 274\nC 274 275\nC 275 276\nC 276 277\nC 277 278\nC 278 279\nC 279 280\nC 280 281\nC 281 282\nC 282 283\nC 283 284\nC 284 285\nC 285 286\nC 286 287\nC 287 288\nC 288 289\nC 289 290\nC 290 291\nC 291 292\nC 292 293\nC 293 294\nC 294 295\nC 295 296\nC 296 297\nC 297 298\nC 298 299\nC 299 300\nC 300 301\nC 301 302\nC 302 303\nC 303 304\nC 304 305\nC 305 306\nC 306 307\nC 307 308\nC 308 309\nC 309 310\nC 310 311\nC 311 312\nC 312 313\nC 313 314\nC 314 315\nC 315 316\nC 316 317\nC 317 318\nC 318 319\nC 319 320\nC 320 321\nC 321 322\nC 322 323\nC 323 324\nC 324 325\nC 325 326\nC 326 327\nC 327 328\nC 328 329\nC 329 330\nC 330 331\nC 331 332\nC 332 333\nC 333 334\nC 334 335\nC 335 336\nC 336 337\nC 337 338\nC 338 339\nC 339 340\nC 340 341\nC 341 342\nC 342 343\nC 343 344\nC 344 345\nC 345 346\nC 346 347\nC 347 348\nC 348 349\nC 349 350\nC 350 351\nC 351 352\nC 352 353\nC 353 354\nC 354 355\nC 355 356\nC 356 357\nC 357 358\nC 358 359\nC 359 360\nC 360 361\nC 361 362\nC 362 363\nC 363 364\nC 364 365\nC 365 366\nC 366 367\nC 367 368\nC 368 369\nC 369 370\nC 370 371\nC 371 372\nC 372 373\nC 373 374\nC 374 375\nC 375 376\nC 376 377\nC 377 378\nC 378 379\nC 379 380\nC 380 381\nC 381 382\nC 382 383\nC 383 384\nC 384 385\nC 385 386\nC 386 387\nC 387 388\nC 388 389\nC 389 390\nC 390 391\nC 391 392\nC 392 393\nC 393 394\nC 394 395\nC 395 396\nC 396 397\nC 397 398\nC 398 399\nC 399 400\nC 400 401\nC 401 402\nC 402 403\nC 403 404\nC 404 405\nC 405 406\nC 406 407\nC 407 408\nC 408 409\nC 409 410\nC 410 411\nC 411 412\nC 412 413\nC 413 414\nC 414 415\nC 415 416\nC 416 417\nC 417 418\nC 418 419\nC 419 420\nC 420 421\nC 421 422\nC 422 423\nC 423 424\nC 424 425\nC 425 426\nC 426 427\nC 427 428\nC 428 429\nC 429 430\nC 430 431\nC 431 432\nC 432 433\nC 433 434\nC 434 435\nC 435 436\nC 436 437\nC 437 438\nC 438 439\nC 439 440\nC 440 441\nC 441 442\nC 442 443\nC 443 444\nC 444 445\nC 445 446\nC 446 447\nC 447 448\nC 448 449\nC 449 450\nC 450 451\nC 451 452\nC 452 453\nC 453 454\nC 454 455\nC 455 456\nC 456 457\nC 457 458\nC 458 459\nC 459 460\nC 460 461\nC 461 462\nC 462 463\nC 463 464\nC 464 465\nC 465 466\nC 466 467\nC 467 468\nC 468 469\nC 469 470\nC 470 471\nC 471 472\nC 472 473\nC 473 474\nC 474 475\nC 475 476\nC 476 477\nC 477 478\nC 478 479\nC 479 480\nC 480 481\nC 481 482\nC 482 483\nC 483 484\nC 484 485\nC 485 486\nC 486 487\nC 487 488\nC 488 489\nC 489 490\nC 490 491\nC 491 492\nC 492 493\nC 493 494\nC 494 495\nC 495 496\nC 496 497\nC 497 498\nC 498 499\nC 499 500\nQ 1 500\nQ 500 2\nQ 250 251\n",
              output: "YES\nNO\nYES\nYES\nYES\n",
            },
            {
              input:
                "800 600\nC 553 368\nQ 50 680\nC 617 228\nQ 498 710\nC 337 449\nC 262 198\nC 91 456\nQ 197 484\nQ 245 653\nQ 433 214\nC 441 479\nQ 217 114\nQ 681 274\nQ 389 235\nQ 79 415\nQ 7 476\nC 548 97\nQ 23 380\nQ 10 269\nC 36 443\nC 285 68\nC 415 702\nQ 669 583\nQ 171 511\nQ 186 708\nC 87 68\nC 590 355\nQ 122 693\nQ 653 144\nC 206 756\nQ 143 84\nC 320 346\nQ 70 62\nQ 475 59\nC 286 696\nQ 93 287\nC 257 478\nC 436 115\nQ 251 98\nQ 669 181\nC 15 649\nQ 628 470\nC 345 245\nQ 483 677\nC 566 608\nQ 343 19\nC 296 354\nQ 413 411\nC 763 226\nC 222 152\nC 150 351\nC 379 25\nQ 682 208\nQ 526 679\nC 131 470\nQ 308 693\nQ 753 262\nC 446 209\nQ 305 770\nC 252 51\nQ 758 450\nQ 683 53\nQ 567 728\nC 35 792\nQ 634 60\nC 422 463\nQ 789 632\nC 500 766\nC 37 709\nQ 619 654\nC 708 89\nQ 348 533\nC 151 481\nQ 112 272\nC 245 366\nC 660 545\nC 238 752\nC 667 162\nC 748 602\nC 460 141\nC 194 529\nC 108 607\nC 341 521\nC 591 676\nQ 132 113\nC 42 460\nC 282 413\nC 717 62\nC 296 701\nC 99 305\nQ 241 170\nQ 672 572\nQ 156 726\nQ 714 34\nC 313 399\nC 481 250\nC 418 155\nC 508 450\nQ 199 281\nC 775 196\nQ 797 40\nC 320 539\nQ 35 775\nQ 132 261\nQ 794 470\nQ 57 465\nQ 94 181\nC 381 494\nC 394 45\nQ 59 238\nC 390 129\nQ 401 107\nC 431 705\nQ 277 378\nC 701 611\nQ 407 142\nC 529 680\nQ 305 237\nQ 539 48\nC 544 110\nC 771 714\nQ 293 468\nQ 639 296\nC 374 492\nC 792 140\nQ 761 66\nQ 104 637\nQ 100 555\nC 694 465\nQ 355 392\nC 781 79\nC 774 732\nQ 758 429\nC 712 56\nQ 759 599\nC 14 175\nQ 734 163\nC 576 740\nQ 542 581\nC 566 577\nC 198 144\nC 573 193\nQ 123 621\nC 494 512\nQ 189 144\nC 163 512\nQ 493 61\nC 368 77\nQ 184 685\nC 8 330\nC 159 274\nC 649 164\nQ 252 654\nC 329 151\nQ 359 713\nQ 327 232\nQ 302 293\nQ 162 677\nC 731 12\nQ 111 541\nQ 799 185\nQ 217 457\nQ 592 215\nC 108 83\nQ 698 406\nC 311 180\nC 514 611\nQ 63 727\nQ 630 84\nC 210 570\nQ 1 177\nC 396 374\nC 657 714\nQ 717 155\nC 372 177\nC 508 477\nC 317 452\nQ 71 431\nQ 364 719\nC 713 654\nQ 500 41\nC 375 356\nQ 71 60\nC 480 387\nQ 229 282\nC 179 550\nC 139 529\nQ 275 596\nC 728 148\nQ 709 632\nC 188 626\nQ 686 321\nQ 383 583\nQ 765 150\nQ 688 521\nC 445 63\nC 316 380\nC 241 780\nQ 175 77\nQ 84 316\nQ 156 355\nC 751 227\nC 720 35\nC 295 648\nQ 85 472\nQ 777 101\nQ 392 397\nQ 745 426\nC 590 111\nQ 315 561\nQ 791 744\nC 429 204\nC 21 231\nQ 164 113\nC 534 165\nQ 194 768\nQ 475 78\nC 291 344\nC 89 770\nC 704 657\nQ 42 740\nC 358 622\nC 416 34\nC 432 679\nC 560 210\nC 199 496\nC 748 400\nC 434 181\nQ 539 628\nQ 513 81\nC 527 30\nQ 153 549\nQ 681 685\nC 693 765\nQ 539 578\nQ 726 126\nC 109 686\nQ 188 205\nC 58 534\nC 133 318\nC 342 244\nQ 85 126\nC 645 219\nC 507 571\nQ 116 716\nQ 786 67\nC 326 301\nC 53 621\nQ 185 281\nC 11 40\nC 729 70\nC 144 643\nQ 292 650\nC 642 789\nC 734 132\nC 509 448\nQ 785 116\nQ 338 779\nC 736 351\nQ 592 621\nC 329 582\nC 187 642\nQ 436 759\nQ 679 38\nC 201 39\nC 457 492\nQ 570 557\nQ 115 471\nQ 364 284\nQ 432 251\nQ 350 212\nQ 19 538\nC 328 238\nC 417 774\nQ 183 664\nQ 258 243\nC 21 719\nQ 224 434\nC 257 183\nQ 10 750\nQ 143 681\nQ 578 701\nQ 549 68\nC 296 733\nC 587 566\nC 186 509\nC 253 18\nQ 272 789\nQ 705 505\nC 232 503\nQ 643 422\nC 201 283\nQ 655 576\nQ 705 181\nQ 500 690\nC 251 376\nQ 521 477\nC 27 282\nQ 491 326\nQ 715 620\nQ 736 184\nQ 136 727\nC 315 155\nQ 765 781\nQ 259 314\nC 557 46\nQ 63 239\nQ 333 633\nC 769 467\nQ 275 329\nQ 384 728\nQ 60 530\nQ 546 581\nQ 700 158\nQ 292 376\nC 596 526\nQ 508 327\nQ 521 772\nQ 81 721\nC 7 74\nC 230 493\nC 333 204\nC 8 761\nC 60 249\nQ 508 259\nQ 449 75\nQ 36 140\nC 506 150\nC 424 491\nQ 708 780\nC 639 544\nC 768 212\nC 119 720\nC 553 315\nC 304 430\nC 180 69\nQ 227 629\nQ 624 647\nC 491 468\nQ 327 799\nQ 563 171\nQ 354 279\nQ 529 267\nC 776 545\nQ 198 428\nC 421 645\nC 458 84\nC 377 769\nQ 343 413\nC 288 28\nQ 233 18\nQ 207 218\nQ 610 759\nC 528 608\nC 298 514\nQ 490 741\nC 674 632\nC 179 133\nC 373 47\nQ 336 371\nC 99 148\nQ 654 598\nC 226 525\nC 424 443\nC 704 656\nC 493 18\nQ 362 768\nQ 534 544\nQ 462 209\nQ 717 458\nC 97 586\nC 458 715\nQ 43 192\nQ 108 457\nQ 283 612\nC 709 750\nC 31 739\nC 762 738\nC 417 680\nQ 746 67\nC 82 723\nC 358 252\nQ 623 772\nC 109 343\nQ 756 426\nC 81 247\nC 773 522\nC 525 736\nC 774 441\nC 554 649\nC 295 296\nQ 755 111\nC 703 107\nQ 398 13\nQ 268 253\nC 201 92\nQ 15 518\nQ 676 574\nC 695 690\nQ 230 653\nQ 673 89\nQ 343 358\nQ 272 610\nQ 707 745\nQ 353 643\nQ 64 449\nC 445 147\nC 3 323\nQ 270 552\nC 358 197\nQ 560 797\nC 324 335\nC 360 683\nQ 679 235\nQ 329 19\nQ 710 318\nQ 696 645\nC 124 328\nQ 556 404\nQ 573 628\nQ 153 476\nC 493 114\nC 544 73\nC 52 373\nQ 255 380\nC 189 159\nC 692 677\nQ 601 194\nQ 209 787\nC 706 46\nQ 342 247\nC 245 252\nQ 634 733\nQ 418 714\nC 55 142\nQ 573 345\nQ 51 480\nC 423 347\nQ 525 609\nQ 524 523\nC 714 343\nC 10 97\nC 451 291\nQ 740 799\nQ 532 355\nQ 770 276\nQ 692 251\nQ 680 241\nQ 491 39\nQ 256 181\nQ 543 442\nC 377 75\nC 444 171\nC 576 270\nQ 704 51\nC 767 277\nC 118 195\nQ 242 75\nC 654 744\nQ 737 571\nC 343 41\nQ 456 517\nQ 729 678\nQ 87 447\nC 501 285\nQ 757 172\nC 741 112\nQ 25 52\nQ 745 192\nC 568 618\nC 214 470\nQ 284 680\nC 250 548\nQ 349 16\nQ 783 528\nC 363 70\nQ 379 330\nC 163 528\nQ 563 609\nQ 345 488\nQ 555 3\nC 717 355\nC 441 634\nQ 148 230\nQ 487 754\nC 340 39\nQ 385 677\nQ 170 297\nC 95 399\nC 380 109\nC 561 159\nQ 111 784\nQ 27 551\nQ 482 133\nC 284 496\nC 508 275\nC 586 268\nC 203 731\nQ 96 566\nC 531 340\nC 277 97\nC 371 297\nC 178 696\nC 393 636\nQ 715 398\nQ 29 386\nC 245 103\nQ 477 339\nC 289 252\nQ 463 441\nQ 401 749\nQ 45 497\nC 763 416\nC 481 351\nC 466 632\nQ 240 262\nQ 282 211\nC 93 2\nQ 325 336\nC 407 772\nQ 417 246\nC 251 321\nC 615 96\nQ 279 331\nC 432 544\nQ 302 233\nQ 21 310\nC 531 372\nC 651 522\nC 708 370\nQ 269 595\nQ 680 657\nC 415 769\nC 76 649\nC 629 599\nC 640 659\nC 500 535\nQ 244 99\nC 435 186\nQ 703 124\nC 583 392\nC 13 707\nQ 354 118\nQ 49 345\nQ 59 426\nC 476 482\nC 517 728\nQ 446 703\nQ 299 123\nQ 358 181\nQ 500 150\nC 459 196\nQ 303 604\nC 329 696\nC 402 598\nC 101 178\nC 313 394\nC 156 426\nC 387 503\nC 448 191\nQ 505 458\nQ 105 416\nQ 603 602\nQ 468 24\nQ 773 756\nQ 459 532\nC 133 182\nC 719 75\nC 640 752\nC 115 763\nQ 435 757\nQ 138 674\nC 270 136\nQ 383 760\nC 417 16\nQ 789 683\nQ 248 397\nQ 183 480\nC 436 414\nQ 75 56\nC 534 508\nC 752 344\nC 588 379\nC 745 359\nQ 71 243\nQ 83 495\nC 231 641\nC 595 384\nQ 503 195\nQ 443 343\nC 765 237\nQ 782 210\nQ 17 254\nQ 105 358\nQ 147 403\nQ 162 146\nQ 82 409\nQ 230 208\nQ 251 35\nC 81 414\n",
              output:
                "NO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\n",
            },
            {
              input:
                "50 600\nQ 42 31\nQ 13 13\nQ 4 28\nQ 29 3\nQ 13 16\nQ 41 40\nC 26 21\nQ 9 28\nQ 48 46\nC 34 16\nQ 29 31\nQ 18 3\nC 41 50\nC 3 25\nQ 1 12\nC 13 8\nQ 9 15\nC 28 16\nQ 42 23\nC 20 19\nQ 30 50\nC 23 50\nC 40 13\nQ 26 34\nQ 23 27\nC 16 36\nQ 23 8\nC 38 21\nC 6 43\nQ 37 21\nC 19 48\nC 17 39\nQ 46 20\nC 36 12\nQ 9 29\nC 1 12\nQ 47 42\nQ 30 48\nC 2 32\nC 13 37\nC 41 1\nC 42 6\nQ 25 1\nQ 13 34\nC 14 27\nQ 3 35\nQ 49 28\nQ 16 42\nC 43 31\nC 5 15\nQ 31 40\nC 6 36\nC 2 3\nQ 4 42\nQ 33 41\nQ 26 37\nQ 24 20\nC 16 13\nC 39 36\nQ 32 25\nC 17 16\nQ 43 32\nC 40 45\nQ 15 24\nQ 40 30\nC 4 38\nC 31 22\nQ 16 48\nC 15 6\nQ 44 17\nC 13 20\nC 11 29\nC 45 3\nQ 19 22\nC 9 10\nQ 1 2\nC 20 50\nQ 21 9\nC 25 4\nQ 24 44\nC 19 17\nQ 21 12\nC 17 49\nC 27 43\nQ 29 41\nC 19 13\nC 41 34\nQ 46 14\nC 35 2\nQ 22 48\nC 5 34\nC 22 20\nC 24 40\nQ 11 29\nQ 24 28\nQ 38 18\nC 5 48\nC 24 15\nC 43 45\nC 45 3\nC 27 38\nQ 32 16\nC 5 6\nQ 5 4\nQ 25 22\nQ 14 17\nC 47 24\nC 4 13\nQ 35 28\nC 33 22\nC 13 24\nQ 2 33\nC 1 8\nC 40 16\nQ 32 36\nQ 43 24\nQ 44 32\nQ 9 2\nQ 24 37\nC 23 32\nC 29 4\nQ 31 31\nC 41 16\nC 25 50\nQ 9 34\nQ 3 39\nC 18 27\nC 23 12\nC 15 34\nC 5 23\nC 5 5\nQ 42 25\nQ 27 33\nC 38 5\nQ 42 20\nC 2 36\nQ 16 25\nC 6 50\nC 1 33\nQ 27 11\nC 22 26\nC 38 23\nQ 11 24\nC 9 17\nC 14 38\nQ 42 46\nQ 13 7\nQ 44 9\nC 29 36\nQ 29 3\nQ 36 19\nC 50 43\nC 23 44\nC 2 3\nQ 40 10\nQ 31 20\nQ 39 31\nQ 40 35\nC 33 31\nC 28 8\nC 18 11\nQ 25 30\nQ 21 38\nQ 12 49\nQ 2 22\nC 28 47\nC 41 37\nC 19 38\nQ 15 4\nC 50 49\nC 23 26\nC 49 44\nQ 7 11\nC 37 20\nC 33 39\nC 46 40\nQ 28 9\nQ 32 26\nC 48 4\nQ 31 43\nQ 2 33\nQ 25 20\nC 48 26\nC 43 7\nQ 39 37\nC 2 32\nQ 12 29\nC 42 32\nC 27 3\nC 30 20\nQ 42 21\nC 18 39\nC 17 14\nC 24 11\nQ 27 12\nC 40 11\nQ 5 27\nQ 50 15\nQ 7 8\nQ 48 22\nQ 12 33\nC 11 43\nQ 39 37\nC 39 49\nQ 50 3\nQ 33 11\nC 13 36\nQ 2 20\nQ 5 47\nQ 35 32\nC 4 49\nQ 49 35\nQ 40 38\nC 39 30\nQ 22 4\nQ 50 50\nQ 43 14\nQ 21 49\nC 47 33\nC 3 8\nC 41 43\nC 40 1\nQ 18 13\nQ 16 28\nC 47 7\nC 50 47\nC 41 15\nQ 47 13\nQ 12 2\nQ 8 13\nC 25 38\nC 15 17\nC 45 4\nC 24 36\nC 33 26\nQ 25 10\nC 31 36\nQ 4 32\nQ 24 5\nC 9 4\nQ 28 48\nC 20 39\nC 32 26\nC 31 49\nC 7 50\nC 44 2\nC 7 28\nQ 19 31\nQ 18 42\nQ 27 30\nC 28 38\nQ 47 23\nQ 27 29\nC 22 8\nQ 12 38\nQ 8 8\nQ 22 42\nC 37 49\nQ 5 29\nQ 3 20\nC 39 44\nQ 35 39\nC 1 44\nC 36 13\nC 15 19\nC 37 27\nQ 29 35\nC 36 12\nQ 43 20\nC 23 21\nC 21 12\nQ 10 30\nQ 9 43\nQ 42 8\nC 46 2\nQ 37 29\nQ 41 15\nQ 44 47\nQ 19 39\nQ 24 9\nQ 47 50\nC 46 20\nC 15 35\nC 49 20\nQ 37 8\nC 3 44\nQ 37 25\nQ 27 16\nC 25 46\nC 28 36\nQ 34 26\nQ 32 46\nC 7 41\nC 40 22\nQ 23 26\nC 37 38\nC 32 45\nC 36 40\nQ 18 2\nQ 9 36\nQ 1 27\nQ 9 15\nQ 23 23\nC 48 23\nC 9 21\nQ 43 25\nC 32 34\nQ 16 10\nQ 32 5\nC 24 44\nQ 28 30\nC 35 15\nQ 7 38\nC 24 24\nC 13 21\nC 24 36\nC 38 27\nQ 36 35\nQ 15 12\nQ 17 16\nQ 13 46\nQ 37 18\nQ 10 2\nC 12 12\nQ 7 27\nQ 34 19\nQ 45 10\nC 24 45\nC 6 33\nC 29 1\nC 28 7\nQ 11 30\nQ 16 17\nC 10 28\nQ 13 40\nQ 18 48\nQ 12 43\nQ 20 43\nC 17 44\nC 12 26\nQ 5 29\nQ 25 1\nC 43 8\nC 4 3\nQ 21 25\nQ 36 43\nQ 33 42\nC 40 19\nC 38 15\nQ 15 5\nQ 29 20\nQ 12 41\nQ 12 3\nQ 3 18\nQ 24 24\nQ 36 17\nC 19 41\nQ 40 3\nQ 30 24\nC 43 47\nQ 30 8\nC 21 26\nQ 12 18\nQ 1 26\nC 49 12\nC 29 35\nC 26 38\nC 32 17\nC 12 34\nQ 38 33\nC 41 20\nC 6 46\nQ 27 30\nC 45 23\nC 32 1\nC 17 24\nQ 34 25\nC 45 42\nC 19 21\nQ 46 20\nQ 13 18\nC 47 1\nC 4 1\nQ 7 4\nC 1 34\nQ 28 17\nC 10 3\nC 31 28\nC 22 18\nC 2 7\nC 29 6\nC 35 44\nC 37 21\nC 38 30\nC 17 42\nC 30 26\nQ 43 1\nQ 17 8\nC 24 9\nC 29 26\nC 34 6\nC 5 15\nC 5 26\nC 31 48\nC 41 49\nC 19 29\nC 23 49\nC 41 25\nC 31 32\nQ 39 27\nC 43 3\nQ 1 6\nC 15 13\nQ 50 2\nC 31 27\nC 21 14\nQ 22 23\nC 9 22\nQ 24 28\nQ 37 29\nQ 35 2\nC 15 33\nQ 35 47\nC 9 30\nQ 46 47\nC 7 47\nQ 23 1\nC 10 30\nQ 40 5\nQ 1 32\nQ 5 46\nC 17 10\nC 21 11\nQ 9 46\nC 14 30\nC 34 25\nQ 50 21\nQ 11 8\nQ 41 14\nQ 45 11\nQ 27 13\nQ 32 33\nQ 44 40\nC 39 19\nC 15 15\nQ 41 28\nC 17 32\nC 45 43\nC 35 22\nQ 18 15\nC 15 22\nC 18 1\nC 6 17\nQ 26 24\nC 13 30\nQ 45 17\nQ 18 28\nQ 11 24\nC 41 43\nQ 2 29\nC 1 20\nQ 47 41\nQ 36 41\nC 12 2\nQ 34 39\nC 5 1\nQ 37 27\nQ 15 41\nQ 46 34\nC 8 49\nQ 10 40\nC 3 48\nC 31 20\nQ 45 12\nQ 23 19\nQ 24 38\nC 23 13\nC 22 49\nQ 13 16\nQ 44 18\nQ 12 41\nC 12 5\nQ 24 29\nC 17 10\nC 16 11\nQ 29 33\nC 3 43\nC 10 17\nC 12 28\nC 48 10\nQ 35 33\nC 24 34\nQ 8 29\nC 21 15\nQ 23 49\nQ 24 37\nQ 21 24\nC 26 22\nQ 20 28\nQ 26 13\nQ 15 17\nC 34 48\nC 8 2\nC 39 27\nC 20 36\nQ 48 34\nC 26 7\nC 35 31\nQ 35 42\nC 15 17\nQ 36 45\nQ 28 11\nQ 11 21\nC 41 24\nC 40 16\nQ 27 41\nQ 19 2\nQ 31 12\nC 10 47\nC 15 42\nQ 11 20\nC 26 21\nQ 16 23\nC 26 42\nC 35 1\nQ 2 21\nQ 18 7\nQ 17 37\nQ 23 2\nC 42 6\nC 50 18\nC 47 46\nC 11 22\nQ 30 35\nC 1 35\nC 31 21\nQ 7 35\nQ 27 3\nQ 15 12\nC 24 2\nC 39 5\nQ 17 2\nC 30 6\nC 2 48\nC 44 38\nC 29 29\nQ 23 1\nC 2 43\nQ 23 9\nQ 45 50\nC 1 24\nC 12 11\nC 21 21\nC 22 18\nQ 13 8\nC 21 4\nC 42 27\nC 13 50\nQ 22 31\nQ 11 45\nQ 26 12\nQ 18 30\nC 40 43\nQ 39 37\nQ 8 41\nQ 25 19\nQ 45 40\nC 44 7\nQ 28 35\nQ 11 14\nQ 24 44\nQ 18 6\nQ 12 6\nQ 17 17\nQ 19 33\nQ 38 45\nQ 37 11\nQ 31 27\nQ 37 21\nC 9 27\nC 45 30\nC 48 42\nC 21 20\nC 38 18\nQ 5 5\nQ 15 26\nQ 4 43\nC 11 15\nQ 26 14\nQ 32 6\nQ 47 46\nC 39 41\nQ 22 32\nQ 15 23\nQ 28 13\nC 50 44\nQ 32 25\nC 42 19\nC 50 43\nC 10 9\n",
              output:
                "NO\nYES\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nNO\nYES\nNO\nNO\nNO\nNO\nNO\nYES\nYES\nNO\nNO\nYES\nNO\nNO\nYES\nYES\nYES\nNO\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nNO\nNO\nYES\nYES\nNO\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nNO\nNO\nNO\nYES\nYES\nYES\nYES\nYES\nYES\nNO\nYES\nYES\nYES\nYES\nNO\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\nYES\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_kruskal-mst",
      title: "Minimum Spanning Cost",
      type: "full_source" as const,
      tags: ["medium", "Graph", "Union Find", "Greedy"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "電信公司要在 $N$ 個村莊之間鋪設光纖。工程隊評估出 $M$ 條可行的鋪設路線，第 $i$ 條路線連接村莊 $u_i$ 與 $v_i$，造價為 $w_i$。清單中同一對村莊之間可能有多條路線，也可能出現兩端是同一個村莊的路線（自環，鋪設後沒有任何作用）。\n\n公司要從清單中挑選若干條路線鋪設，使得任兩個村莊都能透過光纖（直接或間接）互相通訊，且總造價最小。請輸出這個最小總造價；若無論怎麼挑選都無法讓所有村莊連通，輸出 `IMPOSSIBLE`。",
        inputFormat:
          "第一行包含兩個整數 $N$ 與 $M$（$1 \\le N \\le 10^5$，$0 \\le M \\le 2 \\times 10^5$）。\n\n接下來 $M$ 行，每行三個整數 $u_i$、$v_i$、$w_i$（$1 \\le u_i, v_i \\le N$，$1 \\le w_i \\le 10^9$），表示一條連接村莊 $u_i$ 與 $v_i$、造價為 $w_i$ 的可選路線。",
        outputFormat:
          "輸出一行：若能使所有村莊連通，輸出最小總造價（注意答案可能超過 32 位元整數範圍）；否則輸出 `IMPOSSIBLE`。",
      },
      samples: [
        { input: "4 5\n1 2 3\n2 3 1\n3 4 4\n1 3 2\n2 2 7\n", output: "7\n" },
        { input: "3 1\n1 2 8\n", output: "IMPOSSIBLE\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例",
          cases: [
            { input: "4 5\n1 2 3\n2 3 1\n3 4 4\n1 3 2\n2 2 7\n", output: "7\n" },
            { input: "3 1\n1 2 8\n", output: "IMPOSSIBLE\n" },
          ],
        },
        hidden: {
          description: "小規模與邊界測資：單點、自環、重邊、不連通",
          weight: 40,
          cases: [
            { input: "1 0\n", output: "0\n" },
            { input: "1 2\n1 1 5\n1 1 7\n", output: "0\n" },
            { input: "3 3\n1 2 1\n1 2 2\n2 3 5\n", output: "6\n" },
            { input: "3 3\n1 2 3\n2 3 4\n2 2 1\n", output: "7\n" },
            { input: "4 3\n1 2 1\n1 2 2\n2 1 3\n", output: "IMPOSSIBLE\n" },
            { input: "3 2\n2 3 2\n1 3 4\n", output: "6\n" },
            {
              input: "1 7\n1 1 5\n1 1 4\n1 1 5\n1 1 5\n1 1 17\n1 1 19\n1 1 1\n",
              output: "0\n",
            },
          ],
        },
        hidden2: {
          description: "較大規模測資：大權重長鏈與隨機中型圖",
          weight: 60,
          cases: [
            {
              input:
                "300 299\n1 2 1000000000\n2 3 1000000000\n3 4 1000000000\n4 5 1000000000\n5 6 1000000000\n6 7 1000000000\n7 8 1000000000\n8 9 1000000000\n9 10 1000000000\n10 11 1000000000\n11 12 1000000000\n12 13 1000000000\n13 14 1000000000\n14 15 1000000000\n15 16 1000000000\n16 17 1000000000\n17 18 1000000000\n18 19 1000000000\n19 20 1000000000\n20 21 1000000000\n21 22 1000000000\n22 23 1000000000\n23 24 1000000000\n24 25 1000000000\n25 26 1000000000\n26 27 1000000000\n27 28 1000000000\n28 29 1000000000\n29 30 1000000000\n30 31 1000000000\n31 32 1000000000\n32 33 1000000000\n33 34 1000000000\n34 35 1000000000\n35 36 1000000000\n36 37 1000000000\n37 38 1000000000\n38 39 1000000000\n39 40 1000000000\n40 41 1000000000\n41 42 1000000000\n42 43 1000000000\n43 44 1000000000\n44 45 1000000000\n45 46 1000000000\n46 47 1000000000\n47 48 1000000000\n48 49 1000000000\n49 50 1000000000\n50 51 1000000000\n51 52 1000000000\n52 53 1000000000\n53 54 1000000000\n54 55 1000000000\n55 56 1000000000\n56 57 1000000000\n57 58 1000000000\n58 59 1000000000\n59 60 1000000000\n60 61 1000000000\n61 62 1000000000\n62 63 1000000000\n63 64 1000000000\n64 65 1000000000\n65 66 1000000000\n66 67 1000000000\n67 68 1000000000\n68 69 1000000000\n69 70 1000000000\n70 71 1000000000\n71 72 1000000000\n72 73 1000000000\n73 74 1000000000\n74 75 1000000000\n75 76 1000000000\n76 77 1000000000\n77 78 1000000000\n78 79 1000000000\n79 80 1000000000\n80 81 1000000000\n81 82 1000000000\n82 83 1000000000\n83 84 1000000000\n84 85 1000000000\n85 86 1000000000\n86 87 1000000000\n87 88 1000000000\n88 89 1000000000\n89 90 1000000000\n90 91 1000000000\n91 92 1000000000\n92 93 1000000000\n93 94 1000000000\n94 95 1000000000\n95 96 1000000000\n96 97 1000000000\n97 98 1000000000\n98 99 1000000000\n99 100 1000000000\n100 101 1000000000\n101 102 1000000000\n102 103 1000000000\n103 104 1000000000\n104 105 1000000000\n105 106 1000000000\n106 107 1000000000\n107 108 1000000000\n108 109 1000000000\n109 110 1000000000\n110 111 1000000000\n111 112 1000000000\n112 113 1000000000\n113 114 1000000000\n114 115 1000000000\n115 116 1000000000\n116 117 1000000000\n117 118 1000000000\n118 119 1000000000\n119 120 1000000000\n120 121 1000000000\n121 122 1000000000\n122 123 1000000000\n123 124 1000000000\n124 125 1000000000\n125 126 1000000000\n126 127 1000000000\n127 128 1000000000\n128 129 1000000000\n129 130 1000000000\n130 131 1000000000\n131 132 1000000000\n132 133 1000000000\n133 134 1000000000\n134 135 1000000000\n135 136 1000000000\n136 137 1000000000\n137 138 1000000000\n138 139 1000000000\n139 140 1000000000\n140 141 1000000000\n141 142 1000000000\n142 143 1000000000\n143 144 1000000000\n144 145 1000000000\n145 146 1000000000\n146 147 1000000000\n147 148 1000000000\n148 149 1000000000\n149 150 1000000000\n150 151 1000000000\n151 152 1000000000\n152 153 1000000000\n153 154 1000000000\n154 155 1000000000\n155 156 1000000000\n156 157 1000000000\n157 158 1000000000\n158 159 1000000000\n159 160 1000000000\n160 161 1000000000\n161 162 1000000000\n162 163 1000000000\n163 164 1000000000\n164 165 1000000000\n165 166 1000000000\n166 167 1000000000\n167 168 1000000000\n168 169 1000000000\n169 170 1000000000\n170 171 1000000000\n171 172 1000000000\n172 173 1000000000\n173 174 1000000000\n174 175 1000000000\n175 176 1000000000\n176 177 1000000000\n177 178 1000000000\n178 179 1000000000\n179 180 1000000000\n180 181 1000000000\n181 182 1000000000\n182 183 1000000000\n183 184 1000000000\n184 185 1000000000\n185 186 1000000000\n186 187 1000000000\n187 188 1000000000\n188 189 1000000000\n189 190 1000000000\n190 191 1000000000\n191 192 1000000000\n192 193 1000000000\n193 194 1000000000\n194 195 1000000000\n195 196 1000000000\n196 197 1000000000\n197 198 1000000000\n198 199 1000000000\n199 200 1000000000\n200 201 1000000000\n201 202 1000000000\n202 203 1000000000\n203 204 1000000000\n204 205 1000000000\n205 206 1000000000\n206 207 1000000000\n207 208 1000000000\n208 209 1000000000\n209 210 1000000000\n210 211 1000000000\n211 212 1000000000\n212 213 1000000000\n213 214 1000000000\n214 215 1000000000\n215 216 1000000000\n216 217 1000000000\n217 218 1000000000\n218 219 1000000000\n219 220 1000000000\n220 221 1000000000\n221 222 1000000000\n222 223 1000000000\n223 224 1000000000\n224 225 1000000000\n225 226 1000000000\n226 227 1000000000\n227 228 1000000000\n228 229 1000000000\n229 230 1000000000\n230 231 1000000000\n231 232 1000000000\n232 233 1000000000\n233 234 1000000000\n234 235 1000000000\n235 236 1000000000\n236 237 1000000000\n237 238 1000000000\n238 239 1000000000\n239 240 1000000000\n240 241 1000000000\n241 242 1000000000\n242 243 1000000000\n243 244 1000000000\n244 245 1000000000\n245 246 1000000000\n246 247 1000000000\n247 248 1000000000\n248 249 1000000000\n249 250 1000000000\n250 251 1000000000\n251 252 1000000000\n252 253 1000000000\n253 254 1000000000\n254 255 1000000000\n255 256 1000000000\n256 257 1000000000\n257 258 1000000000\n258 259 1000000000\n259 260 1000000000\n260 261 1000000000\n261 262 1000000000\n262 263 1000000000\n263 264 1000000000\n264 265 1000000000\n265 266 1000000000\n266 267 1000000000\n267 268 1000000000\n268 269 1000000000\n269 270 1000000000\n270 271 1000000000\n271 272 1000000000\n272 273 1000000000\n273 274 1000000000\n274 275 1000000000\n275 276 1000000000\n276 277 1000000000\n277 278 1000000000\n278 279 1000000000\n279 280 1000000000\n280 281 1000000000\n281 282 1000000000\n282 283 1000000000\n283 284 1000000000\n284 285 1000000000\n285 286 1000000000\n286 287 1000000000\n287 288 1000000000\n288 289 1000000000\n289 290 1000000000\n290 291 1000000000\n291 292 1000000000\n292 293 1000000000\n293 294 1000000000\n294 295 1000000000\n295 296 1000000000\n296 297 1000000000\n297 298 1000000000\n298 299 1000000000\n299 300 1000000000\n",
              output: "299000000000\n",
            },
            {
              input:
                "400 500\n267 359 1575\n304 267 8646\n375 359 5739\n305 267 4748\n224 304 5618\n160 267 3206\n96 160 5101\n268 224 8577\n400 267 8980\n381 267 3464\n327 160 2190\n256 305 7974\n378 400 4458\n282 224 9697\n398 282 6901\n307 282 5825\n266 378 6525\n118 400 6165\n265 381 1239\n358 307 3552\n322 378 7187\n333 267 7482\n336 400 7422\n357 322 7854\n89 118 9469\n363 267 3808\n389 375 6037\n52 160 1606\n80 265 1275\n221 224 4207\n148 333 3579\n179 322 8493\n50 268 9471\n143 50 4244\n279 378 6584\n165 333 5066\n140 160 4672\n228 140 2919\n152 398 5499\n190 358 9231\n345 358 3959\n335 140 5390\n171 381 4055\n162 190 6962\n40 279 221\n54 256 5659\n26 190 2978\n209 190 6733\n23 266 6269\n289 322 4537\n311 256 6425\n351 265 2599\n56 162 8286\n354 160 6075\n97 322 9966\n177 333 8070\n31 351 531\n126 327 4752\n342 52 8895\n310 357 8715\n260 398 1338\n136 279 6183\n321 256 5310\n275 228 2203\n71 179 10\n339 333 9895\n254 363 2535\n227 80 4534\n48 336 1886\n128 289 8439\n3 389 1750\n298 305 7312\n352 148 9988\n12 224 2898\n33 279 3565\n14 12 9880\n299 26 7795\n373 342 1472\n72 136 1800\n301 80 2877\n49 177 1525\n349 256 8138\n1 162 2746\n344 148 1352\n283 363 2815\n111 375 9641\n286 160 9248\n214 279 3602\n216 89 705\n249 152 1467\n230 275 9861\n200 336 5140\n120 126 5719\n233 344 234\n116 260 3191\n237 152 7041\n248 266 7776\n291 358 6731\n59 224 7424\n388 237 1384\n42 305 8867\n79 3 4762\n174 80 8922\n73 286 7967\n219 73 3491\n81 80 4284\n325 97 1682\n87 111 6201\n316 40 1080\n151 381 8089\n68 375 7760\n76 177 5646\n61 378 3638\n367 87 7151\n34 378 6211\n315 230 4806\n99 116 1592\n187 249 6413\n123 266 6222\n270 34 3768\n206 316 4280\n197 40 9036\n44 227 3268\n137 49 5355\n338 358 3454\n244 354 5325\n149 152 5375\n312 363 9320\n332 140 8337\n75 311 988\n353 359 7598\n172 316 894\n365 171 5676\n146 270 84\n16 230 8288\n156 71 3189\n296 136 5230\n273 267 6136\n86 224 7540\n9 221 6759\n314 200 3355\n125 42 3842\n37 156 7533\n231 96 8460\n169 389 3929\n98 283 1009\n192 270 8369\n253 311 9658\n66 111 9004\n280 151 8602\n343 365 1751\n218 1 5310\n45 49 868\n60 98 9407\n290 273 169\n78 311 2522\n11 71 3121\n320 206 6725\n28 325 4256\n154 354 9353\n188 315 4528\n32 75 8223\n82 23 2574\n195 14 5511\n202 60 9725\n371 23 4273\n102 99 181\n17 128 9775\n176 162 3491\n69 143 6260\n347 12 1747\n196 148 8752\n173 381 4462\n133 23 9056\n384 171 7036\n74 357 3627\n245 160 5846\n147 354 3696\n222 176 6131\n39 171 1248\n331 275 7212\n58 190 9858\n184 322 6494\n129 147 1150\n105 97 8337\n4 373 3371\n175 75 5334\n313 175 9179\n92 137 8339\n10 320 3592\n376 98 9425\n303 222 3597\n130 351 4299\n269 332 6686\n185 327 8577\n62 120 4170\n189 81 1211\n318 322 9566\n334 66 9295\n18 291 9906\n297 279 951\n164 357 5524\n292 1 5732\n13 62 7706\n264 184 9459\n180 322 8063\n191 56 4340\n236 289 6815\n252 398 3485\n210 146 3661\n203 310 3045\n337 260 6317\n225 48 2915\n346 233 6737\n278 313 1117\n364 305 7133\n235 200 3197\n239 164 8966\n38 260 3302\n112 297 7317\n35 185 9908\n193 31 4380\n368 73 2042\n15 320 4556\n20 231 8438\n84 378 3720\n261 314 6726\n223 87 3173\n361 343 8828\n141 244 3644\n234 32 4217\n91 151 793\n110 290 2164\n24 80 2945\n70 110 6726\n113 154 8159\n93 316 2039\n7 111 3800\n262 273 7013\n302 353 3626\n53 315 7846\n385 357 3489\n243 111 9960\n158 225 2292\n295 378 959\n257 149 3848\n207 53 7159\n121 15 8595\n57 20 944\n319 59 2982\n183 261 2023\n380 112 3465\n374 113 6396\n204 118 8208\n356 183 3885\n145 295 5101\n399 380 2493\n328 12 2615\n63 187 6572\n212 158 4420\n109 63 9955\n246 4 1185\n94 313 2973\n323 53 1600\n259 191 9382\n51 278 4722\n25 352 1928\n6 259 869\n386 218 8830\n229 257 8557\n178 347 157\n276 206 4908\n393 335 6861\n127 375 5978\n107 209 8117\n285 59 599\n138 59 7924\n382 322 2879\n271 116 8316\n150 24 7931\n272 127 1256\n329 357 5202\n168 4 6183\n251 7 2884\n103 145 1556\n294 60 8591\n19 399 535\n2 44 4143\n288 126 7481\n390 322 7941\n166 151 7462\n215 289 2742\n306 96 894\n122 34 7853\n30 337 3368\n142 376 878\n341 329 7352\n387 289 3506\n217 210 7873\n287 361 9772\n201 235 1147\n366 147 3570\n144 332 4701\n64 111 5821\n182 373 5220\n281 180 4160\n135 354 8199\n247 356 5435\n36 12 9370\n250 34 4821\n255 70 35\n232 141 7598\n360 2 1715\n308 48 530\n43 59 1655\n65 363 5767\n139 116 26\n161 189 3991\n153 65 6303\n134 31 7974\n29 94 9302\n131 52 9207\n395 169 7656\n205 217 60\n350 307 1954\n309 341 1883\n300 38 3520\n241 151 6591\n213 61 77\n67 31 5651\n326 3 4954\n392 343 4707\n108 283 7885\n226 251 7986\n83 257 6197\n284 147 5453\n348 219 7909\n114 84 1569\n85 11 7053\n90 336 3192\n240 130 4080\n124 131 9231\n104 241 9260\n317 259 821\n186 69 109\n167 158 5114\n159 28 6582\n355 191 9561\n55 83 6214\n5 358 3948\n170 221 1715\n157 151 6995\n88 9 5641\n211 87 6517\n106 304 5143\n117 25 944\n100 275 2249\n397 240 2881\n330 219 4419\n394 316 4228\n391 65 3831\n372 175 8260\n194 266 100\n27 130 4077\n115 98 6294\n238 319 1519\n293 213 8172\n8 285 8167\n362 204 3886\n263 120 581\n119 153 8106\n22 8 1244\n132 248 8257\n377 170 7980\n21 338 4558\n324 392 7040\n274 62 7434\n220 281 7294\n369 85 3279\n163 24 9430\n208 178 9621\n258 87 1597\n199 49 157\n198 91 4344\n277 66 8070\n242 204 5932\n340 86 133\n370 325 5476\n181 215 4676\n46 58 1946\n396 294 1829\n95 261 5045\n383 123 1076\n41 154 4364\n155 297 1235\n379 295 4566\n77 358 6029\n101 268 4723\n47 248 2423\n189 157 8488\n181 247 4529\n29 123 8792\n142 82 6768\n385 142 4401\n207 84 4745\n291 33 4319\n198 167 3\n14 334 9759\n43 34 7449\n105 391 8544\n300 209 3054\n334 394 5132\n326 295 9267\n228 199 6162\n364 36 2476\n55 288 3966\n91 305 4899\n369 95 5599\n384 111 2580\n177 34 6424\n46 334 5831\n394 355 8240\n315 201 5622\n31 378 435\n6 43 6586\n343 96 882\n364 32 1648\n82 85 9242\n332 190 5856\n69 162 4292\n43 264 4176\n65 106 502\n385 301 1318\n182 262 7169\n99 385 4426\n239 207 6074\n368 197 1270\n351 340 3049\n133 74 7509\n116 302 4855\n325 138 980\n78 263 3473\n136 287 9844\n272 146 9685\n339 152 2513\n137 147 7462\n157 107 8196\n135 170 2052\n375 188 8531\n106 286 7322\n362 95 7029\n145 52 8652\n276 301 6554\n396 387 740\n354 77 844\n118 298 909\n2 187 2572\n131 62 9541\n185 266 953\n170 64 5914\n292 69 8566\n177 371 7112\n192 187 5834\n128 351 3602\n223 28 8328\n340 399 1308\n15 256 6771\n298 398 3743\n227 369 7447\n151 221 6989\n279 222 3376\n10 260 8302\n168 191 124\n70 385 2632\n29 113 6176\n335 342 7654\n348 312 119\n378 192 268\n355 175 9997\n18 118 199\n51 181 2133\n15 90 9691\n36 143 1781\n172 399 9724\n83 65 7922\n333 333 3018\n102 230 4478\n322 101 6933\n353 244 3397\n102 156 9923\n331 360 3406\n138 175 3027\n82 382 1440\n166 179 3752\n316 262 3246\n364 162 6774\n343 293 3917\n56 83 960\n381 227 5513\n308 66 8549\n",
              output: "1731947\n",
            },
            {
              input:
                "500 450\n433 198 6891\n21 133 8377\n249 208 4970\n496 245 5867\n299 457 3579\n259 72 4618\n72 387 1554\n317 410 4105\n466 273 9862\n462 76 5082\n51 374 1209\n461 436 5410\n242 287 1650\n182 223 5181\n313 328 3351\n495 283 7816\n227 444 8542\n134 32 8990\n469 8 1529\n369 431 6535\n364 423 19\n314 253 5459\n125 374 5329\n361 446 1032\n98 470 9299\n114 123 2335\n412 279 7340\n47 42 5244\n449 261 8017\n56 155 9032\n150 362 2045\n281 171 8853\n105 494 9883\n281 301 4713\n228 47 9770\n409 198 5195\n295 124 4757\n95 97 3060\n17 314 4261\n244 36 1472\n348 388 2134\n449 77 634\n432 42 8858\n350 201 8595\n142 268 3859\n435 111 9664\n423 487 6872\n297 141 7383\n253 339 5856\n43 167 1890\n250 301 5494\n433 98 3982\n9 375 4441\n60 362 3613\n191 407 2794\n171 219 1019\n52 401 2398\n438 358 3585\n24 419 9403\n325 466 8753\n309 349 1213\n14 64 3089\n311 426 9437\n62 201 1500\n190 427 1902\n19 311 355\n100 493 3031\n368 64 7852\n108 373 1001\n480 348 374\n279 218 1663\n428 134 1147\n114 37 4933\n180 224 2955\n32 258 7654\n21 306 1654\n359 201 3267\n134 184 7705\n430 462 9336\n87 358 3333\n495 393 952\n404 347 2593\n433 83 5609\n272 129 1921\n306 472 7247\n341 90 217\n242 349 6716\n461 292 8333\n470 160 5852\n199 429 4112\n79 288 204\n235 380 1296\n172 379 749\n279 144 2210\n123 391 7895\n181 313 4717\n345 184 9672\n485 457 2169\n367 159 6358\n384 213 1323\n1 305 3151\n358 172 2623\n123 115 7343\n194 364 9309\n448 213 517\n206 447 9298\n215 396 767\n85 229 1047\n133 360 2584\n229 271 7984\n465 288 9896\n387 1 638\n254 167 5113\n429 240 817\n415 422 6802\n97 281 1368\n429 372 2139\n8 206 6841\n162 2 3499\n8 368 39\n422 346 8657\n314 51 3121\n61 312 3253\n448 155 4588\n353 94 1642\n244 438 6500\n322 42 358\n141 468 7422\n410 406 1897\n442 132 2186\n335 267 5687\n59 447 2531\n143 436 305\n22 21 3371\n349 133 9149\n162 485 6012\n481 291 689\n434 384 9955\n336 254 7515\n328 223 6103\n447 276 2922\n107 193 9620\n150 5 2269\n78 139 5463\n173 405 6017\n368 48 5542\n400 318 585\n22 139 2685\n77 299 4744\n185 203 8987\n67 151 1883\n245 375 3928\n479 25 5045\n92 439 8570\n374 37 4959\n207 428 5383\n154 213 1781\n51 288 7884\n243 173 5631\n64 246 1901\n359 255 6989\n20 155 5490\n377 352 2551\n471 86 9249\n193 413 1425\n34 414 1388\n102 384 3622\n32 198 129\n51 202 9118\n266 149 7349\n472 251 9583\n366 348 3560\n217 43 6035\n113 134 9589\n398 86 7066\n99 184 1885\n33 421 453\n463 270 7400\n386 347 3305\n61 255 6521\n132 107 690\n486 409 3538\n320 75 1715\n102 235 6194\n186 280 2480\n54 306 7994\n76 289 6651\n327 349 6935\n450 267 8117\n348 470 5284\n427 256 8170\n326 344 3310\n278 313 3585\n5 175 5215\n419 165 582\n269 76 4209\n309 402 2555\n432 195 9552\n151 368 7708\n34 410 1387\n265 445 646\n34 116 2139\n21 154 251\n389 433 7350\n170 442 2633\n410 77 7549\n496 191 8274\n196 462 8681\n258 18 9403\n47 348 8487\n389 308 1252\n383 219 3377\n149 275 9808\n214 423 7901\n433 406 6367\n312 301 3827\n436 443 336\n337 454 4\n380 94 4956\n260 292 4170\n171 34 8086\n441 135 4962\n396 209 6295\n415 197 1021\n84 329 2087\n123 147 5473\n29 483 589\n247 214 2309\n252 456 9863\n368 42 2481\n415 181 6737\n19 314 7640\n198 235 771\n52 242 2481\n11 17 9803\n317 68 5307\n54 359 8998\n333 178 3195\n197 402 8034\n57 452 986\n313 359 7655\n315 324 5536\n334 64 4856\n404 435 2083\n491 467 6352\n410 151 1992\n266 441 3099\n20 401 6423\n228 191 3121\n234 183 1235\n490 23 656\n249 131 437\n484 267 9327\n293 449 3539\n118 48 8232\n358 269 6884\n260 157 1859\n75 219 9274\n217 473 1377\n480 54 6810\n33 51 6803\n397 80 504\n406 229 7063\n352 214 494\n255 471 5317\n370 130 1287\n181 37 1989\n184 355 482\n177 179 2915\n6 426 3777\n420 188 1156\n306 458 2348\n107 2 3356\n338 345 2019\n383 4 4805\n189 354 404\n478 310 3816\n440 73 3064\n233 58 7811\n177 363 4231\n67 15 3410\n186 172 7756\n492 150 4856\n480 450 9064\n326 168 3016\n304 42 1681\n274 298 5043\n81 193 2408\n485 65 3651\n162 261 3979\n122 387 3014\n150 191 6878\n340 24 2167\n308 11 6453\n40 360 1200\n68 216 4906\n282 214 2332\n303 217 4883\n327 182 1386\n128 228 6050\n327 486 8671\n30 193 6695\n5 214 5254\n226 105 6089\n151 488 7716\n47 487 3039\n408 56 4538\n58 286 9922\n353 79 7310\n476 205 3038\n394 216 7074\n90 127 7430\n175 480 8575\n73 182 7577\n324 327 1418\n248 387 3337\n151 1 7358\n317 237 128\n112 153 1876\n394 323 4935\n280 312 2560\n218 362 7724\n48 348 8154\n390 492 3808\n279 391 6641\n144 324 355\n62 139 665\n1 132 6528\n270 456 9530\n364 203 7285\n53 383 4139\n182 146 3212\n305 44 581\n37 406 4301\n157 274 5569\n61 272 4081\n457 472 2680\n35 213 4747\n145 267 2203\n294 268 3446\n273 54 6731\n490 325 8906\n207 380 4565\n150 227 6092\n291 322 2258\n81 64 1975\n196 206 9684\n240 72 9169\n343 154 5801\n324 243 6802\n112 245 8010\n356 257 5215\n253 334 987\n228 154 2340\n382 254 859\n455 319 3535\n14 182 7726\n201 455 166\n434 270 1089\n352 444 1334\n352 487 6474\n4 185 675\n60 318 62\n139 448 4793\n373 462 3715\n73 385 9386\n148 98 1728\n223 236 5410\n197 87 5419\n216 332 7132\n76 230 2417\n269 162 2118\n107 467 3061\n228 179 6372\n219 414 8061\n200 374 3608\n408 101 7198\n482 105 9610\n364 26 6363\n18 120 1388\n446 96 5958\n30 381 2841\n120 313 4875\n314 45 8391\n385 146 5785\n211 235 884\n324 357 8457\n341 490 8966\n477 377 7056\n298 233 8032\n131 361 7794\n111 173 4357\n22 23 862\n84 180 64\n149 336 117\n72 33 7009\n349 114 9972\n204 286 3621\n233 99 5563\n312 53 9935\n453 44 5227\n166 275 7467\n458 167 4187\n15 268 727\n98 189 1313\n108 446 8594\n178 97 3304\n129 345 4937\n160 265 6303\n131 247 5636\n447 365 3932\n23 157 9044\n38 5 7552\n254 371 7180\n25 470 6753\n253 236 7211\n61 44 1335\n124 51 2520\n212 453 3498\n226 314 1264\n419 219 9159\n387 454 6464\n21 491 2956\n128 251 3606\n66 431 4572\n479 181 5237\n223 55 9127\n461 147 9996\n278 404 3297\n365 152 7239\n264 310 7571\n275 325 4277\n140 119 272\n61 315 1621\n89 376 6794\n128 112 4663\n451 377 106\n380 275 8443\n220 440 816\n63 197 4465\n61 498 9252\n184 118 8957\n339 145 3631\n379 426 3935\n34 266 5039\n346 168 3828\n192 322 7869\n147 299 2808\n71 415 254\n284 259 5373\n",
              output: "IMPOSSIBLE\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_bipartite-check",
      title: "Two Team Split",
      type: "full_source" as const,
      tags: ["medium", "Graph", "Breadth-First Search"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "程式設計社要舉辦內部對抗賽，需要把 $N$ 位社員（編號 $1$ 到 $N$）分成兩隊。社長整理出 $M$ 對「互相認識」的關係；為了增加比賽張力，他希望每一對互相認識的社員都被分到不同隊。\n\n兩隊人數不必相等，甚至允許其中一隊沒有任何人。請判斷是否存在一種分法，使得每一對互相認識的社員都分屬不同隊。",
        inputFormat:
          "第一行包含兩個整數 $N$ 與 $M$（$1 \\le N \\le 10^5$，$0 \\le M \\le 2 \\times 10^5$）。\n\n接下來 $M$ 行，每行兩個整數 $u_i$、$v_i$（$1 \\le u_i, v_i \\le N$，$u_i \\ne v_i$），表示社員 $u_i$ 與 $v_i$ 互相認識。同一對關係在輸入中不會重複出現。",
        outputFormat: "輸出一行：若存在符合要求的分法，輸出 `YES`，否則輸出 `NO`。",
      },
      samples: [
        { input: "4 4\n1 2\n2 3\n3 4\n4 1\n", output: "YES\n" },
        { input: "3 3\n1 2\n2 3\n1 3\n", output: "NO\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例",
          cases: [
            { input: "4 4\n1 2\n2 3\n3 4\n4 1\n", output: "YES\n" },
            { input: "3 3\n1 2\n2 3\n1 3\n", output: "NO\n" },
          ],
        },
        hidden: {
          description: "小規模與邊界測資：無邊、奇環、偶環、奇環不在節點 1 的分量",
          weight: 40,
          cases: [
            { input: "1 0\n", output: "YES\n" },
            { input: "5 0\n", output: "YES\n" },
            { input: "5 5\n1 2\n2 3\n3 4\n4 5\n5 1\n", output: "NO\n" },
            { input: "6 6\n1 2\n2 3\n3 4\n4 5\n5 6\n6 1\n", output: "YES\n" },
            { input: "5 4\n1 2\n3 4\n4 5\n3 5\n", output: "NO\n" },
            { input: "4 3\n2 3\n3 4\n2 4\n", output: "NO\n" },
            { input: "4 4\n2 4\n1 3\n1 4\n2 3\n", output: "YES\n" },
            { input: "6 4\n2 3\n3 4\n4 5\n5 2\n", output: "YES\n" },
          ],
        },
        hidden2: {
          description: "較大規模測資：長偶環、長奇環與隨機中型圖",
          weight: 60,
          cases: [
            {
              input:
                "400 400\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7\n7 8\n8 9\n9 10\n10 11\n11 12\n12 13\n13 14\n14 15\n15 16\n16 17\n17 18\n18 19\n19 20\n20 21\n21 22\n22 23\n23 24\n24 25\n25 26\n26 27\n27 28\n28 29\n29 30\n30 31\n31 32\n32 33\n33 34\n34 35\n35 36\n36 37\n37 38\n38 39\n39 40\n40 41\n41 42\n42 43\n43 44\n44 45\n45 46\n46 47\n47 48\n48 49\n49 50\n50 51\n51 52\n52 53\n53 54\n54 55\n55 56\n56 57\n57 58\n58 59\n59 60\n60 61\n61 62\n62 63\n63 64\n64 65\n65 66\n66 67\n67 68\n68 69\n69 70\n70 71\n71 72\n72 73\n73 74\n74 75\n75 76\n76 77\n77 78\n78 79\n79 80\n80 81\n81 82\n82 83\n83 84\n84 85\n85 86\n86 87\n87 88\n88 89\n89 90\n90 91\n91 92\n92 93\n93 94\n94 95\n95 96\n96 97\n97 98\n98 99\n99 100\n100 101\n101 102\n102 103\n103 104\n104 105\n105 106\n106 107\n107 108\n108 109\n109 110\n110 111\n111 112\n112 113\n113 114\n114 115\n115 116\n116 117\n117 118\n118 119\n119 120\n120 121\n121 122\n122 123\n123 124\n124 125\n125 126\n126 127\n127 128\n128 129\n129 130\n130 131\n131 132\n132 133\n133 134\n134 135\n135 136\n136 137\n137 138\n138 139\n139 140\n140 141\n141 142\n142 143\n143 144\n144 145\n145 146\n146 147\n147 148\n148 149\n149 150\n150 151\n151 152\n152 153\n153 154\n154 155\n155 156\n156 157\n157 158\n158 159\n159 160\n160 161\n161 162\n162 163\n163 164\n164 165\n165 166\n166 167\n167 168\n168 169\n169 170\n170 171\n171 172\n172 173\n173 174\n174 175\n175 176\n176 177\n177 178\n178 179\n179 180\n180 181\n181 182\n182 183\n183 184\n184 185\n185 186\n186 187\n187 188\n188 189\n189 190\n190 191\n191 192\n192 193\n193 194\n194 195\n195 196\n196 197\n197 198\n198 199\n199 200\n200 201\n201 202\n202 203\n203 204\n204 205\n205 206\n206 207\n207 208\n208 209\n209 210\n210 211\n211 212\n212 213\n213 214\n214 215\n215 216\n216 217\n217 218\n218 219\n219 220\n220 221\n221 222\n222 223\n223 224\n224 225\n225 226\n226 227\n227 228\n228 229\n229 230\n230 231\n231 232\n232 233\n233 234\n234 235\n235 236\n236 237\n237 238\n238 239\n239 240\n240 241\n241 242\n242 243\n243 244\n244 245\n245 246\n246 247\n247 248\n248 249\n249 250\n250 251\n251 252\n252 253\n253 254\n254 255\n255 256\n256 257\n257 258\n258 259\n259 260\n260 261\n261 262\n262 263\n263 264\n264 265\n265 266\n266 267\n267 268\n268 269\n269 270\n270 271\n271 272\n272 273\n273 274\n274 275\n275 276\n276 277\n277 278\n278 279\n279 280\n280 281\n281 282\n282 283\n283 284\n284 285\n285 286\n286 287\n287 288\n288 289\n289 290\n290 291\n291 292\n292 293\n293 294\n294 295\n295 296\n296 297\n297 298\n298 299\n299 300\n300 301\n301 302\n302 303\n303 304\n304 305\n305 306\n306 307\n307 308\n308 309\n309 310\n310 311\n311 312\n312 313\n313 314\n314 315\n315 316\n316 317\n317 318\n318 319\n319 320\n320 321\n321 322\n322 323\n323 324\n324 325\n325 326\n326 327\n327 328\n328 329\n329 330\n330 331\n331 332\n332 333\n333 334\n334 335\n335 336\n336 337\n337 338\n338 339\n339 340\n340 341\n341 342\n342 343\n343 344\n344 345\n345 346\n346 347\n347 348\n348 349\n349 350\n350 351\n351 352\n352 353\n353 354\n354 355\n355 356\n356 357\n357 358\n358 359\n359 360\n360 361\n361 362\n362 363\n363 364\n364 365\n365 366\n366 367\n367 368\n368 369\n369 370\n370 371\n371 372\n372 373\n373 374\n374 375\n375 376\n376 377\n377 378\n378 379\n379 380\n380 381\n381 382\n382 383\n383 384\n384 385\n385 386\n386 387\n387 388\n388 389\n389 390\n390 391\n391 392\n392 393\n393 394\n394 395\n395 396\n396 397\n397 398\n398 399\n399 400\n400 1\n",
              output: "YES\n",
            },
            {
              input:
                "401 401\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7\n7 8\n8 9\n9 10\n10 11\n11 12\n12 13\n13 14\n14 15\n15 16\n16 17\n17 18\n18 19\n19 20\n20 21\n21 22\n22 23\n23 24\n24 25\n25 26\n26 27\n27 28\n28 29\n29 30\n30 31\n31 32\n32 33\n33 34\n34 35\n35 36\n36 37\n37 38\n38 39\n39 40\n40 41\n41 42\n42 43\n43 44\n44 45\n45 46\n46 47\n47 48\n48 49\n49 50\n50 51\n51 52\n52 53\n53 54\n54 55\n55 56\n56 57\n57 58\n58 59\n59 60\n60 61\n61 62\n62 63\n63 64\n64 65\n65 66\n66 67\n67 68\n68 69\n69 70\n70 71\n71 72\n72 73\n73 74\n74 75\n75 76\n76 77\n77 78\n78 79\n79 80\n80 81\n81 82\n82 83\n83 84\n84 85\n85 86\n86 87\n87 88\n88 89\n89 90\n90 91\n91 92\n92 93\n93 94\n94 95\n95 96\n96 97\n97 98\n98 99\n99 100\n100 101\n101 102\n102 103\n103 104\n104 105\n105 106\n106 107\n107 108\n108 109\n109 110\n110 111\n111 112\n112 113\n113 114\n114 115\n115 116\n116 117\n117 118\n118 119\n119 120\n120 121\n121 122\n122 123\n123 124\n124 125\n125 126\n126 127\n127 128\n128 129\n129 130\n130 131\n131 132\n132 133\n133 134\n134 135\n135 136\n136 137\n137 138\n138 139\n139 140\n140 141\n141 142\n142 143\n143 144\n144 145\n145 146\n146 147\n147 148\n148 149\n149 150\n150 151\n151 152\n152 153\n153 154\n154 155\n155 156\n156 157\n157 158\n158 159\n159 160\n160 161\n161 162\n162 163\n163 164\n164 165\n165 166\n166 167\n167 168\n168 169\n169 170\n170 171\n171 172\n172 173\n173 174\n174 175\n175 176\n176 177\n177 178\n178 179\n179 180\n180 181\n181 182\n182 183\n183 184\n184 185\n185 186\n186 187\n187 188\n188 189\n189 190\n190 191\n191 192\n192 193\n193 194\n194 195\n195 196\n196 197\n197 198\n198 199\n199 200\n200 201\n201 202\n202 203\n203 204\n204 205\n205 206\n206 207\n207 208\n208 209\n209 210\n210 211\n211 212\n212 213\n213 214\n214 215\n215 216\n216 217\n217 218\n218 219\n219 220\n220 221\n221 222\n222 223\n223 224\n224 225\n225 226\n226 227\n227 228\n228 229\n229 230\n230 231\n231 232\n232 233\n233 234\n234 235\n235 236\n236 237\n237 238\n238 239\n239 240\n240 241\n241 242\n242 243\n243 244\n244 245\n245 246\n246 247\n247 248\n248 249\n249 250\n250 251\n251 252\n252 253\n253 254\n254 255\n255 256\n256 257\n257 258\n258 259\n259 260\n260 261\n261 262\n262 263\n263 264\n264 265\n265 266\n266 267\n267 268\n268 269\n269 270\n270 271\n271 272\n272 273\n273 274\n274 275\n275 276\n276 277\n277 278\n278 279\n279 280\n280 281\n281 282\n282 283\n283 284\n284 285\n285 286\n286 287\n287 288\n288 289\n289 290\n290 291\n291 292\n292 293\n293 294\n294 295\n295 296\n296 297\n297 298\n298 299\n299 300\n300 301\n301 302\n302 303\n303 304\n304 305\n305 306\n306 307\n307 308\n308 309\n309 310\n310 311\n311 312\n312 313\n313 314\n314 315\n315 316\n316 317\n317 318\n318 319\n319 320\n320 321\n321 322\n322 323\n323 324\n324 325\n325 326\n326 327\n327 328\n328 329\n329 330\n330 331\n331 332\n332 333\n333 334\n334 335\n335 336\n336 337\n337 338\n338 339\n339 340\n340 341\n341 342\n342 343\n343 344\n344 345\n345 346\n346 347\n347 348\n348 349\n349 350\n350 351\n351 352\n352 353\n353 354\n354 355\n355 356\n356 357\n357 358\n358 359\n359 360\n360 361\n361 362\n362 363\n363 364\n364 365\n365 366\n366 367\n367 368\n368 369\n369 370\n370 371\n371 372\n372 373\n373 374\n374 375\n375 376\n376 377\n377 378\n378 379\n379 380\n380 381\n381 382\n382 383\n383 384\n384 385\n385 386\n386 387\n387 388\n388 389\n389 390\n390 391\n391 392\n392 393\n393 394\n394 395\n395 396\n396 397\n397 398\n398 399\n399 400\n400 401\n401 1\n",
              output: "NO\n",
            },
            {
              input:
                "800 600\n188 669\n255 309\n143 146\n178 419\n139 586\n80 366\n223 639\n426 637\n567 726\n176 258\n102 722\n563 613\n462 622\n2 476\n212 548\n19 655\n457 503\n123 560\n138 251\n473 481\n319 354\n131 525\n260 526\n250 725\n82 107\n60 339\n552 705\n195 411\n518 775\n417 593\n149 242\n165 774\n138 491\n49 513\n55 781\n145 312\n572 734\n375 750\n678 701\n527 786\n52 581\n69 363\n154 704\n257 779\n60 645\n65 713\n615 677\n406 443\n54 678\n526 655\n74 200\n205 482\n384 702\n554 771\n85 146\n280 382\n511 544\n38 708\n336 467\n632 635\n735 785\n513 622\n184 542\n160 583\n603 747\n421 447\n334 647\n97 485\n314 554\n9 352\n24 301\n36 51\n455 489\n27 265\n286 764\n369 780\n82 416\n191 575\n467 727\n579 590\n444 702\n38 479\n420 421\n66 119\n104 346\n229 297\n513 730\n63 559\n12 280\n439 733\n281 669\n349 506\n611 738\n1 374\n42 713\n433 766\n103 531\n18 584\n6 325\n177 733\n61 116\n412 736\n79 244\n320 768\n426 461\n71 617\n95 467\n177 456\n196 422\n153 247\n59 438\n115 156\n117 217\n105 567\n17 510\n34 683\n172 420\n463 753\n308 778\n614 688\n706 725\n351 571\n445 685\n471 651\n201 709\n691 749\n71 587\n419 771\n348 714\n226 339\n532 594\n209 384\n219 494\n396 496\n136 467\n13 87\n664 673\n441 533\n48 670\n24 592\n13 354\n99 646\n6 647\n62 308\n76 226\n477 797\n148 396\n57 414\n360 689\n117 794\n75 529\n314 541\n216 229\n404 714\n443 767\n516 585\n334 441\n140 379\n364 484\n187 393\n215 665\n59 533\n500 576\n252 672\n244 648\n140 292\n213 545\n297 480\n429 483\n501 697\n324 756\n468 558\n519 766\n332 410\n190 591\n308 445\n576 752\n239 382\n54 446\n207 528\n71 618\n102 495\n96 780\n288 530\n33 650\n154 745\n653 666\n574 767\n732 736\n623 736\n39 245\n507 650\n15 515\n644 796\n83 746\n89 625\n204 560\n114 538\n271 705\n41 570\n486 692\n633 666\n306 580\n59 799\n231 306\n54 405\n288 514\n396 531\n4 276\n32 453\n391 487\n105 403\n454 682\n336 790\n517 609\n52 781\n366 533\n4 12\n76 373\n21 729\n305 532\n88 704\n26 459\n196 497\n695 758\n190 692\n125 145\n535 794\n60 661\n48 126\n31 124\n551 774\n318 614\n479 795\n49 336\n128 161\n434 514\n148 378\n533 613\n591 630\n251 694\n253 745\n416 506\n169 366\n137 210\n440 629\n616 767\n374 405\n585 744\n317 321\n565 578\n141 573\n333 729\n66 764\n154 526\n236 773\n259 660\n268 483\n365 683\n138 299\n466 589\n462 652\n282 344\n155 663\n190 228\n283 517\n166 208\n112 419\n273 541\n102 751\n199 385\n505 758\n387 613\n223 696\n233 234\n450 546\n177 425\n65 241\n431 677\n648 773\n46 717\n211 675\n220 772\n123 759\n7 62\n226 773\n631 676\n353 574\n368 786\n496 545\n502 681\n357 548\n331 696\n71 142\n379 463\n533 786\n284 577\n421 683\n446 657\n312 669\n121 276\n316 434\n318 693\n559 683\n366 392\n196 211\n17 35\n675 754\n235 503\n216 432\n377 434\n479 577\n381 410\n590 625\n14 418\n613 782\n52 682\n318 695\n259 601\n302 606\n200 279\n689 699\n76 618\n278 790\n285 341\n103 384\n86 311\n386 410\n101 528\n118 193\n33 61\n450 651\n616 619\n225 394\n272 420\n286 355\n64 140\n191 519\n96 418\n123 723\n258 388\n362 470\n17 150\n422 532\n651 744\n70 152\n476 780\n368 609\n170 788\n145 449\n644 650\n24 572\n436 451\n74 561\n359 730\n15 361\n62 763\n20 753\n40 81\n287 442\n441 566\n414 720\n210 640\n338 430\n525 794\n53 138\n140 403\n476 785\n291 647\n491 531\n170 233\n637 724\n21 770\n613 767\n117 538\n128 505\n572 749\n155 559\n210 380\n279 520\n234 658\n36 223\n541 559\n521 562\n59 717\n497 610\n136 170\n295 401\n391 607\n430 737\n182 381\n79 690\n540 612\n431 494\n389 575\n313 659\n343 529\n659 756\n407 524\n66 616\n299 310\n120 137\n85 631\n456 711\n172 546\n216 279\n473 545\n242 604\n197 768\n258 725\n427 466\n294 584\n244 451\n168 689\n20 527\n30 384\n18 595\n565 703\n186 384\n702 779\n17 526\n358 497\n63 142\n149 751\n361 725\n167 798\n710 738\n441 702\n183 777\n235 367\n259 771\n174 309\n81 513\n262 504\n444 622\n675 686\n615 742\n456 655\n129 708\n331 626\n437 511\n342 367\n107 521\n135 211\n20 650\n24 695\n34 349\n121 519\n11 455\n294 575\n447 615\n190 483\n572 728\n415 471\n475 496\n63 141\n212 474\n357 794\n540 662\n66 457\n415 765\n25 400\n95 447\n296 545\n406 619\n131 760\n73 117\n116 266\n571 619\n203 307\n227 505\n80 157\n297 579\n496 755\n192 768\n11 100\n112 612\n221 600\n203 365\n381 504\n163 614\n346 406\n189 450\n268 693\n124 461\n5 294\n562 736\n436 746\n134 369\n22 434\n21 60\n373 579\n316 635\n154 293\n327 345\n90 788\n86 467\n239 494\n74 446\n268 553\n239 297\n159 759\n671 735\n411 551\n183 692\n537 591\n205 568\n325 486\n72 659\n89 706\n18 108\n81 698\n481 696\n638 732\n19 181\n96 741\n238 336\n355 541\n76 451\n390 648\n208 350\n90 497\n178 193\n506 635\n107 155\n454 652\n59 476\n265 798\n720 745\n497 625\n166 372\n368 665\n330 472\n310 429\n328 725\n17 419\n144 778\n152 432\n25 606\n150 218\n323 584\n362 629\n76 782\n66 321\n549 705\n108 748\n500 720\n645 748\n286 775\n725 780\n468 655\n600 741\n491 523\n108 629\n118 219\n232 510\n395 529\n97 261\n46 94\n516 673\n43 500\n49 417\n1 536\n349 547\n202 290\n323 742\n226 329\n103 146\n502 595\n171 495\n397 610\n11 528\n342 472\n400 602\n338 780\n336 510\n190 465\n289 346\n27 800\n84 153\n170 438\n238 764\n39 320\n509 716\n67 395\n231 567\n223 431\n65 385\n378 514\n372 772\n159 513\n367 778\n246 668\n51 416\n19 143\n216 248\n365 495\n246 511\n221 614\n228 570\n",
              output: "NO\n",
            },
            {
              input:
                "500 450\n101 190\n328 435\n365 453\n120 155\n34 429\n28 410\n174 421\n47 250\n141 168\n142 395\n6 495\n240 433\n152 209\n361 470\n60 451\n457 498\n310 500\n213 355\n75 323\n253 493\n180 234\n139 398\n58 411\n207 352\n136 405\n33 285\n223 239\n187 450\n226 378\n262 291\n43 227\n56 359\n263 325\n312 477\n37 425\n100 428\n73 408\n251 321\n52 394\n303 365\n237 379\n2 249\n435 497\n208 274\n146 204\n149 200\n208 356\n432 478\n251 354\n179 499\n125 209\n67 479\n2 151\n136 252\n9 52\n101 443\n5 221\n231 243\n2 141\n305 397\n172 186\n120 166\n327 367\n212 336\n176 244\n169 387\n13 243\n164 248\n38 453\n88 268\n266 409\n171 494\n179 185\n140 191\n39 97\n13 410\n402 434\n2 399\n110 196\n13 164\n149 311\n145 436\n119 255\n117 387\n262 356\n130 272\n91 117\n21 463\n130 380\n148 463\n138 452\n122 303\n4 42\n173 489\n137 263\n57 411\n136 379\n362 459\n52 72\n83 341\n58 158\n388 394\n359 445\n235 490\n223 492\n201 218\n52 89\n132 263\n84 447\n129 149\n155 195\n89 319\n41 231\n23 97\n243 358\n157 447\n247 293\n465 492\n138 488\n309 349\n73 361\n10 499\n457 473\n133 333\n17 475\n86 430\n13 279\n89 134\n26 242\n422 442\n174 227\n364 378\n54 230\n136 359\n184 415\n320 435\n6 477\n105 290\n87 490\n454 492\n321 489\n122 248\n191 193\n163 381\n138 326\n297 474\n19 33\n447 497\n57 438\n56 448\n294 339\n85 462\n7 256\n151 403\n10 212\n98 377\n246 418\n19 274\n294 458\n187 403\n220 356\n13 56\n391 413\n35 322\n121 319\n102 313\n32 226\n71 494\n30 210\n7 176\n125 188\n68 122\n8 151\n109 468\n101 442\n45 406\n364 429\n125 263\n68 120\n436 465\n96 407\n68 305\n387 410\n211 396\n282 477\n356 433\n209 441\n289 344\n439 467\n134 400\n140 310\n83 307\n153 331\n295 348\n232 273\n141 264\n263 469\n52 468\n52 462\n248 314\n167 279\n359 399\n44 104\n240 297\n337 457\n2 38\n186 484\n295 467\n169 286\n60 411\n166 349\n130 319\n338 462\n259 467\n39 316\n30 262\n138 345\n74 432\n117 468\n315 374\n350 353\n35 292\n107 193\n166 235\n141 232\n70 85\n110 180\n14 160\n13 482\n309 440\n186 226\n227 366\n263 430\n67 257\n11 365\n115 136\n199 252\n58 130\n70 282\n219 257\n34 268\n10 204\n186 480\n451 475\n419 442\n199 285\n73 338\n353 409\n133 495\n209 389\n89 186\n105 347\n29 254\n196 388\n267 498\n165 241\n120 364\n397 482\n32 352\n7 189\n10 39\n68 139\n112 128\n311 314\n362 447\n8 313\n54 299\n239 499\n127 388\n77 420\n24 346\n122 364\n389 481\n203 234\n253 433\n132 400\n246 417\n177 270\n51 413\n192 432\n254 274\n159 393\n205 434\n91 298\n114 460\n71 237\n165 369\n51 86\n279 418\n13 393\n209 342\n59 371\n110 355\n426 479\n234 444\n85 210\n120 205\n128 474\n334 357\n160 428\n190 300\n98 469\n187 209\n420 475\n180 487\n61 340\n114 281\n201 500\n238 435\n203 338\n93 250\n254 391\n80 406\n270 374\n402 457\n127 268\n373 376\n287 416\n359 374\n251 376\n374 483\n218 364\n73 360\n67 209\n23 247\n54 126\n96 476\n258 284\n326 446\n203 216\n64 89\n102 221\n72 109\n41 165\n291 358\n358 389\n33 42\n189 208\n124 278\n204 306\n85 370\n328 366\n60 446\n41 224\n174 185\n115 305\n201 459\n376 456\n258 341\n35 143\n148 354\n170 394\n389 461\n75 382\n277 438\n295 328\n188 260\n4 88\n173 459\n293 475\n75 289\n66 246\n76 431\n109 114\n86 491\n364 487\n286 346\n378 381\n187 438\n243 423\n205 409\n362 373\n364 366\n256 499\n359 482\n7 391\n96 468\n320 426\n144 242\n38 294\n8 225\n57 368\n169 375\n85 317\n428 461\n5 122\n450 478\n92 293\n282 465\n186 395\n351 456\n47 494\n23 131\n186 287\n148 166\n15 88\n178 330\n414 477\n88 390\n51 363\n421 435\n172 177\n39 361\n66 83\n337 426\n36 476\n129 299\n225 248\n115 250\n158 217\n106 305\n361 407\n187 321\n411 471\n229 386\n9 246\n33 381\n70 500\n176 285\n208 472\n106 356\n17 146\n262 313\n197 322\n193 284\n285 291\n271 329\n77 320\n221 486\n456 468\n87 172\n233 237\n193 252\n91 500\n24 366\n21 293\n113 329\n210 229\n150 196\n170 384\n30 413\n49 146\n350 357\n164 172\n284 410\n50 476\n2 489\n368 464\n253 315\n203 240\n",
              output: "YES\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_count-islands",
      title: "Island Count",
      type: "full_source" as const,
      tags: ["easy", "Graph", "Depth-First Search", "Matrix"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "海洋研究所取得了一張 $R \\times C$ 的網格地圖，每個格子不是陸地就是海洋：陸地以 `#` 表示，海洋以 `.` 表示。\n\n上下左右相鄰（四方向）的陸地格子屬於同一座島嶼；只有斜向（對角）相鄰的陸地彼此**不**相連。請你計算這張地圖上總共有多少座島嶼。",
        inputFormat:
          "第一行包含兩個整數 $R$ 和 $C$（$1 \\le R, C \\le 500$），分別代表地圖的列數與行數。\n\n接下來 $R$ 行，每行一個長度為 $C$ 的字串，只包含字元 `#`（陸地）與 `.`（海洋）。",
        outputFormat: "一行，輸出一個整數，代表島嶼的總數。",
      },
      samples: [
        { input: "4 5\n##..#\n##..#\n.....\n#.###\n", output: "4\n" },
        { input: "3 3\n#..\n.#.\n..#\n", output: "3\n" },
      ],
      testcases: {
        sample: {
          description: "Public sample cases, including the diagonal-adjacency trap.",
          cases: [
            { input: "4 5\n##..#\n##..#\n.....\n#.###\n", output: "4\n" },
            { input: "3 3\n#..\n.#.\n..#\n", output: "3\n" },
            { input: "2 2\n##\n##\n", output: "1\n" },
          ],
        },
        hidden: {
          description:
            "Edge cases: all sea, all land, single cell, diagonal chain, checkerboard, degenerate 1xC and Rx1 maps.",
          weight: 40,
          cases: [
            { input: "1 1\n.\n", output: "0\n" },
            { input: "1 1\n#\n", output: "1\n" },
            { input: "3 4\n....\n....\n....\n", output: "0\n" },
            {
              input: "6 7\n#######\n#######\n#######\n#######\n#######\n#######\n",
              output: "1\n",
            },
            {
              input:
                "15 15\n#.#.#.#.#.#.#.#\n.#.#.#.#.#.#.#.\n#.#.#.#.#.#.#.#\n.#.#.#.#.#.#.#.\n#.#.#.#.#.#.#.#\n.#.#.#.#.#.#.#.\n#.#.#.#.#.#.#.#\n.#.#.#.#.#.#.#.\n#.#.#.#.#.#.#.#\n.#.#.#.#.#.#.#.\n#.#.#.#.#.#.#.#\n.#.#.#.#.#.#.#.\n#.#.#.#.#.#.#.#\n.#.#.#.#.#.#.#.\n#.#.#.#.#.#.#.#\n",
              output: "113\n",
            },
            {
              input:
                "8 8\n#.......\n.#......\n..#.....\n...#....\n....#...\n.....#..\n......#.\n.......#\n",
              output: "8\n",
            },
            {
              input:
                "1 500\n#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.\n",
              output: "250\n",
            },
            {
              input:
                "500 1\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n#\n",
              output: "1\n",
            },
          ],
        },
        hidden2: {
          description: "Random medium-sized maps of varying density.",
          weight: 60,
          cases: [
            {
              input:
                "20 30\n.#..#.###.#.###.###.#####....#\n###.##.##.#.#####..#.##.#...##\n##...#....##...#.#..##..###.#.\n###..##..#..#..##...#.#..#####\n####...#..#.#..######..#.#...#\n..####.#..#.#....#.#.####.####\n....###....#..#...####.....###\n#..##.#.#....###.#####....#.#.\n#.#....#.....#.#.#.#.####...#.\n..#...##..#.#.#..#.#..#.#####.\n#..#..##.........#..##...#....\n.##..#######.#.##.####.#..#.#.\n.#..#.##..#..###..##.###...###\n.#....#....###.#...##.##..#.##\n#.#.#.#..#.####.#..#...#.#####\n..#..#.##.###..#.###..#.###.#.\n##.#..#####.#.#...#..#..#....#\n..#..###....######......#.#...\n#.####..#...#####...#.#....###\n......##....#.##.#..###..####.\n",
              output: "49\n",
            },
            {
              input:
                "40 50\n..##..#.####..#.###..####.##...###.###.#.#.##..###\n###.##.##..#..#.#.#...#..##.####.#.##.###..###..##\n##.#.#.#.##.#.##..#..##..####.#.##.#..##.....####.\n..#...#...###.#...##.#.###.####.#.##.#.#..#.#..#..\n...##..#..##.##.##..##.#...#..###.##.#.#...######.\n.#####.#..###....#..#####.#####.#.#..#.#....####.#\n#.#.##.###.###.#.#..##.#####..#..#.###.....###.#.#\n.#...#.#.#####.###..####..#...##.#.#.#.##...##.#.#\n###...#.###.#....#.##.#.##....###..#..#.#..#...###\n#.#..##.#...##.##.#....#..#...#...###..#..###.####\n......####..##...##.##.#.#......#.##.#.###...#.###\n.#######..#..##......#######.###...#..#.##.##.####\n.#..##.###..###.##..###..#...##..###..#####.##.##.\n##.#.##....####.#####.#.##.##.#.#####.#.#..#######\n.###.##....###.###...#.#..#....##..#..#....######.\n..####..#.....##.###..###.####.....#.##.#####.####\n#..###.#.#####.###.####.##.#####..#######.#..####.\n#.###.###.#.###.###.#.#.#.##..##..##.#####.#....##\n#.####......###...##.....##.#.##.##.####.##..###.#\n###.#.#..##..#..##.###...#####.#.###..##.##.#.###.\n#..#.#...##.####.##..######.#.##.####.#.###.###.##\n##.##.##.#######...#.###..##.#.#.....#...#.##..###\n.##.#.##..#...##...#...#####.##....#####.#.#######\n##.##.##..##...#...#.###.#.#..#.#.#.#.##.#.#.#.##.\n#...#####.#..#..##..##.#..#...##..#.######...#..##\n#.###.##.##.....##.#..#.......###.#..#####.#.#.###\n.#.##....#..##....#.######.#.#####...##.##.##.##.#\n...###.#.###...#..#.##..####.....#...#.......##...\n.#...##...####..#....#..#...##..#.########..#....#\n###....#......#...#.##...####..###.#.#..###.##...#\n#.#.###..##..####....####..#..###..#..#...#####..#\n#..#.....#..##.####.####...######..#.....#.#..#.##\n#..####..#.#.##.#.####.#.#####...##.###.######...#\n#.###..##.#.##.#..#.#....###...#..#####.#....####.\n.#.###.##..#..####...####..####.#...#..#..#.##.#.#\n###.....#####..#..#.###..#.#....##.####.#.#.#....#\n.#.#...#.#.#...###.#..#.#.#.#....##.######.###..#.\n##...#.##.#...##..##.#####.###.#..####.#####.##...\n##.#..##..##.###.#.####..######.##...##.#.#####.##\n..#..##...##....###...##..###....#.#.#..#..##.####\n",
              output: "94\n",
            },
            {
              input:
                "12 60\n#.#..#.....#...#.....#.###......#.........#.....#.......#.#.\n.##.#.###.#..#.##...#.##.#.#.#.#....#.#..##...#.#.###......#\n.##...#..##.####...#...###..#........###.#.......#...#.#..#.\n.##....####...#.#.##.#.##...##.#.....#....#..###........###.\n.#.....#..##......##...#...#..#...#.##..#.#.....#.####..###.\n.....###.....##.#..#..#.#.#.#....#..#.....##.#.#..##.#.##...\n#..#.#..#.#..#.......#.#.##.#.....#...##..#...##..#...###...\n.....#...#..##.#.##..#....#..#.###....######.......#.#...##.\n..##...#.##...#...#.#....#....#.#..#.##.##.#..##...#..#....#\n#...#..#..........###.#.###.#..#..#..............#.......##.\n.....#.##...#.###.#...##...##..#.#..#.....##..####.##.....#.\n..#..##.#..##.#...##.....##.###......#..#...#..#.....#.#.##.\n",
              output: "96\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_tree-diameter",
      title: "Tree Diameter",
      type: "full_source" as const,
      tags: ["medium", "Tree", "Depth-First Search"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "給定一棵有 $N$ 個節點的樹：節點編號 $1$ 到 $N$，由 $N - 1$ 條無向邊連接，任兩節點之間恰有一條簡單路徑。\n\n樹的**直徑**定義為樹上最長簡單路徑所包含的邊數。請求出這棵樹的直徑。特別地，當 $N = 1$ 時直徑為 $0$。",
        inputFormat:
          "第一行一個整數 $N$（$1 \\le N \\le 10^5$）。\n\n接下來 $N - 1$ 行，每行兩個整數 $u$ 和 $v$（$1 \\le u, v \\le N$，$u \\ne v$），表示一條連接節點 $u$ 與節點 $v$ 的邊。保證輸入構成一棵樹。",
        outputFormat: "一行，輸出一個整數，代表樹的直徑（最長簡單路徑的邊數）。",
      },
      samples: [
        { input: "5\n1 2\n2 3\n3 4\n3 5\n", output: "3\n" },
        { input: "1\n", output: "0\n" },
      ],
      testcases: {
        sample: {
          description: "Public sample cases, including the single-node tree.",
          cases: [
            { input: "5\n1 2\n2 3\n3 4\n3 5\n", output: "3\n" },
            { input: "1\n", output: "0\n" },
            { input: "2\n2 1\n", output: "1\n" },
          ],
        },
        hidden: {
          description:
            "Edge shapes: single node, single edge, star, long chain, and trees where node 1 sits mid-arm so one BFS from node 1 fails.",
          weight: 40,
          cases: [
            { input: "1\n", output: "0\n" },
            { input: "2\n1 2\n", output: "1\n" },
            { input: "9\n5 1\n5 2\n5 3\n5 4\n5 6\n5 7\n5 8\n5 9\n", output: "2\n" },
            {
              input:
                "41\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7\n7 8\n8 9\n9 10\n10 11\n11 12\n12 13\n13 14\n14 15\n15 16\n16 17\n17 18\n18 19\n19 20\n20 21\n1 22\n22 23\n23 24\n24 25\n25 26\n26 27\n27 28\n28 29\n29 30\n30 31\n31 32\n32 33\n33 34\n34 35\n35 36\n36 37\n37 38\n38 39\n39 40\n40 41\n",
              output: "40\n",
            },
            {
              input:
                "31\n2 3\n3 4\n4 5\n5 6\n6 7\n7 8\n8 9\n9 10\n10 11\n11 12\n12 13\n13 14\n14 15\n15 16\n16 17\n17 18\n18 19\n19 20\n20 21\n21 22\n22 23\n23 24\n24 25\n25 26\n26 27\n27 28\n28 29\n29 30\n30 31\n1 16\n",
              output: "29\n",
            },
            {
              input:
                "800\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7\n7 8\n8 9\n9 10\n10 11\n11 12\n12 13\n13 14\n14 15\n15 16\n16 17\n17 18\n18 19\n19 20\n20 21\n21 22\n22 23\n23 24\n24 25\n25 26\n26 27\n27 28\n28 29\n29 30\n30 31\n31 32\n32 33\n33 34\n34 35\n35 36\n36 37\n37 38\n38 39\n39 40\n40 41\n41 42\n42 43\n43 44\n44 45\n45 46\n46 47\n47 48\n48 49\n49 50\n50 51\n51 52\n52 53\n53 54\n54 55\n55 56\n56 57\n57 58\n58 59\n59 60\n60 61\n61 62\n62 63\n63 64\n64 65\n65 66\n66 67\n67 68\n68 69\n69 70\n70 71\n71 72\n72 73\n73 74\n74 75\n75 76\n76 77\n77 78\n78 79\n79 80\n80 81\n81 82\n82 83\n83 84\n84 85\n85 86\n86 87\n87 88\n88 89\n89 90\n90 91\n91 92\n92 93\n93 94\n94 95\n95 96\n96 97\n97 98\n98 99\n99 100\n100 101\n101 102\n102 103\n103 104\n104 105\n105 106\n106 107\n107 108\n108 109\n109 110\n110 111\n111 112\n112 113\n113 114\n114 115\n115 116\n116 117\n117 118\n118 119\n119 120\n120 121\n121 122\n122 123\n123 124\n124 125\n125 126\n126 127\n127 128\n128 129\n129 130\n130 131\n131 132\n132 133\n133 134\n134 135\n135 136\n136 137\n137 138\n138 139\n139 140\n140 141\n141 142\n142 143\n143 144\n144 145\n145 146\n146 147\n147 148\n148 149\n149 150\n150 151\n151 152\n152 153\n153 154\n154 155\n155 156\n156 157\n157 158\n158 159\n159 160\n160 161\n161 162\n162 163\n163 164\n164 165\n165 166\n166 167\n167 168\n168 169\n169 170\n170 171\n171 172\n172 173\n173 174\n174 175\n175 176\n176 177\n177 178\n178 179\n179 180\n180 181\n181 182\n182 183\n183 184\n184 185\n185 186\n186 187\n187 188\n188 189\n189 190\n190 191\n191 192\n192 193\n193 194\n194 195\n195 196\n196 197\n197 198\n198 199\n199 200\n200 201\n201 202\n202 203\n203 204\n204 205\n205 206\n206 207\n207 208\n208 209\n209 210\n210 211\n211 212\n212 213\n213 214\n214 215\n215 216\n216 217\n217 218\n218 219\n219 220\n220 221\n221 222\n222 223\n223 224\n224 225\n225 226\n226 227\n227 228\n228 229\n229 230\n230 231\n231 232\n232 233\n233 234\n234 235\n235 236\n236 237\n237 238\n238 239\n239 240\n240 241\n241 242\n242 243\n243 244\n244 245\n245 246\n246 247\n247 248\n248 249\n249 250\n250 251\n251 252\n252 253\n253 254\n254 255\n255 256\n256 257\n257 258\n258 259\n259 260\n260 261\n261 262\n262 263\n263 264\n264 265\n265 266\n266 267\n267 268\n268 269\n269 270\n270 271\n271 272\n272 273\n273 274\n274 275\n275 276\n276 277\n277 278\n278 279\n279 280\n280 281\n281 282\n282 283\n283 284\n284 285\n285 286\n286 287\n287 288\n288 289\n289 290\n290 291\n291 292\n292 293\n293 294\n294 295\n295 296\n296 297\n297 298\n298 299\n299 300\n300 301\n301 302\n302 303\n303 304\n304 305\n305 306\n306 307\n307 308\n308 309\n309 310\n310 311\n311 312\n312 313\n313 314\n314 315\n315 316\n316 317\n317 318\n318 319\n319 320\n320 321\n321 322\n322 323\n323 324\n324 325\n325 326\n326 327\n327 328\n328 329\n329 330\n330 331\n331 332\n332 333\n333 334\n334 335\n335 336\n336 337\n337 338\n338 339\n339 340\n340 341\n341 342\n342 343\n343 344\n344 345\n345 346\n346 347\n347 348\n348 349\n349 350\n350 351\n351 352\n352 353\n353 354\n354 355\n355 356\n356 357\n357 358\n358 359\n359 360\n360 361\n361 362\n362 363\n363 364\n364 365\n365 366\n366 367\n367 368\n368 369\n369 370\n370 371\n371 372\n372 373\n373 374\n374 375\n375 376\n376 377\n377 378\n378 379\n379 380\n380 381\n381 382\n382 383\n383 384\n384 385\n385 386\n386 387\n387 388\n388 389\n389 390\n390 391\n391 392\n392 393\n393 394\n394 395\n395 396\n396 397\n397 398\n398 399\n399 400\n400 401\n401 402\n402 403\n403 404\n404 405\n405 406\n406 407\n407 408\n408 409\n409 410\n410 411\n411 412\n412 413\n413 414\n414 415\n415 416\n416 417\n417 418\n418 419\n419 420\n420 421\n421 422\n422 423\n423 424\n424 425\n425 426\n426 427\n427 428\n428 429\n429 430\n430 431\n431 432\n432 433\n433 434\n434 435\n435 436\n436 437\n437 438\n438 439\n439 440\n440 441\n441 442\n442 443\n443 444\n444 445\n445 446\n446 447\n447 448\n448 449\n449 450\n450 451\n451 452\n452 453\n453 454\n454 455\n455 456\n456 457\n457 458\n458 459\n459 460\n460 461\n461 462\n462 463\n463 464\n464 465\n465 466\n466 467\n467 468\n468 469\n469 470\n470 471\n471 472\n472 473\n473 474\n474 475\n475 476\n476 477\n477 478\n478 479\n479 480\n480 481\n481 482\n482 483\n483 484\n484 485\n485 486\n486 487\n487 488\n488 489\n489 490\n490 491\n491 492\n492 493\n493 494\n494 495\n495 496\n496 497\n497 498\n498 499\n499 500\n500 501\n501 502\n502 503\n503 504\n504 505\n505 506\n506 507\n507 508\n508 509\n509 510\n510 511\n511 512\n512 513\n513 514\n514 515\n515 516\n516 517\n517 518\n518 519\n519 520\n520 521\n521 522\n522 523\n523 524\n524 525\n525 526\n526 527\n527 528\n528 529\n529 530\n530 531\n531 532\n532 533\n533 534\n534 535\n535 536\n536 537\n537 538\n538 539\n539 540\n540 541\n541 542\n542 543\n543 544\n544 545\n545 546\n546 547\n547 548\n548 549\n549 550\n550 551\n551 552\n552 553\n553 554\n554 555\n555 556\n556 557\n557 558\n558 559\n559 560\n560 561\n561 562\n562 563\n563 564\n564 565\n565 566\n566 567\n567 568\n568 569\n569 570\n570 571\n571 572\n572 573\n573 574\n574 575\n575 576\n576 577\n577 578\n578 579\n579 580\n580 581\n581 582\n582 583\n583 584\n584 585\n585 586\n586 587\n587 588\n588 589\n589 590\n590 591\n591 592\n592 593\n593 594\n594 595\n595 596\n596 597\n597 598\n598 599\n599 600\n600 601\n601 602\n602 603\n603 604\n604 605\n605 606\n606 607\n607 608\n608 609\n609 610\n610 611\n611 612\n612 613\n613 614\n614 615\n615 616\n616 617\n617 618\n618 619\n619 620\n620 621\n621 622\n622 623\n623 624\n624 625\n625 626\n626 627\n627 628\n628 629\n629 630\n630 631\n631 632\n632 633\n633 634\n634 635\n635 636\n636 637\n637 638\n638 639\n639 640\n640 641\n641 642\n642 643\n643 644\n644 645\n645 646\n646 647\n647 648\n648 649\n649 650\n650 651\n651 652\n652 653\n653 654\n654 655\n655 656\n656 657\n657 658\n658 659\n659 660\n660 661\n661 662\n662 663\n663 664\n664 665\n665 666\n666 667\n667 668\n668 669\n669 670\n670 671\n671 672\n672 673\n673 674\n674 675\n675 676\n676 677\n677 678\n678 679\n679 680\n680 681\n681 682\n682 683\n683 684\n684 685\n685 686\n686 687\n687 688\n688 689\n689 690\n690 691\n691 692\n692 693\n693 694\n694 695\n695 696\n696 697\n697 698\n698 699\n699 700\n700 701\n701 702\n702 703\n703 704\n704 705\n705 706\n706 707\n707 708\n708 709\n709 710\n710 711\n711 712\n712 713\n713 714\n714 715\n715 716\n716 717\n717 718\n718 719\n719 720\n720 721\n721 722\n722 723\n723 724\n724 725\n725 726\n726 727\n727 728\n728 729\n729 730\n730 731\n731 732\n732 733\n733 734\n734 735\n735 736\n736 737\n737 738\n738 739\n739 740\n740 741\n741 742\n742 743\n743 744\n744 745\n745 746\n746 747\n747 748\n748 749\n749 750\n750 751\n751 752\n752 753\n753 754\n754 755\n755 756\n756 757\n757 758\n758 759\n759 760\n760 761\n761 762\n762 763\n763 764\n764 765\n765 766\n766 767\n767 768\n768 769\n769 770\n770 771\n771 772\n772 773\n773 774\n774 775\n775 776\n776 777\n777 778\n778 779\n779 780\n780 781\n781 782\n782 783\n783 784\n784 785\n785 786\n786 787\n787 788\n788 789\n789 790\n790 791\n791 792\n792 793\n793 794\n794 795\n795 796\n796 797\n797 798\n798 799\n799 800\n",
              output: "799\n",
            },
          ],
        },
        hidden2: {
          description: "Random trees of mixed shape up to 700 nodes.",
          weight: 60,
          cases: [
            {
              input:
                "500\n299 326\n16 308\n421 200\n482 11\n283 43\n263 244\n398 87\n104 292\n454 68\n126 155\n58 15\n448 278\n168 226\n334 252\n101 432\n297 153\n184 461\n170 72\n343 70\n299 107\n20 496\n379 283\n9 351\n165 397\n202 309\n132 358\n337 374\n356 325\n292 51\n1 110\n419 83\n148 450\n96 407\n4 147\n4 374\n326 125\n435 195\n22 305\n187 349\n341 360\n70 295\n352 475\n438 261\n270 307\n370 312\n264 243\n266 101\n129 369\n180 213\n341 247\n444 287\n385 116\n473 6\n149 417\n29 179\n336 143\n411 105\n391 205\n424 113\n41 366\n43 363\n362 52\n463 272\n79 322\n433 345\n99 57\n181 34\n169 313\n68 401\n488 274\n28 291\n425 378\n188 487\n372 48\n277 164\n165 40\n467 429\n7 180\n7 136\n342 144\n286 436\n450 36\n78 257\n333 81\n434 88\n27 108\n158 223\n412 95\n131 363\n441 410\n193 428\n457 446\n52 6\n65 420\n297 323\n230 492\n293 138\n275 447\n185 171\n485 184\n49 229\n151 256\n176 352\n204 428\n91 350\n258 112\n97 498\n416 200\n455 491\n252 497\n8 426\n496 54\n394 112\n90 420\n36 289\n174 37\n314 442\n466 222\n381 467\n41 310\n88 475\n72 18\n367 339\n120 266\n293 411\n26 243\n283 209\n31 33\n255 354\n272 372\n259 294\n495 413\n498 350\n14 359\n108 110\n56 393\n143 209\n433 208\n28 135\n365 144\n298 253\n287 439\n400 474\n470 75\n440 77\n173 139\n103 177\n218 464\n109 216\n265 360\n301 98\n32 135\n337 464\n298 57\n69 127\n365 105\n93 275\n348 234\n327 199\n415 456\n316 333\n185 115\n199 443\n71 186\n2 92\n182 371\n84 104\n290 38\n284 443\n224 220\n409 109\n373 82\n94 343\n25 366\n233 319\n436 469\n430 406\n259 17\n379 335\n423 427\n380 445\n224 380\n274 12\n345 158\n254 225\n268 12\n288 130\n39 476\n134 386\n212 321\n478 11\n40 237\n91 250\n64 42\n480 364\n456 356\n415 276\n495 39\n16 399\n204 215\n161 137\n228 260\n375 314\n185 472\n321 163\n402 434\n490 248\n125 390\n330 401\n256 3\n151 328\n174 157\n429 369\n124 451\n87 354\n135 76\n332 255\n96 49\n492 454\n221 361\n25 54\n344 207\n242 181\n368 42\n382 24\n245 135\n416 391\n311 324\n390 453\n172 111\n27 241\n123 427\n99 55\n71 231\n441 63\n175 190\n249 121\n387 126\n262 249\n355 349\n351 1\n102 484\n431 273\n132 201\n476 107\n222 279\n421 166\n56 206\n468 216\n477 397\n93 347\n332 205\n206 417\n102 346\n353 157\n90 267\n137 291\n473 290\n145 465\n288 142\n118 486\n250 494\n490 66\n61 69\n398 74\n389 118\n84 62\n48 186\n187 85\n159 280\n50 53\n396 128\n38 215\n156 73\n459 212\n423 20\n147 279\n385 455\n152 169\n63 46\n177 2\n220 339\n245 86\n262 219\n211 479\n47 73\n414 424\n50 422\n30 164\n5 133\n182 207\n219 269\n466 367\n271 426\n303 226\n47 276\n347 103\n140 116\n124 308\n175 194\n236 435\n239 400\n444 232\n24 465\n29 223\n494 473\n155 458\n394 281\n285 286\n173 45\n489 451\n422 311\n120 328\n148 486\n313 5\n221 150\n303 432\n230 97\n358 364\n95 98\n240 449\n76 431\n388 376\n270 228\n167 294\n191 189\n338 404\n359 387\n35 9\n171 160\n217 134\n329 309\n60 197\n203 493\n218 150\n65 331\n425 480\n362 127\n14 58\n210 460\n388 457\n236 114\n23 154\n300 302\n295 248\n340 3\n414 178\n340 44\n85 100\n407 315\n437 257\n261 500\n482 481\n21 251\n61 210\n447 418\n281 141\n488 140\n133 227\n485 10\n122 176\n469 410\n235 336\n304 478\n166 192\n406 499\n238 168\n368 146\n18 10\n446 92\n395 304\n323 244\n320 81\n237 302\n191 319\n282 357\n247 487\n463 145\n325 22\n452 23\n269 17\n238 399\n254 154\n153 167\n377 246\n483 491\n296 384\n392 117\n241 193\n67 471\n418 471\n131 162\n163 67\n470 384\n405 100\n202 481\n136 15\n60 468\n111 51\n13 273\n46 192\n229 156\n462 386\n195 353\n329 296\n377 342\n79 392\n440 74\n198 149\n160 45\n189 453\n80 483\n138 211\n477 357\n89 161\n405 178\n165 479\n214 89\n170 231\n260 282\n278 344\n408 227\n83 375\n307 371\n217 106\n264 458\n327 324\n86 459\n370 13\n240 268\n179 59\n301 438\n172 55\n500 239\n265 461\n75 408\n324 358\n198 35\n141 318\n119 113\n403 234\n445 122\n402 34\n389 162\n32 499\n121 280\n474 439\n251 361\n82 284\n21 277\n382 317\n117 396\n258 130\n94 322\n196 77\n346 139\n213 448\n395 409\n497 267\n190 472\n383 59\n320 8\n37 78\n128 373\n119 403\n263 412\n66 233\n376 26\n31 19\n413 152\n289 393\n419 462\n306 297\n246 331\n225 338\n33 271\n183 62\n437 208\n318 115\n194 312\n196 430\n200 442\n19 489\n114 183\n330 197\n449 242\n306 253\n201 123\n171 44\n188 80\n404 348\n142 381\n159 106\n30 355\n305 203\n378 129\n335 493\n383 452\n285 64\n",
              output: "321\n",
            },
            {
              input:
                "700\n412 291\n360 36\n457 665\n427 397\n671 326\n512 662\n25 159\n284 444\n354 425\n125 385\n522 229\n83 551\n474 314\n602 177\n275 350\n542 683\n341 697\n418 453\n193 361\n529 113\n304 336\n262 534\n576 157\n645 21\n9 248\n51 406\n257 76\n512 635\n147 391\n45 438\n366 82\n47 498\n213 436\n299 460\n139 661\n378 471\n44 217\n641 502\n636 390\n460 677\n121 236\n181 97\n186 31\n421 566\n252 278\n148 235\n115 568\n261 35\n153 665\n324 158\n250 108\n686 537\n657 517\n683 359\n543 465\n96 442\n458 448\n524 587\n198 505\n70 245\n201 124\n313 64\n117 259\n674 276\n695 307\n80 689\n626 387\n267 203\n485 36\n480 150\n107 593\n42 242\n435 104\n325 189\n682 33\n65 670\n437 432\n50 652\n657 479\n403 423\n13 492\n171 73\n16 108\n389 93\n606 7\n377 451\n363 502\n564 106\n143 11\n9 514\n384 12\n583 264\n561 423\n518 232\n105 660\n81 308\n436 15\n178 8\n226 564\n75 39\n40 141\n210 398\n693 441\n43 351\n477 186\n120 100\n239 155\n394 555\n467 488\n395 372\n266 440\n86 520\n614 55\n244 585\n697 323\n185 568\n244 418\n448 385\n147 359\n189 638\n197 85\n654 90\n541 92\n405 475\n318 117\n188 91\n565 326\n671 535\n11 604\n237 337\n430 362\n652 123\n606 194\n94 434\n302 525\n680 111\n635 253\n626 682\n548 327\n260 303\n252 319\n206 446\n255 1\n391 12\n628 487\n656 466\n452 286\n479 407\n142 431\n207 645\n43 166\n699 433\n256 445\n516 159\n200 238\n688 279\n640 678\n135 273\n66 239\n541 342\n466 247\n70 88\n168 684\n655 404\n151 552\n45 398\n364 181\n464 185\n624 394\n641 515\n367 136\n401 177\n678 2\n301 559\n236 540\n608 131\n173 422\n409 221\n593 197\n167 377\n692 399\n61 591\n355 354\n382 651\n358 257\n408 52\n511 284\n51 364\n100 558\n154 386\n84 478\n130 414\n20 63\n62 170\n406 195\n8 673\n491 127\n496 601\n582 545\n569 176\n422 585\n106 210\n584 439\n346 415\n88 158\n538 368\n556 679\n32 555\n560 516\n623 429\n625 187\n133 65\n600 55\n379 360\n338 285\n396 629\n172 246\n69 279\n461 500\n68 207\n37 126\n352 278\n610 301\n316 383\n308 449\n586 599\n132 1\n56 217\n79 190\n443 485\n329 17\n687 180\n274 307\n83 355\n304 400\n38 689\n28 135\n289 676\n41 514\n228 27\n530 610\n411 623\n698 265\n343 148\n677 456\n222 499\n49 232\n275 7\n94 229\n577 182\n380 19\n495 281\n507 271\n324 445\n526 346\n313 319\n389 589\n285 48\n640 149\n386 636\n71 402\n426 672\n440 82\n538 174\n388 333\n24 545\n617 366\n663 140\n253 397\n612 98\n123 685\n698 484\n128 362\n447 546\n291 413\n60 255\n201 643\n470 566\n666 261\n373 344\n403 26\n309 480\n5 424\n509 233\n110 339\n464 144\n254 119\n215 33\n334 536\n223 497\n659 281\n388 227\n649 258\n56 570\n536 101\n237 408\n613 249\n251 686\n18 160\n154 494\n314 233\n699 483\n332 595\n50 115\n371 664\n453 58\n211 111\n290 10\n74 668\n298 126\n383 46\n650 503\n353 511\n356 204\n16 91\n419 578\n183 80\n296 125\n234 572\n133 329\n81 649\n572 2\n392 101\n700 420\n673 523\n590 17\n169 272\n121 287\n156 62\n144 435\n499 104\n160 654\n519 574\n129 69\n503 473\n136 150\n310 134\n395 318\n416 643\n437 191\n537 332\n592 202\n469 586\n174 417\n103 230\n303 371\n515 540\n539 634\n46 161\n417 509\n227 468\n370 560\n157 71\n199 482\n629 483\n287 331\n25 331\n607 333\n246 493\n621 235\n63 522\n463 525\n315 72\n438 228\n220 554\n305 342\n260 374\n277 642\n93 357\n114 401\n173 288\n300 465\n454 280\n425 667\n295 161\n620 248\n376 691\n407 598\n454 95\n296 409\n642 664\n270 170\n290 337\n10 78\n630 49\n653 428\n292 534\n164 666\n27 532\n410 132\n668 96\n379 410\n381 524\n598 352\n543 588\n630 412\n327 224\n317 218\n687 349\n632 487\n276 486\n134 146\n557 432\n240 151\n73 498\n320 644\n283 155\n615 271\n109 64\n599 89\n163 421\n224 188\n325 491\n328 163\n350 620\n335 576\n109 274\n334 612\n292 220\n72 191\n472 659\n517 97\n508 203\n681 23\n282 449\n433 390\n591 205\n75 426\n696 523\n226 183\n29 184\n361 420\n617 633\n696 459\n548 589\n316 573\n242 691\n347 295\n392 579\n233 506\n222 152\n76 529\n299 48\n618 180\n372 365\n418 618\n211 544\n550 309\n54 353\n348 167\n14 474\n68 297\n651 399\n669 633\n255 243\n571 129\n107 137\n22 579\n387 99\n213 199\n646 59\n256 519\n4 28\n152 113\n695 592\n450 164\n168 53\n692 280\n506 533\n139 553\n206 575\n105 565\n632 615\n658 84\n216 61\n254 41\n247 562\n663 339\n153 477\n156 263\n269 456\n13 549\n614 340\n268 365\n194 187\n145 596\n501 550\n90 415\n35 79\n245 688\n510 521\n569 53\n116 661\n637 321\n594 631\n414 6\n505 622\n218 212\n5 619\n286 308\n266 330\n609 694\n92 249\n374 169\n195 475\n605 166\n621 40\n500 638\n225 14\n452 648\n60 369\n558 263\n66 306\n22 393\n493 488\n237 501\n137 223\n627 99\n494 19\n528 554\n31 416\n146 469\n172 476\n653 265\n37 209\n544 6\n175 305\n547 74\n240 482\n238 658\n118 102\n131 57\n441 34\n289 467\n23 547\n639 601\n476 259\n644 380\n463 636\n34 532\n311 430\n347 122\n573 562\n47 650\n563 476\n44 619\n531 67\n243 78\n273 431\n584 376\n507 230\n608 87\n262 30\n85 32\n216 348\n317 368\n302 647\n472 616\n128 561\n597 404\n559 258\n375 574\n345 267\n127 556\n427 596\n700 42\n141 679\n264 272\n451 149\n648 3\n662 87\n489 624\n190 198\n660 468\n603 219\n434 455\n57 138\n162 124\n506 607\n336 102\n323 367\n300 669\n681 533\n527 471\n690 250\n209 605\n513 184\n461 231\n196 330\n446 484\n214 676\n118 588\n277 193\n393 549\n369 470\n294 583\n481 489\n214 378\n179 567\n521 413\n196 221\n311 200\n202 298\n138 634\n531 192\n411 86\n597 74\n594 356\n223 587\n439 59\n39 654\n432 567\n447 178\n357 473\n674 542\n655 89\n582 694\n15 143\n208 603\n192 208\n54 527\n119 370\n345 580\n611 429\n81 424\n656 112\n571 432\n312 590\n322 490\n680 459\n450 510\n116 455\n631 165\n241 344\n578 103\n581 212\n497 282\n306 535\n490 145\n294 667\n419 382\n396 26\n38 444\n176 520\n672 405\n130 443\n693 29\n95 98\n351 171\n67 31\n625 563\n110 225\n600 293\n293 349\n675 283\n114 666\n320 551\n637 684\n647 504\n611 481\n4 30\n526 77\n609 322\n478 358\n557 215\n162 288\n18 165\n539 335\n552 628\n373 28\n343 504\n577 140\n142 575\n120 595\n616 234\n175 685\n52 3\n613 690\n462 58\n457 400\n622 270\n122 530\n363 269\n231 315\n312 581\n546 182\n310 602\n458 328\n495 384\n442 428\n77 205\n338 528\n21 675\n646 518\n604 496\n553 321\n219 639\n580 340\n492 402\n",
              output: "355\n",
            },
            {
              input:
                "60\n11 41\n2 57\n9 21\n60 4\n6 51\n20 55\n40 12\n26 49\n27 13\n23 4\n49 28\n1 31\n54 9\n35 14\n22 23\n7 16\n7 45\n5 35\n17 39\n25 24\n15 34\n52 57\n3 44\n20 43\n7 32\n49 20\n48 38\n53 56\n34 7\n25 7\n13 51\n36 29\n39 46\n38 4\n56 19\n50 10\n3 27\n40 31\n39 21\n59 41\n42 36\n26 57\n14 27\n32 36\n40 58\n11 21\n45 47\n36 50\n3 33\n37 49\n47 53\n40 23\n37 31\n37 7\n8 16\n33 40\n11 34\n39 30\n18 26\n",
              output: "14\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_course-order",
      title: "Course Order",
      type: "full_source" as const,
      tags: ["medium", "Graph", "Breadth-First Search"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      judgeConfig: {
        type: "checker",
        checkerLanguage: "python",
        checkerScript:
          'tokens = team_output.split()\nanswer = judge_answer.strip()\nif tokens == ["-1"]:\n    if answer == "IMPOSSIBLE":\n        accept()\n    wrong("a valid order exists but you printed -1")\nif answer == "IMPOSSIBLE":\n    wrong("no valid order exists, expected -1")\ndata = judge_input.split()\nn = int(data[0])\nm = int(data[1])\nif len(tokens) != n:\n    wrong(f"expected {n} numbers, got {len(tokens)}")\ntry:\n    order = [int(t) for t in tokens]\nexcept ValueError:\n    wrong("output contains a non-integer token")\nseen = [False] * (n + 1)\nfor x in order:\n    if x < 1 or x > n or seen[x]:\n        wrong("output is not a permutation of 1..N")\n    seen[x] = True\npos = [0] * (n + 1)\nfor i, x in enumerate(order):\n    pos[x] = i\nidx = 2\nfor _ in range(m):\n    a = int(data[idx])\n    b = int(data[idx + 1])\n    idx += 2\n    if pos[a] >= pos[b]:\n        wrong(f"constraint violated: course {a} must come before course {b}")\naccept()\n',
      },
      statement: {
        body: "某系開設 $N$ 門課程，編號 $1$ 到 $N$，並有 $M$ 條先修限制。每條限制以 `a b` 表示：課程 $a$ 必須排在課程 $b$ 之前修。\n\n請排出一個能依序修完全部 $N$ 門課的順序。若有多種合法順序，輸出**任意一種**即可；若不存在合法順序（限制形成循環），輸出 `-1`。\n\n注意：同一條限制可能重複出現，也可能出現 $a = b$ 的限制（課程必須排在自己之前，此時必定無解）。本題由自訂 checker 評分：任何滿足所有限制的排列都會被接受。",
        inputFormat:
          "第一行兩個整數 $N$ 和 $M$（$1 \\le N \\le 10^5$，$0 \\le M \\le 2 \\times 10^5$）。\n\n接下來 $M$ 行，每行兩個整數 $a$ 和 $b$（$1 \\le a, b \\le N$），表示課程 $a$ 必須修在課程 $b$ 之前。",
        outputFormat:
          "若存在合法順序，輸出一行 $N$ 個以空白分隔的整數，為 $1$ 到 $N$ 的一個排列，代表修課順序；否則輸出一行 `-1`。答案不唯一時輸出任意一種合法順序即可。",
      },
      samples: [
        { input: "4 3\n1 2\n2 3\n1 4\n", output: "1 2 4 3\n" },
        { input: "3 3\n1 2\n2 3\n3 1\n", output: "-1\n" },
      ],
      testcases: {
        sample: {
          description:
            "Public sample cases: one solvable schedule and one cyclic (impossible) instance.",
          cases: [
            { input: "4 3\n1 2\n2 3\n1 4\n", output: "ORDER" },
            { input: "3 3\n1 2\n2 3\n3 1\n", output: "IMPOSSIBLE" },
          ],
        },
        hidden: {
          description:
            "Edge cases: no constraints, self-loop, duplicated constraints, a 300-course cycle, and a chain that forces the reverse order N..1.",
          weight: 40,
          cases: [
            { input: "1 0\n", output: "ORDER" },
            { input: "6 0\n", output: "ORDER" },
            { input: "3 1\n2 2\n", output: "IMPOSSIBLE" },
            { input: "5 4\n2 1\n5 4\n4 3\n3 1\n", output: "ORDER" },
            { input: "4 5\n1 2\n1 2\n3 2\n4 3\n1 2\n", output: "ORDER" },
            {
              input:
                "300 300\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7\n7 8\n8 9\n9 10\n10 11\n11 12\n12 13\n13 14\n14 15\n15 16\n16 17\n17 18\n18 19\n19 20\n20 21\n21 22\n22 23\n23 24\n24 25\n25 26\n26 27\n27 28\n28 29\n29 30\n30 31\n31 32\n32 33\n33 34\n34 35\n35 36\n36 37\n37 38\n38 39\n39 40\n40 41\n41 42\n42 43\n43 44\n44 45\n45 46\n46 47\n47 48\n48 49\n49 50\n50 51\n51 52\n52 53\n53 54\n54 55\n55 56\n56 57\n57 58\n58 59\n59 60\n60 61\n61 62\n62 63\n63 64\n64 65\n65 66\n66 67\n67 68\n68 69\n69 70\n70 71\n71 72\n72 73\n73 74\n74 75\n75 76\n76 77\n77 78\n78 79\n79 80\n80 81\n81 82\n82 83\n83 84\n84 85\n85 86\n86 87\n87 88\n88 89\n89 90\n90 91\n91 92\n92 93\n93 94\n94 95\n95 96\n96 97\n97 98\n98 99\n99 100\n100 101\n101 102\n102 103\n103 104\n104 105\n105 106\n106 107\n107 108\n108 109\n109 110\n110 111\n111 112\n112 113\n113 114\n114 115\n115 116\n116 117\n117 118\n118 119\n119 120\n120 121\n121 122\n122 123\n123 124\n124 125\n125 126\n126 127\n127 128\n128 129\n129 130\n130 131\n131 132\n132 133\n133 134\n134 135\n135 136\n136 137\n137 138\n138 139\n139 140\n140 141\n141 142\n142 143\n143 144\n144 145\n145 146\n146 147\n147 148\n148 149\n149 150\n150 151\n151 152\n152 153\n153 154\n154 155\n155 156\n156 157\n157 158\n158 159\n159 160\n160 161\n161 162\n162 163\n163 164\n164 165\n165 166\n166 167\n167 168\n168 169\n169 170\n170 171\n171 172\n172 173\n173 174\n174 175\n175 176\n176 177\n177 178\n178 179\n179 180\n180 181\n181 182\n182 183\n183 184\n184 185\n185 186\n186 187\n187 188\n188 189\n189 190\n190 191\n191 192\n192 193\n193 194\n194 195\n195 196\n196 197\n197 198\n198 199\n199 200\n200 201\n201 202\n202 203\n203 204\n204 205\n205 206\n206 207\n207 208\n208 209\n209 210\n210 211\n211 212\n212 213\n213 214\n214 215\n215 216\n216 217\n217 218\n218 219\n219 220\n220 221\n221 222\n222 223\n223 224\n224 225\n225 226\n226 227\n227 228\n228 229\n229 230\n230 231\n231 232\n232 233\n233 234\n234 235\n235 236\n236 237\n237 238\n238 239\n239 240\n240 241\n241 242\n242 243\n243 244\n244 245\n245 246\n246 247\n247 248\n248 249\n249 250\n250 251\n251 252\n252 253\n253 254\n254 255\n255 256\n256 257\n257 258\n258 259\n259 260\n260 261\n261 262\n262 263\n263 264\n264 265\n265 266\n266 267\n267 268\n268 269\n269 270\n270 271\n271 272\n272 273\n273 274\n274 275\n275 276\n276 277\n277 278\n278 279\n279 280\n280 281\n281 282\n282 283\n283 284\n284 285\n285 286\n286 287\n287 288\n288 289\n289 290\n290 291\n291 292\n292 293\n293 294\n294 295\n295 296\n296 297\n297 298\n298 299\n299 300\n300 1\n",
              output: "IMPOSSIBLE",
            },
            {
              input:
                "400 399\n2 1\n3 2\n4 3\n5 4\n6 5\n7 6\n8 7\n9 8\n10 9\n11 10\n12 11\n13 12\n14 13\n15 14\n16 15\n17 16\n18 17\n19 18\n20 19\n21 20\n22 21\n23 22\n24 23\n25 24\n26 25\n27 26\n28 27\n29 28\n30 29\n31 30\n32 31\n33 32\n34 33\n35 34\n36 35\n37 36\n38 37\n39 38\n40 39\n41 40\n42 41\n43 42\n44 43\n45 44\n46 45\n47 46\n48 47\n49 48\n50 49\n51 50\n52 51\n53 52\n54 53\n55 54\n56 55\n57 56\n58 57\n59 58\n60 59\n61 60\n62 61\n63 62\n64 63\n65 64\n66 65\n67 66\n68 67\n69 68\n70 69\n71 70\n72 71\n73 72\n74 73\n75 74\n76 75\n77 76\n78 77\n79 78\n80 79\n81 80\n82 81\n83 82\n84 83\n85 84\n86 85\n87 86\n88 87\n89 88\n90 89\n91 90\n92 91\n93 92\n94 93\n95 94\n96 95\n97 96\n98 97\n99 98\n100 99\n101 100\n102 101\n103 102\n104 103\n105 104\n106 105\n107 106\n108 107\n109 108\n110 109\n111 110\n112 111\n113 112\n114 113\n115 114\n116 115\n117 116\n118 117\n119 118\n120 119\n121 120\n122 121\n123 122\n124 123\n125 124\n126 125\n127 126\n128 127\n129 128\n130 129\n131 130\n132 131\n133 132\n134 133\n135 134\n136 135\n137 136\n138 137\n139 138\n140 139\n141 140\n142 141\n143 142\n144 143\n145 144\n146 145\n147 146\n148 147\n149 148\n150 149\n151 150\n152 151\n153 152\n154 153\n155 154\n156 155\n157 156\n158 157\n159 158\n160 159\n161 160\n162 161\n163 162\n164 163\n165 164\n166 165\n167 166\n168 167\n169 168\n170 169\n171 170\n172 171\n173 172\n174 173\n175 174\n176 175\n177 176\n178 177\n179 178\n180 179\n181 180\n182 181\n183 182\n184 183\n185 184\n186 185\n187 186\n188 187\n189 188\n190 189\n191 190\n192 191\n193 192\n194 193\n195 194\n196 195\n197 196\n198 197\n199 198\n200 199\n201 200\n202 201\n203 202\n204 203\n205 204\n206 205\n207 206\n208 207\n209 208\n210 209\n211 210\n212 211\n213 212\n214 213\n215 214\n216 215\n217 216\n218 217\n219 218\n220 219\n221 220\n222 221\n223 222\n224 223\n225 224\n226 225\n227 226\n228 227\n229 228\n230 229\n231 230\n232 231\n233 232\n234 233\n235 234\n236 235\n237 236\n238 237\n239 238\n240 239\n241 240\n242 241\n243 242\n244 243\n245 244\n246 245\n247 246\n248 247\n249 248\n250 249\n251 250\n252 251\n253 252\n254 253\n255 254\n256 255\n257 256\n258 257\n259 258\n260 259\n261 260\n262 261\n263 262\n264 263\n265 264\n266 265\n267 266\n268 267\n269 268\n270 269\n271 270\n272 271\n273 272\n274 273\n275 274\n276 275\n277 276\n278 277\n279 278\n280 279\n281 280\n282 281\n283 282\n284 283\n285 284\n286 285\n287 286\n288 287\n289 288\n290 289\n291 290\n292 291\n293 292\n294 293\n295 294\n296 295\n297 296\n298 297\n299 298\n300 299\n301 300\n302 301\n303 302\n304 303\n305 304\n306 305\n307 306\n308 307\n309 308\n310 309\n311 310\n312 311\n313 312\n314 313\n315 314\n316 315\n317 316\n318 317\n319 318\n320 319\n321 320\n322 321\n323 322\n324 323\n325 324\n326 325\n327 326\n328 327\n329 328\n330 329\n331 330\n332 331\n333 332\n334 333\n335 334\n336 335\n337 336\n338 337\n339 338\n340 339\n341 340\n342 341\n343 342\n344 343\n345 344\n346 345\n347 346\n348 347\n349 348\n350 349\n351 350\n352 351\n353 352\n354 353\n355 354\n356 355\n357 356\n358 357\n359 358\n360 359\n361 360\n362 361\n363 362\n364 363\n365 364\n366 365\n367 366\n368 367\n369 368\n370 369\n371 370\n372 371\n373 372\n374 373\n375 374\n376 375\n377 376\n378 377\n379 378\n380 379\n381 380\n382 381\n383 382\n384 383\n385 384\n386 385\n387 386\n388 387\n389 388\n390 389\n391 390\n392 391\n393 392\n394 393\n395 394\n396 395\n397 396\n398 397\n399 398\n400 399\n",
              output: "ORDER",
            },
          ],
        },
        hidden2: {
          description:
            "Random medium instances: a 350-course DAG and a 200-course instance containing a hidden cycle.",
          weight: 60,
          cases: [
            {
              input:
                "350 600\n299 170\n172 231\n315 83\n88 296\n128 84\n103 333\n18 345\n270 101\n84 109\n220 213\n299 156\n332 147\n46 64\n261 46\n247 96\n200 146\n55 261\n7 22\n149 122\n286 275\n161 104\n300 180\n27 343\n143 312\n143 325\n1 74\n67 68\n57 37\n182 140\n195 173\n228 291\n332 74\n59 195\n317 102\n125 155\n258 152\n51 16\n200 267\n241 54\n5 334\n274 348\n150 346\n309 177\n296 346\n318 151\n58 52\n332 101\n146 116\n228 255\n204 141\n197 253\n264 38\n167 62\n131 328\n203 246\n241 184\n41 101\n241 191\n245 98\n253 314\n81 172\n153 53\n248 237\n42 140\n195 150\n162 178\n241 115\n44 188\n33 68\n184 41\n10 28\n10 303\n329 243\n261 101\n105 70\n90 152\n265 334\n58 314\n32 72\n168 240\n202 117\n338 159\n252 326\n107 69\n264 33\n203 39\n292 296\n297 61\n80 141\n228 149\n17 196\n26 22\n83 70\n244 5\n214 34\n73 173\n31 171\n6 74\n65 235\n260 110\n37 178\n238 96\n106 271\n42 94\n138 89\n159 130\n247 22\n26 140\n90 5\n295 111\n183 236\n340 192\n125 249\n93 304\n71 348\n97 149\n71 153\n29 273\n100 191\n125 281\n209 50\n305 59\n168 122\n311 337\n342 72\n143 345\n241 10\n81 209\n97 99\n146 107\n336 33\n202 290\n331 222\n93 230\n93 47\n284 79\n193 77\n217 244\n93 33\n244 249\n253 345\n342 34\n288 151\n153 3\n258 117\n29 274\n209 141\n287 165\n269 262\n63 62\n343 24\n30 180\n150 85\n325 141\n66 182\n129 6\n36 14\n295 142\n343 253\n317 68\n294 164\n248 231\n268 109\n143 70\n204 108\n268 18\n336 226\n288 254\n284 208\n105 30\n71 181\n4 286\n97 18\n256 269\n163 167\n43 67\n128 211\n56 108\n133 87\n183 289\n142 267\n317 210\n124 218\n241 147\n233 69\n335 138\n340 348\n234 312\n225 226\n332 348\n70 148\n192 262\n39 21\n38 107\n266 150\n270 296\n235 36\n184 111\n132 242\n58 171\n203 96\n332 225\n322 244\n336 41\n168 212\n104 226\n118 221\n230 107\n71 132\n52 153\n202 70\n128 113\n37 192\n9 150\n314 47\n76 52\n8 49\n121 17\n330 79\n235 206\n245 329\n104 159\n149 96\n161 271\n201 74\n194 303\n287 238\n347 258\n72 151\n55 346\n228 261\n56 275\n264 15\n129 57\n156 232\n181 231\n196 123\n205 157\n347 251\n297 190\n313 326\n25 233\n184 77\n257 303\n279 39\n212 249\n121 231\n179 130\n235 282\n194 37\n3 22\n239 339\n229 12\n10 308\n269 14\n283 53\n38 66\n293 231\n71 171\n185 249\n25 273\n97 201\n302 138\n81 182\n318 265\n1 130\n342 108\n37 89\n36 22\n137 318\n281 191\n174 67\n33 110\n31 156\n144 85\n241 146\n323 118\n330 186\n293 249\n11 327\n29 21\n234 203\n93 33\n262 34\n294 134\n336 8\n293 126\n66 186\n46 177\n279 62\n59 207\n269 13\n270 34\n146 291\n235 296\n202 205\n50 339\n228 343\n168 35\n184 20\n209 207\n67 214\n187 25\n215 279\n246 326\n142 45\n71 182\n234 226\n315 254\n81 191\n224 101\n55 94\n228 166\n105 10\n236 3\n347 2\n271 345\n234 112\n161 198\n343 122\n222 89\n202 256\n290 238\n347 297\n327 62\n201 79\n125 176\n16 345\n207 22\n54 145\n124 201\n273 167\n36 198\n174 193\n315 54\n144 138\n329 209\n67 267\n139 192\n329 120\n161 147\n114 72\n236 342\n284 199\n304 104\n146 222\n264 43\n251 113\n293 162\n114 216\n119 58\n319 145\n52 186\n340 2\n174 305\n32 42\n65 282\n313 102\n121 144\n318 231\n158 93\n142 218\n290 350\n174 132\n72 23\n111 324\n236 143\n77 53\n65 50\n31 10\n102 101\n349 244\n119 201\n143 66\n343 280\n73 145\n101 3\n294 341\n4 188\n197 83\n88 143\n93 132\n139 178\n11 46\n233 182\n194 1\n55 17\n202 56\n106 117\n230 256\n157 164\n263 277\n276 44\n300 91\n103 50\n265 7\n36 164\n37 337\n181 333\n80 345\n163 12\n228 166\n61 334\n322 75\n65 38\n11 138\n67 20\n11 284\n128 42\n99 306\n107 159\n11 308\n75 331\n201 53\n301 23\n312 283\n320 70\n343 255\n4 34\n298 265\n167 94\n233 22\n160 128\n158 291\n37 67\n276 337\n241 198\n45 134\n325 169\n3 100\n67 309\n60 149\n308 175\n234 115\n262 45\n195 265\n33 109\n223 118\n183 113\n236 308\n283 126\n316 249\n159 226\n276 182\n276 190\n56 39\n288 62\n30 98\n68 22\n3 140\n336 145\n181 346\n241 229\n124 23\n327 89\n144 308\n298 192\n110 324\n299 350\n56 349\n202 170\n203 152\n83 207\n315 177\n29 309\n163 19\n117 164\n220 204\n217 78\n234 298\n159 91\n320 67\n60 117\n285 328\n1 326\n208 61\n66 350\n146 242\n228 128\n10 197\n138 214\n293 9\n292 63\n283 275\n176 142\n183 39\n230 30\n163 71\n295 62\n60 55\n62 152\n281 91\n242 62\n349 244\n185 249\n27 136\n76 192\n328 240\n162 46\n9 63\n269 185\n278 250\n285 232\n32 223\n73 282\n201 17\n65 173\n207 100\n110 334\n23 226\n60 139\n299 244\n95 274\n262 177\n212 21\n119 336\n294 195\n290 178\n293 84\n338 335\n120 313\n8 325\n300 223\n44 288\n136 62\n59 131\n236 46\n215 172\n323 350\n11 272\n67 69\n189 341\n236 66\n104 89\n15 69\n285 231\n280 205\n220 312\n12 69\n27 20\n305 92\n125 179\n223 206\n36 5\n319 307\n257 23\n65 157\n131 78\n127 166\n51 311\n85 166\n279 226\n33 88\n153 207\n187 267\n26 113\n167 22\n87 181\n222 98\n55 72\n65 210\n95 277\n50 32\n244 226\n215 135\n100 199\n338 24\n294 141\n161 298\n268 310\n206 134\n25 58\n224 23\n168 147\n76 227\n158 282\n302 283\n38 350\n12 255\n303 164\n173 108\n73 289\n269 109\n217 62\n81 16\n336 97\n193 38\n196 337\n268 343\n71 231\n102 85\n150 166\n253 98\n214 231\n321 148\n92 211\n156 123\n171 116\n13 39\n179 59\n",
              output: "ORDER",
            },
            {
              input:
                "200 286\n48 8\n129 182\n22 94\n183 155\n26 89\n16 162\n120 147\n40 128\n86 1\n183 128\n111 34\n16 48\n85 122\n10 75\n28 171\n91 109\n100 89\n18 141\n192 64\n48 133\n111 29\n189 154\n35 145\n108 75\n156 35\n64 162\n72 70\n39 102\n45 28\n199 181\n126 81\n178 11\n93 45\n137 166\n127 66\n135 53\n61 166\n92 47\n118 174\n11 49\n178 91\n191 121\n161 70\n7 190\n50 91\n152 156\n46 155\n160 157\n18 7\n59 79\n103 107\n116 14\n28 156\n66 44\n198 53\n160 94\n129 76\n4 75\n148 68\n146 101\n104 180\n103 141\n143 135\n17 34\n47 81\n141 146\n80 143\n101 105\n144 99\n103 13\n98 47\n158 9\n58 180\n138 174\n184 185\n6 49\n121 35\n44 169\n71 23\n68 83\n198 168\n20 118\n22 108\n114 100\n177 89\n88 27\n112 9\n135 75\n24 13\n167 14\n59 52\n74 164\n51 23\n84 49\n28 148\n92 95\n90 144\n10 37\n172 135\n17 52\n51 99\n87 92\n165 62\n199 64\n53 81\n24 83\n102 174\n126 43\n196 158\n77 62\n41 109\n165 194\n135 120\n73 147\n77 9\n59 91\n182 47\n133 98\n171 175\n16 128\n121 63\n36 57\n2 40\n165 8\n48 113\n149 139\n92 15\n135 7\n188 117\n17 82\n134 31\n138 50\n127 139\n5 176\n196 23\n39 21\n188 123\n144 89\n157 29\n106 83\n35 64\n96 118\n108 99\n10 41\n159 89\n28 37\n198 112\n198 194\n103 182\n45 154\n2 37\n119 151\n50 130\n142 27\n31 64\n146 78\n139 110\n196 114\n93 15\n155 147\n160 170\n103 78\n55 68\n94 101\n28 154\n12 78\n106 49\n176 40\n125 148\n100 143\n119 40\n87 123\n25 62\n139 34\n86 124\n141 82\n190 74\n177 14\n170 34\n137 166\n200 183\n141 63\n117 82\n193 85\n116 135\n179 123\n114 35\n33 96\n93 5\n14 54\n154 184\n74 80\n139 18\n93 151\n120 128\n24 151\n17 124\n27 123\n189 24\n135 68\n45 153\n191 109\n167 82\n15 34\n77 24\n198 97\n192 107\n129 161\n158 82\n144 60\n132 130\n11 71\n84 65\n16 4\n29 14\n113 88\n33 126\n114 76\n145 37\n129 165\n137 67\n133 13\n112 173\n2 51\n131 31\n129 64\n116 78\n52 107\n94 8\n48 126\n129 29\n146 109\n165 192\n137 81\n6 65\n15 140\n139 128\n53 152\n109 181\n3 47\n61 124\n65 112\n150 190\n149 18\n132 118\n32 76\n141 72\n96 88\n195 62\n93 154\n189 72\n157 163\n58 71\n165 143\n198 49\n5 18\n14 162\n25 120\n59 3\n20 81\n158 61\n91 81\n16 105\n27 185\n114 96\n132 40\n134 47\n157 187\n97 35\n160 143\n193 81\n146 197\n196 78\n183 92\n3 91\n94 7\n84 148\n61 31\n121 154\n117 70\n21 109\n77 101\n15 88\n186 174\n28 29\n145 47\n",
              output: "IMPOSSIBLE",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_shortest-route-plan",
      title: "Shortest Route Plan",
      type: "full_source" as const,
      tags: ["hard", "Graph", "Breadth-First Search"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      judgeConfig: {
        type: "checker",
        checkerLanguage: "python",
        checkerScript:
          'tokens = team_output.split()\nanswer = judge_answer.strip()\nif tokens == ["-1"]:\n    if answer == "-1":\n        accept()\n    wrong("a route exists but you printed -1")\nif answer == "-1":\n    wrong("no route exists, expected -1")\ndist = int(answer)\nif not tokens:\n    wrong("empty output")\ntry:\n    k = int(tokens[0])\nexcept ValueError:\n    wrong("first token is not an integer")\nif k < 1 or len(tokens) != k + 1:\n    wrong(f"expected k followed by exactly k nodes")\ntry:\n    path = [int(t) for t in tokens[1:]]\nexcept ValueError:\n    wrong("path contains a non-integer token")\ndata = judge_input.split()\nn = int(data[0])\nm = int(data[1])\nedges = set()\nidx = 2\nfor _ in range(m):\n    u = int(data[idx])\n    v = int(data[idx + 1])\n    idx += 2\n    edges.add((u, v))\n    edges.add((v, u))\nif path[0] != 1:\n    wrong("route must start at intersection 1")\nif path[-1] != n:\n    wrong(f"route must end at intersection {n}")\nfor i in range(k - 1):\n    if (path[i], path[i + 1]) not in edges:\n        wrong(f"no road between {path[i]} and {path[i + 1]}")\nif k - 1 != dist:\n    wrong(f"route uses {k - 1} roads but the shortest needs {dist}")\naccept()\n',
      },
      statement: {
        body: "圓環市有 $N$ 個路口，編號 $1$ 到 $N$，以及 $M$ 條雙向道路。每條道路連接兩個不同的路口，且任兩個路口之間至多只有一條道路（簡單圖）。\n\n你要規劃一條從路口 $1$ 走到路口 $N$ 的路線，使途中經過的道路數量最少。若有多條最短路線，輸出**任意一條**即可（本題由自訂 checker 評分）；若無法從路口 $1$ 到達路口 $N$，輸出 `-1`。",
        inputFormat:
          "第一行兩個整數 $N$ 和 $M$（$1 \\le N \\le 10^5$，$0 \\le M \\le 2 \\times 10^5$）。\n\n接下來 $M$ 行，每行兩個整數 $u$ 和 $v$（$1 \\le u, v \\le N$，$u \\ne v$），表示一條連接路口 $u$ 與路口 $v$ 的雙向道路。保證同一對路口之間至多出現一條道路。",
        outputFormat:
          "若路線存在：第一行輸出一個整數 $k$，代表路線經過的路口數；第二行輸出 $k$ 個以空白分隔的整數，依序為路線上的路口編號。路線必須以 $1$ 開頭、以 $N$ 結尾，相鄰兩個路口之間必須有道路，且 $k - 1$ 必須等於最少可能的道路數。特別地，$N = 1$ 時輸出 `1` 與只含路口 `1` 的一行。\n\n若路線不存在，輸出一行 `-1`。答案不唯一時輸出任意一條最短路線即可。",
      },
      samples: [
        { input: "5 6\n1 2\n2 5\n1 3\n3 4\n4 5\n2 3\n", output: "3\n1 2 5\n" },
        { input: "4 2\n1 2\n3 4\n", output: "-1\n" },
      ],
      testcases: {
        sample: {
          description: "Public sample cases: a reachable network and a disconnected one.",
          cases: [
            { input: "5 6\n1 2\n2 5\n1 3\n3 4\n4 5\n2 3\n", output: "2\n" },
            { input: "4 2\n1 2\n3 4\n", output: "-1\n" },
          ],
        },
        hidden: {
          description:
            "Edge cases: N=1, unreachable, a direct edge hidden behind a long detour, parallel equal-length shortest routes, a grid with many shortest paths, and a 500-node chain.",
          weight: 40,
          cases: [
            { input: "1 0\n", output: "0\n" },
            { input: "2 0\n", output: "-1\n" },
            { input: "2 1\n1 2\n", output: "1\n" },
            { input: "6 6\n1 2\n2 3\n3 4\n4 5\n5 6\n1 6\n", output: "1\n" },
            { input: "7 7\n1 2\n2 7\n1 3\n3 7\n1 4\n4 5\n5 7\n", output: "2\n" },
            {
              input:
                "40 67\n1 2\n1 9\n2 3\n2 10\n3 4\n3 11\n4 5\n4 12\n5 6\n5 13\n6 7\n6 14\n7 8\n7 15\n8 16\n9 10\n9 17\n10 11\n10 18\n11 12\n11 19\n12 13\n12 20\n13 14\n13 21\n14 15\n14 22\n15 16\n15 23\n16 24\n17 18\n17 25\n18 19\n18 26\n19 20\n19 27\n20 21\n20 28\n21 22\n21 29\n22 23\n22 30\n23 24\n23 31\n24 32\n25 26\n25 33\n26 27\n26 34\n27 28\n27 35\n28 29\n28 36\n29 30\n29 37\n30 31\n30 38\n31 32\n31 39\n32 40\n33 34\n34 35\n35 36\n36 37\n37 38\n38 39\n39 40\n",
              output: "11\n",
            },
            {
              input:
                "500 499\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7\n7 8\n8 9\n9 10\n10 11\n11 12\n12 13\n13 14\n14 15\n15 16\n16 17\n17 18\n18 19\n19 20\n20 21\n21 22\n22 23\n23 24\n24 25\n25 26\n26 27\n27 28\n28 29\n29 30\n30 31\n31 32\n32 33\n33 34\n34 35\n35 36\n36 37\n37 38\n38 39\n39 40\n40 41\n41 42\n42 43\n43 44\n44 45\n45 46\n46 47\n47 48\n48 49\n49 50\n50 51\n51 52\n52 53\n53 54\n54 55\n55 56\n56 57\n57 58\n58 59\n59 60\n60 61\n61 62\n62 63\n63 64\n64 65\n65 66\n66 67\n67 68\n68 69\n69 70\n70 71\n71 72\n72 73\n73 74\n74 75\n75 76\n76 77\n77 78\n78 79\n79 80\n80 81\n81 82\n82 83\n83 84\n84 85\n85 86\n86 87\n87 88\n88 89\n89 90\n90 91\n91 92\n92 93\n93 94\n94 95\n95 96\n96 97\n97 98\n98 99\n99 100\n100 101\n101 102\n102 103\n103 104\n104 105\n105 106\n106 107\n107 108\n108 109\n109 110\n110 111\n111 112\n112 113\n113 114\n114 115\n115 116\n116 117\n117 118\n118 119\n119 120\n120 121\n121 122\n122 123\n123 124\n124 125\n125 126\n126 127\n127 128\n128 129\n129 130\n130 131\n131 132\n132 133\n133 134\n134 135\n135 136\n136 137\n137 138\n138 139\n139 140\n140 141\n141 142\n142 143\n143 144\n144 145\n145 146\n146 147\n147 148\n148 149\n149 150\n150 151\n151 152\n152 153\n153 154\n154 155\n155 156\n156 157\n157 158\n158 159\n159 160\n160 161\n161 162\n162 163\n163 164\n164 165\n165 166\n166 167\n167 168\n168 169\n169 170\n170 171\n171 172\n172 173\n173 174\n174 175\n175 176\n176 177\n177 178\n178 179\n179 180\n180 181\n181 182\n182 183\n183 184\n184 185\n185 186\n186 187\n187 188\n188 189\n189 190\n190 191\n191 192\n192 193\n193 194\n194 195\n195 196\n196 197\n197 198\n198 199\n199 200\n200 201\n201 202\n202 203\n203 204\n204 205\n205 206\n206 207\n207 208\n208 209\n209 210\n210 211\n211 212\n212 213\n213 214\n214 215\n215 216\n216 217\n217 218\n218 219\n219 220\n220 221\n221 222\n222 223\n223 224\n224 225\n225 226\n226 227\n227 228\n228 229\n229 230\n230 231\n231 232\n232 233\n233 234\n234 235\n235 236\n236 237\n237 238\n238 239\n239 240\n240 241\n241 242\n242 243\n243 244\n244 245\n245 246\n246 247\n247 248\n248 249\n249 250\n250 251\n251 252\n252 253\n253 254\n254 255\n255 256\n256 257\n257 258\n258 259\n259 260\n260 261\n261 262\n262 263\n263 264\n264 265\n265 266\n266 267\n267 268\n268 269\n269 270\n270 271\n271 272\n272 273\n273 274\n274 275\n275 276\n276 277\n277 278\n278 279\n279 280\n280 281\n281 282\n282 283\n283 284\n284 285\n285 286\n286 287\n287 288\n288 289\n289 290\n290 291\n291 292\n292 293\n293 294\n294 295\n295 296\n296 297\n297 298\n298 299\n299 300\n300 301\n301 302\n302 303\n303 304\n304 305\n305 306\n306 307\n307 308\n308 309\n309 310\n310 311\n311 312\n312 313\n313 314\n314 315\n315 316\n316 317\n317 318\n318 319\n319 320\n320 321\n321 322\n322 323\n323 324\n324 325\n325 326\n326 327\n327 328\n328 329\n329 330\n330 331\n331 332\n332 333\n333 334\n334 335\n335 336\n336 337\n337 338\n338 339\n339 340\n340 341\n341 342\n342 343\n343 344\n344 345\n345 346\n346 347\n347 348\n348 349\n349 350\n350 351\n351 352\n352 353\n353 354\n354 355\n355 356\n356 357\n357 358\n358 359\n359 360\n360 361\n361 362\n362 363\n363 364\n364 365\n365 366\n366 367\n367 368\n368 369\n369 370\n370 371\n371 372\n372 373\n373 374\n374 375\n375 376\n376 377\n377 378\n378 379\n379 380\n380 381\n381 382\n382 383\n383 384\n384 385\n385 386\n386 387\n387 388\n388 389\n389 390\n390 391\n391 392\n392 393\n393 394\n394 395\n395 396\n396 397\n397 398\n398 399\n399 400\n400 401\n401 402\n402 403\n403 404\n404 405\n405 406\n406 407\n407 408\n408 409\n409 410\n410 411\n411 412\n412 413\n413 414\n414 415\n415 416\n416 417\n417 418\n418 419\n419 420\n420 421\n421 422\n422 423\n423 424\n424 425\n425 426\n426 427\n427 428\n428 429\n429 430\n430 431\n431 432\n432 433\n433 434\n434 435\n435 436\n436 437\n437 438\n438 439\n439 440\n440 441\n441 442\n442 443\n443 444\n444 445\n445 446\n446 447\n447 448\n448 449\n449 450\n450 451\n451 452\n452 453\n453 454\n454 455\n455 456\n456 457\n457 458\n458 459\n459 460\n460 461\n461 462\n462 463\n463 464\n464 465\n465 466\n466 467\n467 468\n468 469\n469 470\n470 471\n471 472\n472 473\n473 474\n474 475\n475 476\n476 477\n477 478\n478 479\n479 480\n480 481\n481 482\n482 483\n483 484\n484 485\n485 486\n486 487\n487 488\n488 489\n489 490\n490 491\n491 492\n492 493\n493 494\n494 495\n495 496\n496 497\n497 498\n498 499\n499 500\n",
              output: "499\n",
            },
          ],
        },
        hidden2: {
          description:
            "Random medium graphs and a 300-node graph where intersection N is unreachable.",
          weight: 60,
          cases: [
            {
              input:
                "300 550\n270 168\n74 117\n209 48\n245 77\n114 195\n7 192\n109 278\n37 44\n1 27\n287 94\n195 63\n22 56\n151 171\n133 147\n289 241\n137 201\n37 127\n107 7\n251 138\n228 274\n178 121\n16 92\n195 119\n193 182\n180 10\n254 242\n136 133\n213 237\n156 214\n154 14\n190 270\n283 40\n123 99\n108 112\n275 272\n251 33\n231 64\n190 200\n32 152\n60 93\n227 253\n151 195\n43 150\n12 44\n42 29\n276 208\n108 237\n239 68\n241 216\n113 96\n240 205\n81 25\n143 86\n141 178\n222 107\n27 100\n228 149\n206 295\n133 238\n47 154\n202 183\n17 238\n172 53\n276 291\n144 277\n97 282\n108 201\n36 293\n241 257\n41 199\n197 180\n190 45\n229 12\n168 18\n267 262\n138 167\n271 131\n106 60\n257 264\n199 70\n42 40\n121 205\n136 278\n54 48\n222 6\n44 276\n156 88\n294 83\n100 220\n84 83\n90 79\n11 134\n166 98\n110 233\n34 151\n249 253\n273 2\n277 58\n279 281\n198 156\n100 127\n187 125\n210 175\n220 80\n215 126\n270 237\n26 274\n115 269\n77 14\n145 222\n230 53\n96 29\n271 215\n30 295\n168 283\n56 229\n197 64\n30 142\n259 11\n86 132\n77 138\n85 230\n156 222\n65 232\n51 74\n54 297\n127 86\n298 264\n198 182\n116 6\n66 30\n262 290\n186 214\n205 35\n42 274\n131 95\n110 85\n123 211\n209 113\n38 111\n148 108\n146 158\n149 78\n132 34\n217 100\n109 129\n189 46\n8 146\n188 167\n83 14\n277 45\n30 174\n117 114\n177 300\n13 139\n8 162\n244 192\n140 281\n64 10\n300 210\n25 62\n192 120\n218 144\n148 208\n113 107\n138 242\n288 126\n212 256\n26 54\n280 206\n5 232\n294 194\n195 292\n12 215\n253 279\n96 235\n214 20\n91 240\n226 57\n91 72\n167 194\n15 54\n40 178\n30 223\n269 273\n266 263\n31 299\n178 50\n23 96\n151 228\n121 36\n41 115\n255 93\n33 124\n70 40\n175 95\n265 115\n76 49\n118 226\n236 195\n215 22\n147 166\n91 286\n297 89\n174 158\n4 253\n277 26\n18 204\n28 99\n170 199\n175 140\n20 104\n253 169\n76 22\n45 225\n232 235\n122 247\n48 147\n276 17\n212 44\n11 239\n116 193\n225 172\n16 116\n80 225\n59 221\n62 9\n30 241\n88 95\n91 48\n87 242\n239 258\n27 280\n279 32\n258 28\n56 279\n172 264\n86 73\n117 47\n85 61\n131 192\n95 22\n58 240\n80 208\n235 66\n236 73\n226 42\n261 179\n262 181\n149 82\n10 143\n136 95\n237 173\n243 109\n227 135\n171 89\n223 28\n115 229\n80 251\n195 74\n261 244\n38 285\n118 148\n90 127\n99 47\n170 201\n229 180\n198 127\n126 46\n63 3\n207 252\n168 86\n211 231\n225 236\n101 14\n158 161\n219 54\n183 228\n274 28\n192 60\n213 231\n155 205\n219 9\n14 116\n56 19\n129 188\n50 16\n248 246\n34 46\n221 243\n248 164\n88 76\n229 72\n65 118\n73 38\n35 200\n208 235\n255 283\n185 244\n40 41\n136 82\n299 180\n236 186\n146 239\n67 208\n43 282\n86 193\n111 165\n104 67\n68 18\n93 241\n91 211\n88 259\n14 96\n1 288\n228 156\n190 11\n193 272\n272 213\n124 278\n135 296\n296 268\n167 264\n13 105\n36 218\n139 289\n19 30\n151 220\n11 128\n168 14\n21 98\n150 13\n68 41\n262 81\n105 291\n277 275\n255 169\n241 103\n202 43\n115 142\n10 128\n214 200\n182 42\n47 76\n146 284\n241 160\n139 18\n270 286\n171 196\n42 45\n90 225\n269 194\n105 195\n206 171\n130 66\n120 211\n27 213\n20 224\n190 93\n42 53\n252 267\n224 113\n267 214\n253 12\n110 79\n277 7\n14 120\n180 142\n232 141\n265 43\n35 136\n123 139\n284 64\n85 114\n114 268\n144 103\n149 142\n9 47\n199 22\n209 91\n222 244\n128 142\n277 88\n163 137\n63 117\n281 206\n4 264\n197 61\n79 45\n129 166\n285 42\n275 219\n146 129\n156 55\n226 10\n194 145\n130 248\n93 193\n8 15\n292 193\n268 142\n167 122\n295 187\n210 222\n114 215\n48 68\n158 76\n5 297\n92 219\n296 5\n30 27\n225 191\n122 281\n101 247\n273 4\n221 199\n95 262\n261 49\n43 142\n171 110\n83 181\n197 142\n106 95\n148 149\n218 273\n181 58\n63 144\n70 85\n86 119\n87 204\n151 193\n184 159\n137 291\n10 45\n46 29\n139 150\n145 165\n133 76\n238 165\n216 46\n155 225\n98 107\n255 213\n43 154\n218 56\n55 95\n46 119\n134 123\n35 1\n270 142\n249 142\n153 147\n188 15\n45 291\n90 166\n66 56\n182 139\n117 191\n110 205\n35 83\n274 78\n160 270\n156 210\n94 296\n50 123\n140 273\n91 174\n9 159\n35 33\n55 75\n37 22\n57 144\n57 214\n291 80\n178 43\n289 97\n51 124\n49 282\n101 173\n263 25\n109 112\n98 297\n75 39\n118 203\n198 296\n164 77\n183 267\n129 99\n110 283\n279 164\n235 223\n170 269\n112 129\n110 201\n231 236\n243 150\n8 44\n155 24\n229 99\n12 159\n207 272\n153 84\n79 216\n118 51\n17 62\n180 253\n217 61\n174 118\n177 103\n178 246\n92 28\n239 229\n21 34\n60 287\n271 297\n288 242\n231 97\n58 258\n166 188\n226 120\n97 172\n23 156\n130 93\n5 298\n254 89\n285 271\n201 195\n77 9\n263 92\n140 220\n245 112\n78 133\n9 166\n207 101\n235 79\n252 203\n1 42\n149 170\n235 206\n65 285\n248 94\n194 24\n235 89\n294 157\n187 17\n136 111\n180 83\n47 220\n264 206\n126 14\n",
              output: "6\n",
            },
            {
              input:
                "40 60\n24 35\n27 8\n6 25\n8 1\n1 34\n35 21\n12 7\n23 30\n12 26\n31 25\n14 7\n22 32\n33 40\n31 3\n34 35\n20 19\n34 29\n15 31\n30 39\n11 15\n26 3\n4 5\n15 20\n17 31\n33 4\n39 38\n30 29\n27 7\n33 36\n23 40\n11 19\n9 10\n14 18\n15 5\n4 18\n12 28\n3 16\n30 22\n40 10\n31 27\n9 26\n7 9\n14 15\n1 32\n25 20\n17 7\n36 32\n7 39\n3 22\n8 2\n36 21\n3 21\n27 1\n8 38\n11 34\n19 29\n5 19\n29 1\n3 7\n19 36\n",
              output: "4\n",
            },
            {
              input:
                "300 400\n1 55\n2 124\n2 283\n3 34\n3 96\n3 192\n4 10\n4 115\n4 233\n5 147\n5 256\n6 48\n6 62\n7 285\n8 11\n8 155\n8 156\n8 227\n8 271\n9 53\n9 158\n9 205\n10 14\n10 173\n10 206\n10 212\n10 234\n11 69\n11 203\n12 190\n12 205\n13 52\n13 217\n13 239\n14 28\n14 106\n15 109\n15 182\n15 242\n16 295\n18 79\n18 142\n18 289\n19 69\n19 199\n19 215\n19 224\n19 273\n19 297\n20 32\n20 94\n20 206\n20 280\n21 63\n21 65\n21 71\n22 64\n22 279\n23 234\n23 259\n24 37\n24 265\n25 217\n26 155\n26 168\n26 219\n27 142\n27 228\n28 150\n28 228\n29 165\n30 97\n30 157\n30 258\n31 128\n31 142\n31 146\n31 185\n33 76\n33 119\n33 297\n33 298\n34 88\n34 204\n35 39\n35 81\n36 130\n36 285\n38 282\n38 286\n38 296\n40 164\n40 187\n40 196\n40 237\n41 67\n41 109\n44 138\n44 157\n44 209\n44 241\n44 261\n45 77\n45 282\n46 276\n47 178\n48 61\n48 71\n48 117\n48 133\n48 220\n49 186\n50 80\n50 168\n50 273\n51 133\n52 67\n52 163\n52 169\n52 180\n53 63\n53 89\n53 219\n53 241\n53 252\n54 102\n54 168\n56 142\n57 166\n58 227\n59 66\n59 149\n59 241\n60 273\n60 290\n61 82\n62 186\n62 190\n62 206\n63 279\n64 78\n65 104\n65 201\n65 211\n65 252\n65 293\n66 242\n67 70\n67 159\n67 196\n67 288\n67 294\n68 86\n68 138\n69 86\n69 237\n69 240\n70 132\n70 298\n71 202\n71 248\n72 134\n72 244\n73 194\n73 224\n74 221\n76 149\n76 152\n76 220\n76 277\n77 173\n77 247\n78 97\n78 147\n78 188\n78 230\n78 275\n79 166\n79 190\n81 199\n81 207\n82 163\n82 205\n83 86\n83 99\n83 100\n84 93\n84 152\n84 257\n85 144\n85 149\n85 200\n86 188\n88 108\n88 120\n88 217\n89 121\n89 180\n90 173\n90 235\n91 196\n91 214\n92 121\n92 177\n93 121\n93 238\n95 136\n95 168\n95 212\n95 246\n96 295\n97 289\n97 292\n98 185\n99 136\n100 249\n101 137\n101 166\n101 167\n101 180\n101 216\n101 223\n101 271\n102 166\n102 269\n103 155\n103 172\n103 293\n104 213\n104 244\n106 115\n106 145\n106 245\n107 237\n108 228\n109 147\n109 163\n109 205\n110 117\n110 124\n110 217\n110 233\n111 207\n111 258\n112 187\n112 223\n113 179\n114 283\n115 257\n116 221\n116 288\n117 251\n118 188\n118 207\n118 242\n119 145\n119 235\n119 262\n120 158\n120 173\n120 230\n120 238\n120 239\n120 284\n122 251\n123 155\n124 134\n125 134\n125 226\n125 275\n126 224\n126 275\n128 260\n130 132\n131 204\n131 291\n132 182\n132 272\n134 273\n135 212\n135 243\n136 261\n136 292\n136 297\n138 241\n139 199\n140 209\n140 242\n141 174\n142 150\n143 241\n145 158\n145 215\n146 198\n146 233\n146 244\n147 210\n147 251\n147 253\n147 287\n148 192\n149 215\n149 246\n150 165\n151 172\n151 181\n153 174\n153 272\n156 200\n156 266\n157 196\n157 285\n159 176\n159 196\n159 245\n159 273\n160 181\n160 213\n160 249\n160 256\n160 296\n161 177\n161 179\n162 208\n162 260\n164 240\n164 243\n164 288\n167 235\n168 260\n169 212\n170 215\n170 236\n171 192\n175 181\n176 198\n176 250\n179 202\n181 263\n181 283\n183 195\n184 205\n184 292\n185 187\n187 274\n188 216\n189 268\n191 199\n193 284\n195 232\n195 291\n196 273\n196 276\n197 231\n198 199\n198 251\n198 293\n199 277\n202 264\n203 205\n205 211\n206 207\n207 229\n207 232\n207 261\n209 299\n210 236\n211 231\n211 241\n213 230\n215 228\n218 280\n219 277\n220 232\n221 260\n223 283\n223 286\n225 233\n226 291\n228 272\n231 255\n232 259\n233 294\n234 285\n239 247\n242 253\n243 253\n248 269\n249 259\n250 264\n250 279\n254 278\n256 277\n260 271\n266 287\n272 281\n276 278\n281 287\n284 299\n289 295\n",
              output: "-1\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_longest-increasing-subsequence",
      title: "Longest Increasing Subsequence",
      type: "full_source" as const,
      tags: ["medium", "Dynamic Programming", "Binary Search"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "給定一個長度為 $N$ 的整數序列 $a_1, a_2, \\ldots, a_N$。\n\n請求出其中最長的「嚴格遞增子序列」的長度。子序列是指從原序列刪除任意個（可為零個）元素後，剩餘元素保持原本相對順序所形成的序列；嚴格遞增表示子序列中每個元素都必須嚴格大於前一個元素（相等不算）。",
        inputFormat:
          "第一行包含一個整數 $N$（$1 \\le N \\le 10^5$）。\n第二行包含 $N$ 個以單一空白分隔的整數 $a_1, a_2, \\ldots, a_N$（$-10^9 \\le a_i \\le 10^9$）。",
        outputFormat: "輸出一行，包含一個整數，表示最長嚴格遞增子序列的長度。",
      },
      samples: [
        { input: "6\n10 9 2 5 3 7\n", output: "3\n" },
        { input: "5\n4 4 4 4 4\n", output: "1\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "6\n10 9 2 5 3 7\n", output: "3\n" },
            { input: "5\n4 4 4 4 4\n", output: "1\n" },
            { input: "8\n1 3 2 4 3 5 4 6\n", output: "5\n" },
          ],
        },
        hidden: {
          description: "小規模測資與邊界情形",
          weight: 40,
          cases: [
            { input: "1\n5\n", output: "1\n" },
            { input: "10\n10 9 8 7 6 5 4 3 2 1\n", output: "1\n" },
            { input: "10\n1 2 3 4 5 6 7 8 9 10\n", output: "10\n" },
            { input: "12\n7 7 7 7 7 7 7 7 7 7 7 7\n", output: "1\n" },
            { input: "15\n3 1 4 1 5 9 2 6 5 3 5 8 9 7 9\n", output: "6\n" },
            {
              input:
                "10\n-1000000000 1000000000 0 -5 -5 7 7 -1000000000 999999999 1000000000\n",
              output: "5\n",
            },
          ],
        },
        hidden2: {
          description: "較大規模隨機測資",
          weight: 60,
          cases: [
            {
              input:
                "638\n44 -5 38 44 33 17 -47 9 49 -19 33 -44 -30 -36 -3 10 -19 -2 19 -37 23 -19 -49 43 -23 2 -15 -27 48 -1 -30 47 -41 -33 29 29 6 -34 -34 -50 -50 -24 49 -23 -29 -29 -13 -10 -25 19 36 30 -24 -27 38 -25 -1 -12 -48 -4 3 -29 -32 -17 -42 -8 -12 27 25 -50 26 36 40 -7 -42 -11 -5 -11 11 39 -10 -27 11 10 40 -28 -43 -18 -48 45 -5 1 -48 20 50 3 -4 -2 24 -49 7 -45 40 -27 29 -25 -35 46 -19 9 -6 15 -5 17 -18 49 9 -37 25 45 49 -3 -13 -46 5 -39 -24 -7 15 28 -4 -32 -7 -15 39 19 -39 -11 37 -10 -11 -28 -40 30 -31 42 38 -11 11 -30 42 -44 -40 26 18 1 -46 -20 44 26 -6 -18 8 33 3 -32 -43 31 -46 13 -8 -24 -34 43 22 -34 30 50 2 -37 -29 5 -3 -31 -43 3 -13 -32 8 29 -29 16 8 12 38 43 -10 11 -15 -13 10 1 -32 -36 -2 18 -28 30 13 -7 -27 -39 12 -16 15 50 20 14 -4 -42 50 49 -5 38 25 34 -46 47 -11 -4 21 40 35 -15 12 -17 48 38 41 -13 -7 33 -28 24 -49 10 20 49 -18 -9 35 -15 9 -14 14 32 36 -5 -6 -15 32 -6 44 2 -6 -28 38 7 -4 -8 16 -32 17 -29 -25 -4 11 -14 38 -40 42 35 43 3 -29 28 49 24 16 35 3 -12 29 20 49 31 -16 42 -47 -25 -30 25 6 29 33 -27 -22 47 37 -27 30 41 -45 10 -22 -29 -44 -33 -36 -10 -27 11 -26 20 -46 3 9 -6 -2 34 28 -41 25 -24 -20 41 -3 -50 -6 1 -15 2 -36 38 20 -3 -46 20 28 -12 -38 -13 19 15 -7 24 -13 -5 -34 3 2 22 32 18 -3 9 -32 -30 26 -2 22 11 -25 -33 27 -39 -6 34 -50 -2 -37 -9 22 28 19 -32 -9 30 22 -2 4 5 -22 13 -13 11 40 -2 -1 -30 26 26 -17 44 -12 13 -18 3 -48 -10 -11 12 -14 -32 11 -47 -35 34 29 6 -19 -13 -45 50 -33 0 -49 11 18 21 -15 -19 10 50 -46 -19 12 -16 -31 42 -14 -13 13 27 10 16 32 27 45 -35 -48 47 -34 -12 -14 18 40 -7 28 -13 43 17 -47 9 -6 -4 37 45 25 -34 -46 -50 -18 20 8 37 -37 37 19 -26 -49 4 49 4 26 23 38 40 30 33 11 -1 10 0 37 42 -25 -13 9 47 -42 -12 -50 38 49 5 24 -14 32 49 10 -11 -32 -29 11 38 20 13 -8 18 -31 4 24 19 -44 -42 43 -21 -16 -40 -42 34 -47 -8 42 4 -42 1 39 12 -44 -35 -35 -22 28 32 -36 41 -33 -13 40 6 -31 -27 28 -27 2 -30 -42 29 -23 -45 21 -37 34 -2 45 -41 -15 -43 23 23 -35 45 1 29 -33 -49 5 -39 -10 37 26 12 12 -5 33 -3 -43 -33 39 -13 -31 22 30 36 14 -13 21 20 29 -22 -17 -42 20 -20 -18 46 -14 16 -33 -20 -3 8 44 -1 -28 -34 41 -48 33 -7 -40 23 35 -46 -39 -35 14 26 8 -20 -1 9 11 -9 -37 17\n",
              output: "39\n",
            },
            {
              input:
                "741\n66 172 162 25 83 146 43 6 105 104 19 26 32 81 121 148 115 105 53 51 81 160 174 85 84 109 23 160 132 125 103 20 52 146 62 8 51 24 21 48 64 177 72 78 176 65 41 159 30 5 68 180 59 56 146 60 14 3 165 158 76 71 35 177 165 85 153 184 114 39 163 70 142 110 40 42 103 180 30 176 32 148 109 88 57 29 155 13 132 49 111 44 44 20 29 75 0 166 80 172 102 117 135 185 13 170 42 30 116 142 85 3 18 146 27 23 85 65 164 21 169 77 169 11 6 49 56 131 129 179 3 40 6 170 134 34 79 32 107 70 27 99 25 55 61 50 57 24 77 32 142 99 35 165 21 114 124 0 45 48 162 79 103 24 75 52 93 159 76 36 173 185 25 1 70 15 99 95 72 101 118 25 17 147 120 54 2 179 135 17 140 159 87 182 3 45 71 75 155 25 0 10 54 52 158 103 176 153 20 149 92 72 113 12 167 35 159 96 143 101 100 65 0 117 23 148 125 81 58 51 74 115 86 97 52 159 13 89 34 23 94 5 30 122 61 138 36 75 1 35 174 93 89 135 37 4 58 110 134 114 63 100 99 176 137 179 74 129 155 166 183 75 158 21 167 126 68 90 32 119 168 60 124 33 90 83 160 143 36 163 179 184 174 175 137 31 68 165 9 135 48 94 100 54 139 129 180 78 120 161 45 34 32 70 6 145 171 19 43 86 70 62 169 81 21 37 67 66 24 33 77 19 126 10 129 11 121 120 100 182 130 171 24 167 34 180 79 128 140 107 43 116 113 175 132 123 39 45 48 51 74 30 48 114 102 119 17 78 162 136 29 55 184 52 78 53 129 73 111 121 24 93 132 62 47 143 146 95 74 38 2 85 96 37 72 131 32 130 16 45 152 129 133 9 29 71 106 144 22 136 49 154 175 113 113 104 183 11 183 175 44 44 24 127 180 153 144 160 76 40 62 70 59 30 24 140 177 137 151 114 110 85 60 138 42 130 14 115 22 129 6 73 7 65 91 67 78 136 102 162 173 16 173 93 3 15 147 45 40 58 163 18 112 107 10 0 154 55 99 138 143 118 23 73 118 178 169 134 75 84 26 114 48 38 159 162 30 8 90 47 169 51 46 57 74 0 31 13 57 109 129 162 155 96 171 70 156 87 164 153 139 33 81 13 2 23 130 129 134 121 45 37 53 140 89 32 37 74 25 43 141 77 119 52 21 30 39 6 158 39 130 90 78 93 5 66 183 6 114 0 81 73 179 120 116 79 13 6 8 21 5 130 78 107 71 117 159 71 21 164 109 180 18 6 100 4 66 3 174 134 150 17 173 1 80 184 26 126 110 26 85 132 6 3 175 30 144 168 163 8 159 58 115 63 89 95 143 17 181 133 30 183 16 62 64 148 115 118 127 11 10 167 118 21 46 40 148 133 159 55 143 159 154 145 62 51 61 73 10 33 88 148 185 152 116 80 112 126 0 76 155 30 92 50 72 37 152 149 182 146 135 45 15 59 65 45 132 8 128 2 161 27 48 27 121 117 132 69 58 15 111 63 72 84 79 62 89 125 109 171 16 52 52 55 184 127 119 167 83 38 116 169 137 102 16 6 36 121 55 145 149 130 12 123 183 65 0 27 131 118 10 57 30 169 4 34 18 57 99 134 7\n",
              output: "46\n",
            },
            {
              input:
                "730\n-806 -996 -994 -991 -983 -983 -979 621 -974 -969 -181 237 -655 -961 -952 -943 -940 -938 -936 -934 -932 726 180 -430 -667 -906 -521 -899 -894 -882 -874 -872 -871 -264 -861 688 -857 -853 -852 -38 -796 -847 -845 -839 -835 -834 -832 141 -826 -826 183 -813 -809 -1000 -827 -258 -802 -801 -797 -796 214 -788 -778 -773 -772 -770 784 -767 87 -764 -763 -753 155 -745 -742 -742 -739 -392 -731 -731 -727 -82 -721 -74 -717 906 734 -711 -711 -710 -709 300 856 -57 -702 -356 -700 176 -690 -513 -686 -685 -684 -682 -679 -678 -526 650 -671 978 936 -664 -658 73 -655 -965 -654 -651 84 -676 -643 -641 477 -629 -629 994 -626 -625 -563 -619 -589 -616 -612 -463 180 -603 -599 -595 -595 -594 -712 -588 -577 606 -564 -563 -153 -563 282 -703 -553 -552 -78 -538 -537 -534 -466 -533 -769 -529 -751 230 -527 784 -525 -525 -522 -269 339 -515 -236 -850 -687 -512 -511 688 -505 673 -500 -499 -497 -494 267 -490 -487 -485 -483 -481 -480 -480 23 -479 -472 180 -451 -609 -460 -455 -453 -533 -447 -479 -436 -435 -433 -431 -924 678 -203 -423 98 -421 -420 -419 -520 -413 -412 -407 -404 -401 -399 -399 -393 -901 -382 -382 -380 -377 -375 -374 -374 -372 -371 897 -368 -364 328 -359 -701 -353 -348 -529 689 -333 -331 -329 391 -327 283 -319 -314 -312 -306 -303 -302 -302 -301 355 -298 -297 -295 -283 -278 242 18 -269 -731 -267 -265 -864 -804 -256 -88 -254 -249 239 -242 -240 -240 -239 -515 -230 70 -225 -220 -220 -218 -424 -199 -198 88 -196 -189 -187 -183 -967 -174 -170 586 140 913 -514 977 -621 -146 -142 -138 -136 -115 -112 -440 -111 -111 -110 178 -98 -97 -94 -91 222 -255 980 64 -82 827 -77 -76 -720 -72 -68 -553 -55 560 -43 -42 -40 -159 -608 -37 703 -29 -27 -27 830 -26 -26 -23 -18 -15 -10 -6 -5 1 2 6 12 16 18 -270 -112 31 32 312 35 42 42 42 53 58 58 62 63 396 67 68 68 -491 73 -196 81 862 -806 865 -655 89 91 -422 100 103 -931 108 110 110 -506 129 -162 -649 145 146 151 154 155 337 160 164 173 -691 -102 -38 -469 635 -817 184 551 186 190 951 112 201 206 -848 220 221 221 -91 228 230 -528 231 234 234 237 -967 835 194 -244 -272 245 250 251 252 319 264 -645 769 269 272 273 278 322 282 -319 566 292 293 295 295 297 -707 304 305 32 313 313 318 255 507 804 323 325 326 327 795 329 331 336 -53 864 961 349 731 353 354 -298 362 362 366 370 372 886 373 378 381 387 -329 392 742 -724 396 404 405 407 411 417 434 439 441 441 445 534 448 455 457 461 473 476 476 -633 477 480 482 483 493 496 500 628 321 511 513 513 514 521 521 521 525 529 530 531 532 532 447 539 545 549 185 555 556 557 882 564 566 566 790 568 569 569 576 580 581 581 583 -163 604 590 594 594 595 601 604 604 587 -576 607 607 610 611 620 -975 801 625 627 628 -931 630 630 635 502 636 643 645 -672 651 661 -504 674 677 677 -425 680 686 -858 238 -360 690 -156 696 703 -35 854 705 709 716 719 723 -336 724 104 726 730 731 350 733 733 -616 736 738 739 238 741 395 745 755 760 765 767 976 269 772 773 780 782 783 -530 -229 785 786 290 723 800 623 -562 812 813 814 814 815 816 818 825 -548 -27 832 739 841 851 853 853 705 -705 951 858 861 83 -417 -766 868 872 873 875 877 879 881 -338 885 373 888 893 893 894 894 -371 -715 908 908 -159 924 935 -665 936 937 939 940 941 942 193 857 952 956 959 343 962 965 966 967 969 969 971 767 691 -911 -83 981 981 983 984 987 994 -627 997 999\n",
              output: "444\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_edit-distance",
      title: "Edit Distance",
      type: "full_source" as const,
      tags: ["medium", "Dynamic Programming", "String"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "給定兩個僅由小寫英文字母組成的字串 $s$ 與 $t$。你可以對 $s$ 重複進行以下三種操作，每次操作計為一步：\n\n1. 在任意位置插入一個字元。\n2. 刪除任意一個字元。\n3. 將任意一個字元取代為另一個字元。\n\n請求出將 $s$ 轉換成 $t$ 所需的最少操作步數。",
        inputFormat:
          "第一行包含字串 $s$（$1 \\le |s| \\le 2000$）。\n第二行包含字串 $t$（$1 \\le |t| \\le 2000$）。\n兩字串皆僅由小寫英文字母 `a`–`z` 組成。",
        outputFormat: "輸出一行，包含一個整數，表示將 $s$ 轉換成 $t$ 的最少操作步數。",
      },
      samples: [
        { input: "kitten\nsitting\n", output: "3\n" },
        { input: "abc\nadc\n", output: "1\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "kitten\nsitting\n", output: "3\n" },
            { input: "abc\nadc\n", output: "1\n" },
            { input: "flaw\nlawn\n", output: "2\n" },
          ],
        },
        hidden: {
          description: "小規模測資與邊界情形",
          weight: 40,
          cases: [
            { input: "algorithm\nalgorithm\n", output: "0\n" },
            { input: "aaaa\nzzzz\n", output: "4\n" },
            { input: "a\nabcdefghijklmnopqrstuvwxyz\n", output: "25\n" },
            { input: "a\na\n", output: "0\n" },
            { input: "hello\nhell\n", output: "1\n" },
            { input: "abcdef\naxcxex\n", output: "3\n" },
          ],
        },
        hidden2: {
          description: "較大規模測資",
          weight: 60,
          cases: [
            {
              input:
                "abcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcdeabcde\nabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabdeabde\n",
              output: "700\n",
            },
            {
              input:
                "abbaabbaabbbaaabaaaababbbbbbabaaababbbbbbbabababaabbaabbababaabbbaaabbbaabaaaaabbbaabbbabbbbabbabbbbbabbabaabbbbbbaaabbbbbababbbbbaaababababaabbabaababbaaaababbababbbbbbbbbabaaabbaabbbaabaaaaabaabaabaabaababbabaaaaaabaabbababbabbaaaaaaabaabbababbbbbbabbaaabaaabbbababbbbbbaaabababaabbbabababaabaabaaabaabaaabbbaaaaaabaaaaabbbbbbbabababbabaaabbbaabaababbbababbbaababbabbababababaaaabaabaaabaababaaaabbabbbaabbbbbaabbababababbabbbbbababbabaaabbaaabbbabbbaaaabbabbbaaabbabbbbabbaabaaaaabbaabaaaabbbabbbbbbbbaaaaababaaaababaabaaabaababbbbaaaabaaababbaabaaabbbababbabbbbababbbbbbaaabbabaaaaabaaaaabbaaabbbbaaababbaaaabbaababaabbbbbababbbaabaaaaaaaabaababbbbabbbabababbbabbabbbabbbbabbaaaabaabaaabbbbaaababbabaaaaaaaaabaabbabaaaaaaabaabbaabbbbabbbaaabbabbababbaaabababbababaaabbbabbbbabaaaaababaaabbbabbabaabbbbaaabbbbabbbbabbbabbbbaaaaaaaaaabbbabaaabbbaabbbabbbbaabaaaabbabaaaababbbbabaaaabbbbbbbbabaabbabbabababbabababbabbabbbabaabbbbaabbbabaaaaaababbbbbbaaabaaaabbaabaaabaaaaaababbaabaaaababbaaababaabbabbabbbbbbabbabababbaaaabaaaaabbbabbbaabbbbbbbbbbaaababbbbabbabaabbbaabbaabaababbbabbbbbbababaabaaaaabbbaaabbbabbaba\nabbabbaabbbaaabaaaababbbbbabaaababbbbbbbabababaabbaabbbbabaabbbaaabbbaabaaaaabbbaabbabbbabbabbbbbabbabaabbbbbbabbbbbbbbabbbbbaaababababaabbabaababbaaabababbababbbabbbbbabaaabbaabbbaabaaaaabbbaabaaabaababbabaaaaaabaabbababbbbbaaaaaaabaaabababbbbbabbaaabaaabbbababbbbbbbaaabababaabbaababababbaaaaabaabaaabbbaaaaaabaaaaabbbbbbbababbbbabaaabbbaaaabaababbbbabbbaaabbabbababaabbaaaaabaababaaabababaaabbabbbaabbbbbabbababbababbabbbbbababaabaaabbababbbababaaaababbabbaaabbabbbbabbaabaaaaabbabaaaaabbbabbbbbbbbaaaaabababaababaabaaabaababbbaaaabaababbaabaaababababbabbabbbbbbbaaabbabaaaaabaaabbaaabbbbaababbaaaabbaababaabbbbbbababbbaabaaaaaaaabaababbbababbababbbbababaabbabbbbabbbaaaabaabaabbbbbaaababbabaabaaaaaaaabaabaaaaaaaabbaabbaabbbbabbbaaaabbabbababbbaabababbababaaabbbabbbabaaaabbabaaabbbabbaabaababbbaaaabbbbababbbbabbbabbbbaaaaaaaaaabbbabaaabbbaabbbbabbaabaaaaaabbabaaababbbbbabaaaabbbbbbbbbabaabbabbababbabbabbababbabbabbbabaabbbbaababaaaaaababbbbbbaaabaababbaabaaabaaaaaababbaabbaababbaaaabaabbababbbbbbaababababbabaabaaababbbabbbaabbabbbabbaaabaabbbbabbbbababbbaabbaabababbbababbbbababaabaaaaabbbaabbbababbaba\n",
              output: "102\n",
            },
            {
              input:
                "cbbacdacadbddbbbaabadacbbdacbdccabadaddbabdaaabbcaabaadbdadbabbaacbcaadbbacacacdbdbadcadabbdccaccaaadddcbadbadccbcbcaabcbabaaadbdcaccbdcbacaaddbdbcdcaacbbabbabbdddabdcaadcacabbaaddadaacbdbcdbaaaddaababaaacddaacacaddbddbacbdbbbaaaaaacaadbcabacbadcaadacdcbacbcabcdacaacdbdcdcddbaccdddddbcdacabcabbcbacddbcaaddbcadacbabacaabcbadddbcccbcdbbbacacddaccbddbbcbcaccabadbcbbdbbdaacdcacdddbabaccbdbacbbaabccbccdaadbddacbbbdbdadbcddbadccccabadcababdacccbabdccccbabbaabacdccaaddbabbdcbcdabccdccddaacbdccdcadbaacddacdadcbdbabcaaabdadcbacbdbbcdcdcdadaadcadbbdddaacdacbcacdccbbcccdaccaccaddacdbdcddabbaaaacadcadbbacaabcccbbbdbdcdbdaccbbadbddaaddcbbcbcaaaacdcbdadccbcacbcbdaabbabadbdcdadbcabbdcacacaabdbccbbcababadadaabccadbbaaabcadbccaccbaacabcacbbaadacabbbddcddbbdcdadbbdbdadcbcd\ncbbacdacadbdbbbbabadacbbdacbdccabadaddbabdaaabbaabaaaddcdbabbaaccbcadbbadacacdbdbadcdabbdccaccaaaaddccbadbdccbcbccabcbbaaadbdcaccbdcbacaaddbdbcdcaacbbabbabbddabdcaadcacabbaadaadaacdbcbaaadaababaaacddaacacaddbdaacbdbbaaaaacacdadbcababadcaadcacdcbacbcabcdcaacdbdcdaddbaccddddddbbcdacabcabbcbacddbcaaddbbadacbabacacbcaddbbcccbdbbbacacadbaccbddbbcbacacabadbbbdbbdacadcaadddbabaccbcbacbbaabcabcdaadbddccbbbabdaadbcddbadcccabadcababdacccbabdccccbabbcaabacdccaaddbbabbdcbcdabccdccddaacbdccdcadbaaddacdadcbdbabcaaabcdadcbaccdbcdcdcdadaadcadbbdddaacdacbcacdccbbcccdacacaddacdbdcddabbaaaacadadbbacaabcccbbabdbddbcbbadbddaaddcbbcbcaaaacdcbdadccbcacbcadabbabadbdcdadbcabdcaaacaabcdbccbbcababadadaabbccacabbacaabcadbccaccbaacabcacbdbaadacabbbdcdddbbdcdadabdabdadcbcd\n",
              output: "79\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_coin-change-min",
      title: "Fewest Coins",
      type: "full_source" as const,
      tags: ["medium", "Dynamic Programming"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "某國的貨幣系統共有 $N$ 種硬幣面額 $c_1, c_2, \\ldots, c_N$，每種面額的硬幣都有無限多枚。輸入中同一面額可能重複出現，重複的面額視為同一種硬幣。\n\n給定目標金額 $A$，請求出湊出恰好 $A$ 元所需的最少硬幣數量。若無論如何都湊不出恰好 $A$ 元，輸出 `-1`。",
        inputFormat:
          "第一行包含兩個整數 $N$ 與 $A$（$1 \\le N \\le 50$，$0 \\le A \\le 10^5$）。\n第二行包含 $N$ 個以單一空白分隔的整數 $c_1, c_2, \\ldots, c_N$（$1 \\le c_i \\le 10^5$），表示各硬幣面額；面額可能重複。",
        outputFormat:
          "輸出一行，包含一個整數：湊出恰好 $A$ 元所需的最少硬幣數量；若湊不出則輸出 `-1`。注意當 $A = 0$ 時答案為 `0`。",
      },
      samples: [
        { input: "3 6\n1 3 4\n", output: "2\n" },
        { input: "2 7\n2 4\n", output: "-1\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "3 6\n1 3 4\n", output: "2\n" },
            { input: "2 7\n2 4\n", output: "-1\n" },
            { input: "4 11\n1 2 5 10\n", output: "2\n" },
          ],
        },
        hidden: {
          description: "小規模測資與邊界情形",
          weight: 40,
          cases: [
            { input: "1 0\n7\n", output: "0\n" },
            { input: "3 11\n10 6 4\n", output: "-1\n" },
            { input: "3 14\n1 7 10\n", output: "2\n" },
            { input: "1 9\n3\n", output: "3\n" },
            { input: "1 10\n3\n", output: "-1\n" },
            { input: "5 12\n5 5 2 5 2\n", output: "3\n" },
            { input: "3 5\n7 100000 5\n", output: "1\n" },
          ],
        },
        hidden2: {
          description: "較大規模測資",
          weight: 60,
          cases: [
            { input: "1 100000\n1\n", output: "100000\n" },
            {
              input:
                "50 99999\n62 93 66 81 88 70 95 52 83 92 100 56 91 63 73 64 84 67 80 82 54 59 76 60 61 96 71 77 51 97 78 57 94 55 89 58 69 75 86 90 98 53 85 72 68 87 74 99 79 65\n",
              output: "1000\n",
            },
            {
              input:
                "25 99346\n33938 67014 63692 53076 39756 62470 46932 76466 28632 66152 18256 36942 18318 99066 12430 81052 32836 69806 92430 78894 19264 40652 12946 95662 9666\n",
              output: "5\n",
            },
            {
              input: "9 74606\n33433 15456 64938 99741 58916 61899 85406 49757 27520\n",
              output: "-1\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_longest-common-subsequence",
      title: "Longest Common Subsequence",
      type: "full_source" as const,
      tags: ["medium", "Dynamic Programming", "String"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "給定兩個僅由小寫英文字母組成的字串 $s$ 與 $t$。\n\n子序列是指從字串刪除任意個（可為零個）字元後，剩餘字元保持原本順序所形成的字串，不必連續。請求出同時是 $s$ 的子序列、也是 $t$ 的子序列的字串中，最長者的長度。",
        inputFormat:
          "第一行包含字串 $s$（$1 \\le |s| \\le 2000$）。\n第二行包含字串 $t$（$1 \\le |t| \\le 2000$）。\n兩字串皆僅由小寫英文字母 `a`–`z` 組成。",
        outputFormat:
          "輸出一行，包含一個整數，表示 $s$ 與 $t$ 的最長公共子序列長度；若兩字串沒有任何公共字元，輸出 `0`。",
      },
      samples: [
        { input: "axbxcx\naybycy\n", output: "3\n" },
        { input: "abcde\nace\n", output: "3\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "axbxcx\naybycy\n", output: "3\n" },
            { input: "abcde\nace\n", output: "3\n" },
            { input: "programming\ngaming\n", output: "6\n" },
          ],
        },
        hidden: {
          description: "小規模測資與邊界情形",
          weight: 40,
          cases: [
            { input: "abc\nxyz\n", output: "0\n" },
            { input: "abcdefgh\nacegh\n", output: "5\n" },
            { input: "banana\nbanana\n", output: "6\n" },
            { input: "a\nb\n", output: "0\n" },
            { input: "a\na\n", output: "1\n" },
            { input: "abcabcabc\ncbacbacba\n", output: "5\n" },
          ],
        },
        hidden2: {
          description: "較大規模測資",
          weight: 60,
          cases: [
            {
              input:
                "abababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababab\nbabababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababa\n",
              output: "1999\n",
            },
            {
              input:
                "abbaabbaabbbaaabaaaababbbbbbabaaababbbbbbbabababaabbaabbababaabbbaaabbbaabaaaaabbbaabbbabbbbabbabbbbbabbabaabbbbbbaaabbbbbababbbbbaaababababaabbabaababbaaaababbababbbbbbbbbabaaabbaabbbaabaaaaabaabaabaabaababbabaaaaaabaabbababbabbaaaaaaabaabbababbbbbbabbaaabaaabbbababbbbbbaaabababaabbbabababaabaabaaabaabaaabbbaaaaaabaaaaabbbbbbbabababbabaaabbbaabaababbbababbbaababbabbababababaaaabaabaaabaababaaaabbabbbaabbbbbaabbababababbabbbbbababbabaaabbaaabbbabbbaaaabbabbbaaabbabbbbabbaabaaaaabbaabaaaabbbabbbbbbbbaaaaababaaaababaabaaabaababbbbaaaabaaababbaabaaabbbababbabbbbababbbbbbaaabbabaaaaabaaaaabbaaabbbbaaababbaaaabbaababaabbbbbababbbaabaaaaaaaabaababbbbabbbabababbbabbabbbabbbbabbaaaabaabaaabbbbaaababbabaaaaaaaaabaabbabaaaaaaabaabbaabbbbabbbaaabbabbababbaaabababbababaaabbbabbbbabaaaaababaaabbbabbabaabbbbaaabbbbabbbbabbbabbbbaaaaaaaaaabbbabaaabbbaabbbabbbbaabaaaabbabaaaababbbbabaaaabbbbbbbbabaabbabbabababbabababbabbabbbabaabbbbaabbbabaaaaaababbbbbbaaabaaaabbaabaaabaaaaaababbaabaaaababbaaababaabbabbabbbbbbabbabababbaaaabaaaaabbbabbbaabbbbbbbbbbaaababbbbabbabaabbbaabbaabaababbbabbbbbbababaabaaaaabbbaaabbbabbaba\nabaababaaabbaaababbaababbaaaababbbbbabababbabbabaabbaabaaaabbbbabbabbbbbbbbabbababbbbbaabbbbbbababbabbaaabababaaabbabaabbaababababbbbbbbaaabbbbaabaaaabaaaaaaabababbaaaabaaabbabbabaabbbaaaaaaaaabbbabbbbbaaababbabbbbbaababbabbbbbabaabaababaaabaaaabaaabbbbbbaaabaaaabbababbbbabbbababbaabbabbaabbaaaabbaaaaaabbaaabbaabbbbaaababbbbabbbaabaaabbbbbbabbabaaabbbababaaaabbbbaaabbbbbabaabaaabaabbaaabbabbbbbbaaaaaaabaaaaaababaabbbbaaaabaabaaabbababbabbbabbbbbbbabaaaaaaaaaabbabbbbaaaabababababaabbabbabbbbabaaaaaababababbbbbaabbabbabbbbaabbababaaabbaaababbabaaabaaaaaabbbabbaaabaaaaabbababbbbabbbaabbbbaabbaaababaabbabbabababbbbbbabbaaabbaababbbabbaabbaaaaabbbbabbabbbbbbaaabaaaabbbbaaababbbabababaaaabbaabbbbabbbaaaabbabbbbabbabaabbbabbabbabbaabbabbbbabaaaaabbabbbbbaaaabaabbaabaaabaaaababaaaaaaaabaabaabbaabbbbabbabbaaabbabbaaaaabaabbabbaabbbbaaaababbabbababbbbaabaaabbbabbbaabaaaaaaabbabaabbbbababa\n",
              output: "839\n",
            },
            {
              input:
                "ahamlcnjkdsqediltayeyqczblixrwbzmfsujjmkggorfteswmrnhhvdsvxczoindsjgzfmyykocqxpnoleoiehfjjcjqdsqjnhnjyrxylxtoccxbknkfyfxnkplviawtuiqrzbfidqicvroyeiuwyeofulxmedoktfzeixyowrxtsroanotpumfecmmqjfqoognswjoviyrtydvhexqujvdiadyopprjhrqldkkyvjylvubkjfmqobacxdsttmdsintbfyomduoujxfbhqvwnlygkdyomfhwgcwrvzhbvailhkqjlozfrjsoiswqxtzklohcbwehllpzndvgrpfzzivecpfwiskrteimdlpoviqcydmygsxzudfwsucltjaawyuaxjiibgpfergteqysemuikjgvkcwmjswuzrddcjepqpasblimxcyazgxdrantonzzwddcuvpvlwruwhacoinqfnqzhntgehbxxrvdnyqevgywhypwkdpadlcumknmkyshbblnzlruidmpxnqjgblvlujhnmqlwrkvpygzmifxxhfdvwlhtfejfetsswrmaovupuikkxljxzjzymrstfdhpwoqmimizvulfcxxyyfzawetqqanvzxhtphbqjtkuuzxchiahlvnnnjkptycmlkgfdspkzcbjpzwtrjuzoukrismfnckvofoblrgifnqeapbpnankiyarawzklcternhvwqswgmarfgntmszjjqpxmcvjsxozfurwqknldvswfebetzbaekwxquzlfrkkfuypqrhhjnmapgeihmcgzoexavuupuhkxwdftwtjxclnnwpgnzdgqimrhbdhlamludxcueoscrsfwgaijpkecrmsqctokkkdrstrvfvuytcoahtuppvqbdrroyyewnfkwkpgqxhrdckmuyngkosfvgcbadggjqsegnmwkdubelcmdcxsssrmvozdedvnozzphmrkimicdbvizlblpzptgmjnfyqhswrkfdzdmfftunvybyjpqqjigebwrwuwdhdobbvvilnhaybyvyztewtchqvleurkyofrhejgjfalqhmdipupacjrtgfjnkpcyaskixtazfdrrrbgmuclnttfgrinkzjctgdwxyklsiwsbqcldvhwwldfocbdzpunbddgwjgctqbldvmhwzhhyrgmaiiqfr\nhazrydarulgqzlszdeqtufiezviwvhjstupteyiwbjdawtauwaaijyyaqoipcoznhrtheoirvfnogwynvrhkwflcirrxmnksuloymqycklsfplnviaflwrajiypiycmnehbtfpmnstxxtqkrucjsulxkrmgaltdqcvghsvzwpwftbfvwqkedlzvrrwxwsqvilejsbhgshjtozrwyfqrhytcrtyhmvkjfzuizkrqpdogvdvfqkpccgkgfywmzolylzijdnbmajiwajfzmidpokubhptvuctiqxoqbgugnnuoivuadjxlvhvcdpoodpzozwvxhyjinlekckjooydqrnnheusfafvyqeqotdbgtttkzqglwbfxqjpbfpcylaxxdnimtnwgfbpsgyrblghooqrroxvrwyhbibvsgkmdaxfqobivoxuumvqoeuegddntzaewkdkzrbymfzalrhodbhfdmxnijvarlhzjszwkhkvlhovcohhatbqtlbwolawudxilbigrbiigrlhfpdbhpxjymuwzmmqmzqxzkstbeehqtgayfjlpdwbqsyoppnzxqfhbmgxhmigfzavilpejffppuoiluffomarwevtjximwsfztvewgnondzsugwohqszxxqxnjgvinlmbjirlwdpdujigajdiujbrjblauyynbnpywldiumfxsisagwmsnvnnmlwsynncxplnrlvmbhtjhnisakbxhbbyuimbbemkschyeenguahhankqwpwehsbymxswgtyaerkcxolkqypabbuqkyjokyhbvfvcwptwqrvfqfxsobacdqynkntrvhmowsrzrbhemkifuiysxeeougbtfbnxfvovmpbumcbcsckkppqiqhhaqxoyvitklmgpwvgbzzksvnvifzvgzfeugxpzp\n",
              output: "332\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_grid-paths-obstacles",
      title: "Grid Paths with Obstacles",
      type: "full_source" as const,
      tags: ["medium", "Dynamic Programming", "Matrix"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "一台掃地機器人被放在一個 $R \\times C$ 網格倉庫的左上角格子 $(0,0)$。倉庫中每個格子若標示為 `.` 表示可以通行，若標示為 `#` 表示被貨架擋住、無法進入。\n\n機器人每一步只能往**右**或往**下**移動一格，且只能停留在可通行的格子上。請計算機器人從左上角 $(0,0)$ 走到右下角 $(R-1,C-1)$ 共有多少種不同的走法。由於答案可能非常大，請輸出走法數除以 $10^9+7$ 的餘數。\n\n若起點或終點本身就是障礙，走法數為 $0$。",
        inputFormat:
          "第一行包含兩個整數 $R$ 與 $C$（$1 \\le R, C \\le 1000$），分別表示網格的列數與行數。\n\n接下來 $R$ 行，每行一個長度為 $C$ 的字串，僅由 `.`（可通行）與 `#`（障礙）組成。",
        outputFormat:
          "輸出一行一個整數：從 $(0,0)$ 走到 $(R-1,C-1)$ 的走法數對 $10^9+7$ 取餘數的結果。",
      },
      samples: [
        { input: "3 3\n...\n.#.\n...\n", output: "2\n" },
        { input: "2 2\n.#\n#.\n", output: "0\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "3 3\n...\n.#.\n...\n", output: "2\n" },
            { input: "2 2\n.#\n#.\n", output: "0\n" },
            { input: "3 2\n..\n..\n..\n", output: "3\n" },
          ],
        },
        hidden: {
          description: "邊界、障礙阻隔與中型隨機測資",
          weight: 40,
          cases: [
            { input: "1 1\n.\n", output: "1\n" },
            { input: "1 1\n#\n", output: "0\n" },
            { input: "2 2\n#.\n..\n", output: "0\n" },
            { input: "2 2\n..\n.#\n", output: "0\n" },
            { input: "5 5\n.....\n.....\n#####\n.....\n.....\n", output: "0\n" },
            { input: "1 8\n........\n", output: "1\n" },
            { input: "8 1\n.\n.\n.\n.\n.\n.\n.\n.\n", output: "1\n" },
            {
              input:
                "21 29\n............#.#.........#....\n.....#...#.#..#.#............\n###....#...............#...#.\n.#...#...#..#................\n#.#....................##....\n.......#.......#.............\n..#........#..............##.\n......#..............#.......\n........#............#.#...#.\n###....................#..#..\n.......##.#......#.........#.\n.#..........#...#.........#..\n#........................##..\n.....#....#..............#...\n................#......#.....\n..........#...........#......\n.#..#.....#.#.........#.#.#..\n......................##.....\n..#...................#...#..\n.#.........#......#.......#..\n.....#.#..#..................\n",
              output: "704082277\n",
            },
            {
              input:
                "28 40\n........#............#.....#...#........\n.........#...........#.................#\n#....#...##...#.....#........#....#.....\n............................#...........\n..............#....##...................\n...............................#...#.#..\n.......#...#........#.................##\n..............##.#.........#.........#..\n...........................#.......#.#..\n.....................#.....#..#.........\n............#...........##..............\n......................#.................\n......#.....#......#............##......\n...#.................#..........#..##...\n....#.......#........#..................\n.......#......#.......#......#....#...#.\n.......#...................#............\n..#...#...#.....#....#.#................\n.#................#..............##.....\n.......##............................#..\n................#............#.#....#...\n........#....#..........................\n.#...#.#...#........#..##.......#.......\n..............#....#..#....#.#..........\n#........#.....#.........#........#.....\n.....#..............................#...\n.....##..........#.#.#..........#....#..\n.............#.....................#....\n",
              output: "983554314\n",
            },
          ],
        },
        hidden2: {
          description: "大型網格與取模驗證測資",
          weight: 60,
          cases: [
            {
              input:
                "50 50\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n..................................................\n",
              output: "267422234\n",
            },
            {
              input:
                "60 60\n.................#......................#.......#...........\n........#......#....#............##......##......#..........\n.......#..............#.............#....................#..\n.......#...............#.........................#.......#..\n............................................................\n.#..............................#.........#..#..............\n..##..........#............#....................#...........\n.............#.................................#.........#..\n....#....#.#............#...#..........................#....\n.........#...#...#..#.....#.........#.....#...#..#..........\n..#...#..#.....#.................#..................##......\n......#..........#..........#....#......##.#........#.......\n...........#.......................................#........\n..#................#............#......##......#............\n................#.......#................#........#.........\n......#.........................#............#......#.......\n..............#......#......#...#.........................#.\n...#.........#......#...#.........#..........#..............\n......#.....#.....#...............#.#.......................\n......#......#......................................##......\n.........#..#............#...........................#......\n...#...........#...#....#..........#........................\n...................................#.........#..#...........\n..............#......#.....#.....#.....#.........#..........\n.............................................#.#............\n........#...#...#.................#....#......##.........#..\n....................#...................#...........#.....#.\n.##.........#.#....#.................................#......\n#.......................#....#.............................#\n...#................#............#..........................\n...........#...............................#.....#..........\n............#.##.................#..........................\n.......#.........#........#.......#...#.............#...#..#\n......#............#..#..............#..............##......\n............#.........##......................#.............\n..........#............#..................................#.\n.#....#.............................#.......................\n.........#....#...........##................##..#.#.#.......\n...#.........#.........#................#...#...............\n......................#.......#..##..#...#..................\n...#....#...................#.................#..........#..\n........#...............#.........#....#.............##.....\n.#..#.....#..............#...................#.#............\n........#........#...............#..........................\n.#.............................#................#...........\n............#.....................................#...#.....\n..#..#.#...................#..................#............#\n..........................................#.#.#...#.........\n.............#..........................##............#.....\n..#........#.................#......................#.......\n.......#.#.........#........................................\n...#....................##.....#..#...........#..........#..\n..............#..........#....#.............................\n........##.......................#..........................\n......#.........................#..#.#.##...................\n.................#....#........#.....#.#.....#..............\n...#..#........................#............................\n.................#..#............#..........#...............\n.....#..#...................................................\n.......#.#.............#........................#...........\n",
              output: "143799235\n",
            },
            {
              input:
                "30 31\n##..##.##.##.###..##..#...#...#\n..#...######.#..#...#.###..#.#.\n##.....####.#...##.###..#...##.\n....#.###..##.##.#..###.###....\n##...#....####.##.#..####..####\n####.#.#.#......#.##.......###.\n.#..##.##..##.##..#.###.#.#.#.#\n#.#.####..##.#..####...##..#.#.\n.####..#..#...#...##.#.#.##.##.\n##.#.##..####.##.#.####.###..##\n#####.##..#..#.#...#.#.#..##...\n..#..#.##.#.#..#..#......######\n......#....##.#.#..###..##.###.\n##.###.##.#.#..#...##.##.....#.\n.###...#.###...#.#.###.##.##.#.\n#.#.##..####.#.##.#.#.#####.#.#\n....###.#.#..##......#..###.###\n..######.##..####.#.#.#.#.....#\n.#.#.##...##......#....########\n#....#.##.#..##.##...##...#...#\n..##..###.##.....######.......#\n...#####..##..#.#.###.#...#....\n#####.#.#.#....#..###.#######.#\n#.#.#..#..####..#.#.#.####...##\n..####.#.#....####.#.#.....#...\n#.#.###.#.#.#.##..#...###..##..\n...#.##..#.#..#...#..#.#..###.#\n.#####.##.#####...##.#.#####..#\n#..#.##..##..#.#..###...#####.#\n###.##.#.#....####...##.####...\n",
              output: "0\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_partition-equal-subset",
      title: "Fair Split",
      type: "full_source" as const,
      tags: ["medium", "Dynamic Programming"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "小安和小柏一起整理教室時撿到了 $N$ 顆彈珠，第 $i$ 顆的重量為 $a_i$。兩人決定把彈珠全部分掉：每顆彈珠必須恰好分給其中一人，而且兩人分到的彈珠總重量必須相等。\n\n請判斷是否存在這樣的分法。",
        inputFormat:
          "第一行包含一個整數 $N$（$1 \\le N \\le 200$）。\n\n第二行包含 $N$ 個正整數 $a_1, a_2, \\ldots, a_N$（$1 \\le a_i \\le 1000$），以空白分隔。",
        outputFormat: "若能把 $N$ 顆彈珠分成總重量相等的兩組，輸出 `YES`；否則輸出 `NO`。",
      },
      samples: [
        { input: "4\n1 5 11 7\n", output: "YES\n" },
        { input: "3\n1 2 4\n", output: "NO\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "4\n1 5 11 7\n", output: "YES\n" },
            { input: "3\n1 2 4\n", output: "NO\n" },
            { input: "4\n2 2 2 2\n", output: "YES\n" },
          ],
        },
        hidden: {
          description: "邊界、無解與大型隨機測資",
          cases: [
            { input: "1\n7\n", output: "NO\n" },
            { input: "1\n1000\n", output: "NO\n" },
            { input: "5\n3 3 3 3 3\n", output: "NO\n" },
            { input: "3\n2 2 8\n", output: "NO\n" },
            { input: "5\n4 4 4 4 4\n", output: "NO\n" },
            { input: "6\n5 5 5 5 5 5\n", output: "YES\n" },
            { input: "2\n1000 1000\n", output: "YES\n" },
            { input: "2\n999 1000\n", output: "NO\n" },
            {
              input:
                "200\n1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000 1000\n",
              output: "YES\n",
            },
            {
              input:
                "200\n302 24 577 1000 838 505 660 325 583 63 699 797 639 702 511 397 726 530 432 473 745 337 663 297 166 844 58 929 833 458 826 851 13 840 202 726 946 4 672 808 3 663 922 745 10 718 620 216 435 581 928 132 296 107 660 888 303 59 117 436 975 622 779 156 433 534 757 399 163 916 468 438 206 323 807 731 572 787 496 13 903 423 719 293 904 213 626 397 996 787 160 553 394 926 336 495 77 707 324 133 761 517 320 487 682 565 96 212 910 577 19 59 116 859 972 892 707 67 42 875 378 31 936 307 97 697 63 396 101 860 445 549 999 727 543 995 227 522 769 515 341 474 408 49 360 403 639 24 334 433 527 302 731 384 214 803 86 442 859 484 365 964 689 449 608 509 565 683 534 747 179 6 879 98 890 637 164 131 248 397 247 691 86 520 666 291 226 941 818 271 61 293 741 884 998 454 263 393 798 276\n",
              output: "YES\n",
            },
            {
              input:
                "199\n217 491 852 324 133 369 959 194 237 620 306 4 171 151 647 690 7 652 328 738 587 239 290 53 122 654 504 950 571 672 774 653 918 683 80 579 579 737 485 670 792 549 686 314 147 131 302 278 951 830 101 524 685 229 271 698 306 943 643 835 834 410 561 350 20 767 77 708 357 548 212 461 533 230 361 750 20 644 159 694 926 485 19 232 626 775 448 212 681 773 283 411 469 246 373 210 530 691 286 787 675 55 423 478 710 617 198 391 93 547 859 717 613 51 297 962 491 477 351 932 178 389 759 98 451 453 669 574 489 594 23 478 29 12 291 517 68 619 950 348 519 552 9 328 531 303 875 760 831 688 731 707 183 437 30 669 507 129 291 340 869 286 311 947 528 57 427 175 765 782 860 709 127 16 129 410 76 407 795 143 975 32 519 742 113 950 965 649 914 90 869 25 138 954 358 372 399 212 881\n",
              output: "YES\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_tsp-bitmask",
      title: "Shortest Grand Tour",
      type: "full_source" as const,
      tags: ["hard", "Dynamic Programming", "Bit Manipulation"],
      memoryLimitMb: 512,
      timeLimitMs: 3000,
      visibility: "public" as const,
      statement: {
        body: "一位巡迴演出的音樂家住在城市 $1$。這個國家共有 $N$ 座城市，編號 $1$ 到 $N$，任兩座城市之間都有直達道路：從城市 $i$ 前往城市 $j$ 的移動花費為 $d_{ij}$。注意花費**不保證對稱**，也就是 $d_{ij}$ 不一定等於 $d_{ji}$。\n\n音樂家要規劃一場大巡演：從城市 $1$ 出發，恰好造訪其他每座城市各一次，最後回到城市 $1$。請求出這趟巡演的最小總花費。",
        inputFormat:
          "第一行包含一個整數 $N$（$2 \\le N \\le 13$）。\n\n接下來 $N$ 行，每行包含 $N$ 個整數，其中第 $i$ 行的第 $j$ 個數為 $d_{ij}$。保證 $d_{ii} = 0$，且對所有 $i \\ne j$ 有 $1 \\le d_{ij} \\le 10^6$。",
        outputFormat:
          "輸出一行一個整數：從城市 $1$ 出發、恰好造訪其他每座城市各一次後回到城市 $1$ 的最小總花費。",
      },
      samples: [
        { input: "3\n0 1 2\n1 0 3\n2 3 0\n", output: "6\n" },
        { input: "2\n0 5\n7 0\n", output: "12\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "3\n0 1 2\n1 0 3\n2 3 0\n", output: "6\n" },
            { input: "2\n0 5\n7 0\n", output: "12\n" },
            { input: "4\n0 1 10 4\n1 0 2 9\n10 2 0 3\n4 9 3 0\n", output: "10\n" },
          ],
        },
        hidden: {
          description: "小型、非對稱與貪心陷阱測資",
          weight: 40,
          cases: [
            { input: "2\n0 1\n1 0\n", output: "2\n" },
            { input: "3\n0 1 2\n5 0 1\n1 10 0\n", output: "3\n" },
            { input: "4\n0 1 10 50\n1 0 1 10\n10 1 0 1\n50 10 1 0\n", output: "22\n" },
            {
              input: "5\n0 7 7 7 7\n7 0 7 7 7\n7 7 0 7 7\n7 7 7 0 7\n7 7 7 7 0\n",
              output: "35\n",
            },
            {
              input:
                "6\n0 41 31 57 84 49\n13 0 14 1 18 76\n46 58 0 1 29 100\n98 83 26 0 86 19\n28 22 35 86 0 82\n64 38 36 84 2 0\n",
              output: "88\n",
            },
            {
              input:
                "7\n0 252 175 355 640 48 851\n688 0 412 274 221 441 591\n240 892 0 679 247 569 376\n397 576 700 0 5 7 691\n492 222 547 100 0 753 745\n155 369 724 788 768 0 18\n929 5 440 571 735 438 0\n",
              output: "1039\n",
            },
            {
              input:
                "8\n0 10 1 4 2 11 28 11\n15 0 32 44 29 49 8 3\n38 14 0 48 46 38 5 49\n48 21 14 0 48 20 18 3\n46 11 50 29 0 14 34 32\n11 17 40 32 39 0 42 2\n46 24 21 39 33 45 0 11\n20 45 26 33 29 40 24 0\n",
              output: "104\n",
            },
          ],
        },
        hidden2: {
          description: "$N = 13$ 上界效能測資",
          weight: 60,
          cases: [
            {
              input:
                "13\n0 256881 601259 422783 299673 805941 73214 115291 55878 867702 312903 259340 587240\n428468 0 378506 201470 792179 410823 195237 217850 904990 984358 61562 902867 582504\n794827 478614 0 831734 668589 805734 569408 722714 515436 844550 241579 142060 222008\n295269 997688 75326 0 259097 994901 480323 253651 817412 154906 926635 827341 738645\n257775 455498 279309 133605 0 218467 36150 896702 685154 691315 242882 525482 35675\n756731 408405 345292 7183 855864 0 636164 843311 454273 735076 977552 614089 659704\n757878 645064 308423 764567 191317 195200 0 656453 719329 9534 528412 402161 409601\n7172 879685 94224 662103 981303 360252 444762 0 454512 655971 452367 797761 350014\n693814 873746 477023 1829 138707 521019 898151 386014 0 528507 761787 431745 933719\n896398 193043 172479 993343 43612 150664 454270 242623 898745 0 505167 687830 699608\n103389 499700 826564 886541 827189 649952 731838 174616 924005 940698 0 241492 627602\n708175 556611 511380 579119 94689 617217 563619 47874 76637 600519 217562 0 514984\n806924 706135 249492 678805 820088 364950 544345 242840 143069 636219 65659 721593 0\n",
              output: "1335351\n",
            },
            {
              input:
                "13\n0 16686 171383 909210 743574 351866 635415 646293 490260 411219 712444 118265 995036\n945128 0 957543 103341 817915 967163 704939 470515 891063 600043 169072 912668 213239\n440696 989412 0 364342 72380 24674 749740 825250 819150 622503 933804 26644 674796\n641397 411812 84348 0 278938 623006 543192 283837 785520 987151 875838 793535 49950\n37120 539491 548420 619690 0 158602 955531 824948 305479 446472 824936 509166 634284\n131005 303698 750397 983484 797515 0 317540 377527 914265 281592 856109 293583 877607\n54467 713033 49967 430649 200512 806395 0 596564 917052 575141 614222 803964 601513\n177373 596983 576634 339778 266174 469494 863531 0 465963 376911 998080 581213 990068\n50872 234173 870195 74688 744708 849508 776797 557269 0 255221 339611 307011 271646\n558575 947628 241460 121704 643404 744277 770036 916956 689462 0 262445 521692 902558\n180795 183274 545682 297671 109766 130179 119346 754308 650817 774608 0 234543 448601\n301710 705768 303257 406985 920440 448826 744079 703923 251005 496201 551787 0 26105\n900307 138845 901172 952055 514967 840601 958797 169464 80240 164024 731712 433635 0\n",
              output: "1704603\n",
            },
            {
              input:
                "13\n0 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000\n1000000 0 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000\n1000000 1000000 0 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000\n1000000 1000000 1000000 0 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000\n1000000 1000000 1000000 1000000 0 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000\n1000000 1000000 1000000 1000000 1000000 0 1000000 1000000 1000000 1000000 1000000 1000000 1000000\n1000000 1000000 1000000 1000000 1000000 1000000 0 1000000 1000000 1000000 1000000 1000000 1000000\n1000000 1000000 1000000 1000000 1000000 1000000 1000000 0 1000000 1000000 1000000 1000000 1000000\n1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 0 1000000 1000000 1000000 1000000\n1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 0 1000000 1000000 1000000\n1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 0 1000000 1000000\n1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 0 1000000\n1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 1000000 0\n",
              output: "13000000\n",
            },
            {
              input:
                "12\n0 757430 460702 140985 398182 523812 806708 143778 159159 670915 770865 630662\n38411 0 156888 17620 714281 932435 340169 391327 541813 211138 882872 677653\n345801 64161 0 743678 84378 740187 887482 697206 364286 214588 106173 574206\n139003 81822 28570 0 41983 707463 68438 217930 94085 448293 974947 683507\n801435 232285 499271 715884 0 743466 949729 118636 669946 691916 657311 364692\n856321 257490 11074 692373 289069 0 873382 63704 448107 44057 642856 330892\n786938 425770 733967 755977 549682 819933 0 425186 626721 308542 47364 668544\n888930 273206 8055 266615 216764 353373 598358 0 843035 101324 208105 327263\n248001 926671 913229 470316 700430 368175 727305 903313 0 903330 330504 359215\n913918 129748 584952 523914 364664 370025 172186 860696 382656 0 26125 716585\n221097 948259 182402 148426 906830 72704 382168 744654 202033 549481 0 127741\n835698 811925 648320 59345 896958 457473 840188 859260 919173 290048 357969 0\n",
              output: "1245562\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_longest-palindromic-substring",
      title: "Longest Palindromic Substring",
      type: "full_source" as const,
      tags: ["medium", "String", "Dynamic Programming"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "給定一個僅由小寫英文字母組成的字串 $s$。\n\n若一個字串正著讀與倒著讀完全相同，則稱它為**回文**。$s$ 的**子字串**是指 $s$ 中一段連續的字元。請求出 $s$ 的最長回文子字串的長度。\n\n注意子字串必須是連續的一段，這與允許跳著取字元的「子序列」不同。",
        inputFormat:
          "輸入僅有一行，包含字串 $s$（$1 \\le |s| \\le 5000$），僅由小寫英文字母 `a`–`z` 組成。",
        outputFormat: "輸出一行一個整數：$s$ 的最長回文子字串的長度。",
      },
      samples: [
        { input: "babad\n", output: "3\n" },
        { input: "cbbd\n", output: "2\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "babad\n", output: "3\n" },
            { input: "cbbd\n", output: "2\n" },
            { input: "forgeeksskeegfor\n", output: "10\n" },
          ],
        },
        hidden: {
          description: "邊界、全回文與子序列陷阱測資",
          weight: 40,
          cases: [
            { input: "a\n", output: "1\n" },
            { input: "ab\n", output: "1\n" },
            { input: "aa\n", output: "2\n" },
            { input: "abcxydcba\n", output: "1\n" },
            { input: "abcdefghijklmnopqrstuvtsrqponmlkjihgfedcba\n", output: "1\n" },
            {
              input:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
              output: "600\n",
            },
            {
              input:
                "abbbbbabbbaaabaabbbaabababaabbabaabbababababbbaaaaaabbbaaabbabbbbbbbaabbbabbbabbbbaababbbbabaabababaaabbbbaaabaabbbbabbbababaaaaabbabbabababaabbbbbbbaaaaaabbbabbbababbbbbaabbbbbbaaabbbaabbbbabababbbbbabaabaaaabbbababaabaabbbbabbaaabbbababbaaaaaabbaaabbababbaababaaaabbaaaaabbbaaaaababbaababbbabbbbabbaaaaabbbaabaababbaaabababaaabaabbbbabaabbaaaaabbabbababaaabaababbabbbbabbaababababbbbabbaaababbbaaababaaabbbabaaabbabbbbabababaabbabbbbabbabaabaaabababbabbaaaaabbaababbbbaabaaabababaaabbabaabaabbbaaaaabbabbbbabbbabaabbabaaaaabbbaaaaabbaaaababaabbababbaaabbaaaaaabbababbbaaabbabbbbaabaabababbbaaaabaababbbbbabababbbbaabbbaaabbbbbbaabbbbbababbbabbbaaaaaabbbbbbbaababababbabbaaaaabababbbabbbbaabaaabbbbaaabababaababbbbabaabbbbabbbabbbaabbbbbbbabbaaabbbaaaaaabbbababababbaababbaabababaabbbaabaaabbbabbbbba\n",
              output: "801\n",
            },
          ],
        },
        hidden2: {
          description: "大型隨機字串測資",
          weight: 60,
          cases: [
            {
              input:
                "aabababbbabbabbaababaabaabbbaaabbbaaaaabbabbabbaabbaaabbabaaabbabaaaabaabbaabbbabaabbaabaaabbaaaabbbbbaabbbbabbaabababbbbaaabaaaaababbbabbbbbbbbababbabbabaaaabbabaabaabbbaaabbbabbbaaabbabbaabbbabaabaabbabaaabbabbbbaaabababaababaaaabbaabaaabaaaababbabbbaaaabababbaaaaabbaabbaaaabbababbabbaaababbbbababbaababababbabbaaaabbbaabaaabbaaaaabbabababaaabababaabaaababaaaabaaaaaabaaaaaaaaaaabbabbbbbbbaabbbabaaabbabbbbaaaaabababbbbaaabbabbbaaabaabbaabaabaabaaabbbbbbbabbbbababaaaaaaaaaaaabaaababbabbabbabaaaabababbaabbabbaabbaaababbbaaaabbbbbaaabbaabbaabbaaaabbabaaaaabababbbabababababbbbbabbaaaabababaabaaaabababaabbabbababbbbaabaaabababbaabbababaaaaabaaabaaabbabababaaabbbbbaaaaabbbabbabbaabaaaabababaabaaaabbbbaaaabaabababbbababbabaabaaabbaaaabbaaaaababbbaaaaaabbbaaabaabbbaabbbabbbbababaabbbbaaaabbabbbbbb\n",
              output: "28\n",
            },
            {
              input:
                "acabacacaccbcaacbaaabcacaccacacbcbacaabbbcccbccbababcbbcabccbcababacccacbbccbcbaacbccbbabaabccbbcaaabcacaabcbbbaaaaabaccacabacbacaabbcbbbcabbcbcbcaaabaabcbbaccaaccaaacabbabbbbcabbabaabbbbbbcbcbaabcaaabacccccbcccbbccbababbbcaaaccaccbaacccbbaaababccccbaaccbccabbabbcbcbcababaacacaaaaabbbabcacccabcbcabbbcbcaccccacabcabcbcbbbcccbbacacababaaabccabacccbbbbccbacbcaaaacaacbababbbabbcbcbbaaaccbccaabbcccbacbbcbacbcbbcbcaabaacacaabbabbabcccaccacacbabbacbabacccacbccaacccabababcaccababcbacacbbbabaabcbaaabbcaabcacbbacabbbacabbcbccccbbaccccaaaccbcacaaaaacccacbaaacbbbbacacabcabaccccbaacccbccabaabbcbcbbbaccccbacacabacabacababccaabaccbbcbccccaacbcacbabbabcbbcbaccbcbbcbcaccbbccccbabbbccbacaabaacacbcbbababacbccbbbaaacaababcbaccbabbbbacbccbbabbbcaccccabbcbbccbacaccbbaaacbcaacbcccaabcbbbccbbbcaabbaccbabaccbaacbababcababbacbabccccbacccacccabaaccaaacaacbaacbcaaacbbbacccbcaaacbcaaaabbacbabbaaabcccccccaacbcbbaccccbcbbbcabcacbcccbbbbccacaacbcbaaacbbcaabacbbbcabacbccbbbaabbcabbbaacbbbcabcbbbbbbbbbcaaaccabaaacaababcacbbcbcaabbaabcbaabbbcacbabbcaaacbbbcacbacaacabbccabacbbaacabcccbbacabbbabccacabaaacbabbccbccbcbbaacbaaccbacbcbabbbcbbbaaabacbcbbbbccacaabbbcabcbbacabcbaaacbcbcbabcbbcacbcabbcaabccbbabccbbcbaacbbbabb\n",
              output: "15\n",
            },
            {
              input:
                "caadadbccccbaccadbacbbacdcadcadbbcbcbddbbdaabcbacbbbcbbacacbcacbbbcdaacddaaadbbbadaccabcdccdabcbaadabcddadcaccaacdcbabddcbbccdabcbcdcbbbdaadbdbbccabacbdaddbacadbabcaacdabdababaabbdcbbdbcabbbcbbbababcdacbdabdccadabcbdbbcaadbdabadaddbabbdcbbdbcbabcccbdccdbddcaaddaaccbbabadabdadaabadcabaccbaadddbdbbcacabcbacdacbdcaaaaddadcdcddccaaccdccdacabdaaccbbdccdddccababccadbaabacabbbddaccbcadcdaacbdcdcdcccdbdcaacdcdacbaabacabcbddddadacbdbacbaabaabdcdcccadcdbdabcbbbadcdccacbabddbaccaacdbdbdbaddbccacabcaaadbddd\n",
              output: "9\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_sliding-window-max",
      title: "Sliding Window Maximum",
      type: "full_source" as const,
      tags: ["medium", "Queue", "Sliding Window"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "監測系統每單位時間回報一筆讀數，分析人員想知道「最近 $K$ 筆讀數的峰值」如何隨時間變化。\n\n給定一個長度為 $N$ 的整數序列 $a_1, a_2, \\dots, a_N$ 與視窗大小 $K$。一個視窗是序列中連續的 $K$ 個元素；視窗從序列最左端開始，每次向右滑動一格，共有 $N-K+1$ 個視窗。請對每個視窗求出其中元素的最大值，也就是對每個 $i$（$1 \\le i \\le N-K+1$）計算 $\\max(a_i, a_{i+1}, \\dots, a_{i+K-1})$。",
        inputFormat:
          "第一行包含兩個整數 $N$ 與 $K$（$1 \\le K \\le N \\le 10^5$）。\n第二行包含 $N$ 個整數 $a_1, a_2, \\dots, a_N$（$-10^9 \\le a_i \\le 10^9$），以空白分隔。",
        outputFormat:
          "輸出一行，包含 $N-K+1$ 個整數，以空白分隔；第 $i$ 個整數為 $\\max(a_i, a_{i+1}, \\dots, a_{i+K-1})$。",
      },
      samples: [
        { input: "8 3\n1 3 -1 -3 5 3 6 7\n", output: "3 3 5 5 6 7\n" },
        { input: "5 5\n-2 -7 -1 -5 -3\n", output: "-1\n" },
      ],
      testcases: {
        sample: {
          description: "題面範例與小型手工測資",
          cases: [
            { input: "8 3\n1 3 -1 -3 5 3 6 7\n", output: "3 3 5 5 6 7\n" },
            { input: "5 5\n-2 -7 -1 -5 -3\n", output: "-1\n" },
            { input: "4 2\n10 10 10 10\n", output: "10 10 10\n" },
          ],
        },
        hidden: {
          description: "小規模邊界測資：K=1、K=N、全遞減、全相同、負數與極值",
          weight: 40,
          cases: [
            { input: "1 1\n-1000000000\n", output: "-1000000000\n" },
            { input: "10 1\n5 -3 7 7 0 2 -8 1 9 -1\n", output: "5 -3 7 7 0 2 -8 1 9 -1\n" },
            { input: "12 12\n3 1 4 1 5 9 2 6 5 3 5 8\n", output: "9\n" },
            {
              input: "15 4\n100 90 80 70 60 50 40 30 20 10 0 -10 -20 -30 -40\n",
              output: "100 90 80 70 60 50 40 30 20 10 0 -10\n",
            },
            { input: "10 3\n7 7 7 7 7 7 7 7 7 7\n", output: "7 7 7 7 7 7 7 7\n" },
            {
              input:
                "20 5\n-5 -17 -3 -900000000 -1 -42 -7 -1000000000 -6 -2 -999999999 -13 -8 -4 -11 -20 -1 -30 -2 -5\n",
              output: "-1 -1 -1 -1 -1 -2 -2 -2 -2 -2 -4 -4 -1 -1 -1 -1\n",
            },
            {
              input:
                "22 15\n-23051700 655245616 -624732602 515078126 -155966665 571869926 -248945794 -69034835 88484351 718030854 -763841068 144397080 -739484763 -827871229 582075433 -20863677 -434317703 -897162337 414796547 390496325 -560870745 -279839689\n",
              output:
                "718030854 718030854 718030854 718030854 718030854 718030854 718030854 718030854\n",
            },
          ],
        },
        hidden2: {
          description: "較大規模隨機測資",
          weight: 60,
          cases: [
            {
              input:
                "505 213\n-46667 92546 85893 -92040 -62553 61930 -30082 -96992 81363 15336 86087 -56166 88385 -95746 14978 -27088 15198 20534 -39218 -49443 69953 -68263 -21350 84651 83718 1528 -8000 70191 -73538 21485 13925 -39747 79741 27667 -22821 68348 87560 -68086 92855 -63325 -65886 26368 28888 -57913 -50265 442 27812 -70848 48645 -40916 43432 76498 70281 -14604 -67670 -61813 41951 70618 -37742 64423 96441 -87978 52070 80493 -6515 -55621 23164 22223 53338 79803 -24038 -26123 -43380 -72308 -48211 87787 -16872 -33886 45509 -5348 -82655 -32539 87313 34914 -9548 35065 -99493 -63202 38673 -46568 -19321 86135 77047 -81740 -94850 17420 -16218 -69124 -18836 -9412 -96420 99033 -31398 69058 -4768 -27785 -74074 -36097 -91875 36925 43075 77924 92834 12451 -44432 25647 25552 -40937 -87840 -47698 33411 17634 -82010 70579 -23571 91536 2903 -89591 -93445 -96441 -21228 63256 -87001 -33316 -62351 -64047 17150 -97034 86463 19141 -51033 -92230 8787 -30388 -41380 20486 50107 35949 56028 35976 -44631 -64938 -94378 -74334 15482 15917 -86251 91141 64853 -71997 94584 -94497 84015 81648 -77547 -49698 37578 73042 85147 -73397 7088 30046 -89705 -71107 66496 -41714 64123 31174 92441 -36200 86758 -53006 8107 -77539 20118 77397 -37268 93099 85679 93362 -9749 7653 -58549 -933 68176 34389 -95322 -89428 -88900 94870 38924 17117 76388 84737 -91587 -84460 -38080 28520 -65476 10871 87122 77348 -87058 -57527 -63576 -864 -511 91801 -94956 -59387 55527 27141 -7023 25346 -74535 -57192 15483 -61010 13865 -70418 -85549 38458 5262 -61995 52828 84577 80586 2061 40366 -54130 -89282 40713 87990 2412 84918 21144 -61234 -4057 -15611 8868 38521 55021 22846 -37022 98248 17681 27471 14335 39475 -6343 -55338 -11290 10044 -12338 -41485 -57270 424 72002 49435 2995 -58585 58147 48208 80317 53694 48477 -64522 -74480 -74783 -94998 -27338 63388 89756 -27676 41233 -7352 80563 -75667 -4483 81752 -64688 -27905 42030 36362 30070 -27260 10101 -47641 53029 -2361 -96055 70335 -41263 28323 -15100 -88625 -61258 -4069 88028 45325 58714 75186 42647 93586 97267 -12999 63603 39100 -29722 -71916 33444 -47257 -15233 25343 65448 48100 -6067 -13387 58519 75954 14511 29885 -57172 68807 42836 -7505 -45283 12280 -81989 75800 33987 -81718 86931 -78399 67547 49100 -25088 -63206 -60027 -63501 -38156 57465 87221 -56487 15073 -93770 -21240 -91603 30514 -57600 -97685 72322 -75019 98313 -41056 73350 73876 92024 -65367 -14451 -63075 6182 -67010 16719 -93244 90275 -73686 -4789 -6304 95866 -41474 -60540 20317 41594 27052 -76665 -69334 -75843 67103 -55849 -52308 19854 -48353 -631 63165 87894 71865 59584 -12929 -31552 90900 -54691 -31686 -35329 -54973 93119 -49338 30762 34087 -54198 46889 34062 92492 99723 43739 -69360 4250 19645 -4533 -16329 -61409 -71675 -15492 -45056 88638 -13597 -52077 -47437 27024 -43830 69732 18487 83349 -56335 -44339 -20075 -67656 13974 40479 -53480 86826 70767 -79610 39472 88249 5455 -61821 -43448 -47185 35719 -49657 -62706 -44815 57606 12328 -69852 -93288 28218 53681 23756 -44808 -92034 90602 -12600 67005 53085 -89238 15488 56615 -93892 55842 -23801 -40829 -720 -14564 -78894 -51616 31322 -39319 -94954 -37299 13 -60611 -75447 -39850 55256 -79766 58255 17518 31720 -96137 89528 78872 77717 96354 57047 90625 -32360 97755 -92203 77814 78667 31855 95675 -36797\n",
              output:
                "99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 99033 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98248 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 98313 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723 99723\n",
            },
            {
              input:
                "558 500\n-234552137 -259741221 -996789738 53363184 -256020828 136038973 767721001 926240611 -90650636 228668178 245180295 -644125573 -652726645 -738051303 -81613811 -287648709 -209299581 226395111 -702444427 356378177 -470985789 859998890 -797455776 926010865 865321206 283730869 79758215 661371235 106403674 967845237 657949295 -897493519 482512508 -858971904 -362637733 -376982721 903479327 375613111 195590510 -846337995 92463995 -410368805 235621583 -247520297 -959084830 -857514961 728381748 727316010 -813057452 340487401 -562974437 737452865 759595156 -192315808 -351944575 973641565 662252325 613734411 726814378 748502356 873850630 -925804172 264666456 767491244 -628802581 -897487654 571596744 35517820 -45968453 -884100682 327458492 932297970 -417746170 454972752 -578197516 465732674 916805869 864519589 377248353 450984987 881193312 -152092026 -488660368 408089967 -121615567 -596120125 762808957 -399368696 -697993162 697388378 118923173 -296728080 -24369231 -80158709 -485452949 -205908925 616786139 261906377 413900908 370631129 -137119534 -674584579 639142942 708606423 -807173779 765171061 -945353322 -424520102 448032849 -73957030 399426974 -551730965 277489168 -887454564 -439030032 214045200 -203005081 -745071818 91705006 283008465 -853458602 -200418077 748697801 -938673012 -621611792 946792655 -582388106 846924959 -242746335 110674883 -630927705 184312888 -221498319 281141935 236144766 719405095 -137873922 451637340 -811263681 23829706 59433970 904175882 102282670 780616667 -184068149 -958640643 -378274164 520181021 -581694520 -599907477 -44242493 -989026291 198966844 -806518565 -595278877 -674953047 -902340152 -738629628 914617973 -872545082 53007540 674466772 -7837544 -336982693 821493894 -224679451 155508983 -151173540 857613006 -39233975 -129976455 -266455617 755239930 116873596 906368853 231377059 -174747076 -370936269 414020843 82026210 365054549 -667925575 -557360063 -15569525 -293215011 -273044796 -336803831 -700554818 99086898 -533297944 485850272 -369021266 244266076 591830898 -737654912 428574652 -983437922 -594571157 806032673 -610253549 704339467 709131843 -261213546 771735609 440508040 -595443436 639403704 726198495 948416573 861886254 535339958 394479798 -456762063 217149338 873101122 -275774444 599788669 323631915 919613242 -434327949 -595346586 -248144380 965048297 454686642 246295530 -464176713 366203819 977200430 781055346 -317706588 -269987741 -768905496 306732055 732560092 -417542926 -439964258 -102376487 -351777204 186050609 -291306569 -577837937 794105583 -584048282 -575939665 445991019 -586815801 966576648 615198667 -802408738 311592828 -777617727 -951654966 -738722799 -688594517 -778526798 -160685535 -891630737 -734321380 342054947 -776574950 91736359 -547037727 -407879196 809888873 -206800532 -336569924 -106159205 -831213275 -278791213 -867879605 616626470 856326700 -774059703 -111304740 -212711282 -273238150 -11074681 -288893757 -752963648 511587176 -74386765 -781346734 -571398488 -242417622 491736338 569039685 -792744197 910036351 -565940893 -688933323 -707486435 -575355953 -834904914 -95517556 256239377 -482482643 -541078552 429113501 792531024 -81656484 63004894 -614489753 -966319667 718507013 -286048059 637905860 745902892 695045270 -122739814 973122078 -581996838 -686240664 91986501 -740632392 21486805 -721337130 -977340614 501615237 322458311 887516069 768036775 -797509233 -449758249 -819119775 617826580 86276485 -414914735 -396777054 -699427782 -159638715 443494983 -97175871 -1373436 -478743445 -532201106 585944780 -239960230 -576801933 182134581 -315725021 27674770 283578410 -911595648 -879792799 924039842 451155592 -894114131 236088385 -921592541 351310446 841898852 -809127591 -820455213 -273495740 -423566574 -527552721 -597083147 -919572746 977106867 -824826798 544128373 780154891 -109050942 59748450 65287693 -840611544 710942200 -179778419 718485050 312875662 970558107 873027560 631374697 -662396557 -142406607 168177805 284758180 346055359 -768305184 188221278 -646188190 809337133 500003318 -515611163 -46581707 290238868 269314033 -500214668 -307107780 -139648812 -696540466 362925507 -578492679 -349403424 416170017 6713371 36306099 906858650 -610493073 676822485 406913463 844839840 470822274 -423241221 -6029491 274942829 247952306 307234039 -787444535 719740167 -913923366 -959859020 594797825 395172410 -82938363 157597544 742394878 17375726 -970914223 256906004 -221639965 701086134 -969132989 -63936885 -718497964 476767206 -72861167 -272834493 380462160 958902339 776519371 318297615 -895723289 879025053 125077257 -281546497 958345819 905057758 -645538033 -1263383 42919306 671630512 735769852 373576107 -748783458 205284124 17976725 154412207 -138141838 -770670839 -482488130 -360403414 -319640783 -877618638 355157253 -535655421 -668733770 -899068759 899205200 472458614 566262734 512616647 -370955905 -890161035 -359039338 501530452 796952490 737018864 -113592644 -108541045 -691085234 -10792643 -27381763 -977073910 317225079 -999620549 999451288 345845337 8857103 -647653064 -973585266 171228581 692870018 -140719438 711620341 -653150065 -457096383 -972893078 733960708 44796880 -98682598 -332292885 -141727028 718508426 170111614 624131167 -210796445 473138697 64734407 -501693346 -430740188 707287994 675131273 -304031216 -106464477 -841462186 500278846 623147305 -875788976 -939227131 439806218 194475613 -266915691 294518620 -901478315 -569850881 515919163 -859564167 690088219 -829214930 166430187 -289339259 -30067955 575889422 -14839058 -321780023 -932575429 -956616967 547177797 492458623 713480202 -572323838 -829211715 -62264890 773776174 30960924 80135728 -735722803 260002746 -730004023 972507878 384492253 150897661 -915257687 -743954365 939426762 -452845938 520749277 187350302 433685831 -85977300 -845331184 -612448647 -855524508 471974076 465212512 326640772 -179602099\n",
              output:
                "999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288 999451288\n",
            },
            {
              input:
                "319 17\n150 -481 612 664 -810 159 1 596 592 -62 -158 916 589 741 -135 120 -475 931 728 -417 -84 -566 354 848 -119 948 -710 618 648 485 -909 770 -489 268 583 672 -988 -211 -371 264 -532 -162 911 668 -552 -790 -799 -812 -333 780 890 -866 221 454 779 -846 583 -140 774 163 93 305 -945 -876 -875 -805 -534 841 -739 124 -347 -846 269 -405 -330 -174 -6 826 -939 764 -509 842 -769 -136 -420 886 416 -215 382 463 -433 306 501 793 -13 719 475 -658 -376 96 -307 436 849 254 -401 -518 -478 -690 -419 250 -940 885 -846 -845 -867 626 -616 -428 91 -192 236 935 47 526 -26 -748 514 -193 470 -100 343 372 978 486 359 639 795 -346 -127 393 588 118 452 -260 172 -59 -956 95 -689 742 859 777 742 -370 224 -26 767 483 335 -179 -948 -947 901 557 959 -929 -187 563 -847 -754 -914 -878 -406 -338 -848 -296 -910 -493 -493 545 -16 610 619 -576 977 625 -537 387 63 187 2 490 -611 676 -386 177 -882 -889 348 208 -837 712 296 40 28 220 511 291 -42 -42 203 -336 -273 423 -549 732 -279 45 385 716 -253 -975 122 310 820 -89 -113 -625 -696 722 -490 664 134 -743 806 453 994 797 -906 -835 567 -653 575 630 336 396 805 -843 -787 431 419 597 160 -862 -840 -194 736 -981 -695 28 126 -621 -510 787 -40 -584 967 -316 -452 -738 615 503 911 401 606 421 -400 -679 -56 -824 -403 826 -717 -907 958 -362 384 986 622 -382 -398 802 418 -857 -130 -693 313 799 976 835 822 26 686 576 -893 458 -121 385 -425 -26 -615 914 777 159 278 -498 532 -908 862\n",
              output:
                "916 931 931 931 931 931 931 931 931 948 948 948 948 948 948 948 948 948 948 948 948 948 948 948 948 948 911 911 911 911 911 911 911 911 911 911 911 911 911 911 911 911 911 890 890 890 890 890 890 890 890 841 841 841 841 841 841 841 841 841 841 841 841 841 841 842 842 842 842 886 886 886 886 886 886 886 886 886 886 886 886 886 886 886 886 886 849 849 849 849 849 849 849 849 849 885 885 885 885 885 885 885 885 885 885 935 935 935 935 935 935 935 935 935 935 935 978 978 978 978 978 978 978 978 978 978 978 978 978 978 978 978 978 795 859 859 859 859 859 859 859 859 859 859 859 859 901 901 959 959 959 959 959 959 959 959 959 959 959 959 959 959 959 959 959 610 619 619 977 977 977 977 977 977 977 977 977 977 977 977 977 977 977 977 977 712 712 712 712 712 712 712 712 712 712 712 712 712 712 732 732 732 732 732 732 732 732 732 820 820 820 820 820 820 820 820 820 820 820 820 994 994 994 994 994 994 994 994 994 994 994 994 994 994 994 994 994 805 805 805 805 805 805 805 805 805 805 787 787 787 967 967 967 967 967 967 967 967 967 967 967 967 967 967 967 967 967 911 958 958 958 986 986 986 986 986 986 986 986 986 986 986 986 986 986 986 986 986 976 976 976 976 976 976 976 976 976 976 976 914 914 914 914\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_range-sum-queries",
      title: "Range Sum Queries",
      type: "full_source" as const,
      tags: ["easy", "Prefix Sum", "Array"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "你拿到一份長度為 $N$ 的整數序列 $a_1, a_2, \\dots, a_N$，接著要回答 $Q$ 筆詢問。每筆詢問給定兩個下標 $l$ 與 $r$，請回答區間總和 $a_l + a_{l+1} + \\dots + a_r$。\n\n序列在過程中不會被修改，所有詢問都是針對同一份序列。",
        inputFormat:
          "第一行包含兩個整數 $N$ 與 $Q$（$1 \\le N, Q \\le 10^5$）。\n第二行包含 $N$ 個整數 $a_1, a_2, \\dots, a_N$（$-10^9 \\le a_i \\le 10^9$）。\n接下來 $Q$ 行，每行包含兩個整數 $l$ 與 $r$（$1 \\le l \\le r \\le N$），代表一筆詢問。",
        outputFormat:
          "輸出 $Q$ 行，第 $i$ 行為第 $i$ 筆詢問的答案。答案可能超出 32 位元整數範圍。",
      },
      samples: [
        { input: "5 3\n1 2 3 4 5\n1 3\n2 5\n5 5\n", output: "6\n14\n5\n" },
        { input: "4 2\n-5 7 -2 0\n1 4\n2 3\n", output: "0\n5\n" },
      ],
      testcases: {
        sample: {
          description: "題面範例與溢位提示測資",
          cases: [
            { input: "5 3\n1 2 3 4 5\n1 3\n2 5\n5 5\n", output: "6\n14\n5\n" },
            { input: "4 2\n-5 7 -2 0\n1 4\n2 3\n", output: "0\n5\n" },
            {
              input: "3 2\n1000000000 1000000000 -1000000000\n1 2\n1 3\n",
              output: "2000000000\n1000000000\n",
            },
          ],
        },
        hidden: {
          description: "小規模邊界測資：l=r、整段詢問、負數與極值",
          weight: 40,
          cases: [
            { input: "1 1\n-1000000000\n1 1\n", output: "-1000000000\n" },
            {
              input: "6 6\n3 -1 4 -1 5 -9\n1 1\n2 2\n3 3\n4 4\n5 5\n6 6\n",
              output: "3\n-1\n4\n-1\n5\n-9\n",
            },
            {
              input:
                "8 3\n1000000000 1000000000 1000000000 1000000000 1000000000 1000000000 1000000000 1000000000\n1 8\n1 4\n4 8\n",
              output: "8000000000\n4000000000\n5000000000\n",
            },
            { input: "7 4\n-3 8 -1 -1 6 -10 2\n1 7\n2 4\n6 7\n3 5\n", output: "1\n6\n-8\n4\n" },
            {
              input:
                "11 8\n-23051700 655245616 -624732602 515078126 -155966665 571869926 -248945794 -69034835 88484351 718030854 -763841068\n9 9\n2 9\n5 5\n11 11\n6 7\n5 11\n4 6\n3 6\n",
              output:
                "88484351\n731998123\n-155966665\n-763841068\n322924132\n140596769\n930981387\n306248785\n",
            },
          ],
        },
        hidden2: {
          description: "較大規模隨機測資",
          weight: 60,
          cases: [
            {
              input:
                "482 116\n-573341 540367 487140 -936325 -700425 295433 803573 675013 -440664 921753 -975940 450902 -77315 488695 -649335 507078 -965972 -80178 -416706 -78420 -35730 -513749 -595551 359619 788502 -746107 -370803 477207 469740 -187784 -264005 361524 -788310 -28128 -88605 -517984 437922 984196 21329 -382569 346782 500478 -744696 542839 -706607 809766 -727091 10942 31103 -663305 805610 -602126 -196467 22488 720253 991756 -766791 189155 -527329 147455 411982 362243 647501 -316840 664405 -741362 -694512 923274 135603 364941 -501941 315376 571525 -903831 216552 443939 -252125 643616 -644976 -14691 -22220 226699 438418 -392308 -408991 848577 -547046 -778471 -585693 502289 -334983 880644 -471096 164066 680226 -242790 -861246 731477 707797 -460319 498499 79311 -276388 997312 80517 -995949 -705620 109378 -572545 -354575 489078 416369 -853922 -958804 -60645 -329752 -752996 -350692 -275301 887929 -971361 592259 -451191 352459 808408 -238150 -422282 -792596 -488779 -935006 95393 144599 860706 423386 542670 -100397 -555462 5174 4412 -527498 881539 -902723 -581588 67282 895105 -58936 816962 -856085 628669 929092 364625 -388575 532283 -176777 -916731 -947561 -971531 667682 989444 783238 -369828 306040 676555 -896013 -466530 -698813 658199 -712382 -62806 -976279 930398 670596 491696 -46874 -608271 -937843 -129707 -443106 -531045 -36118 200853 87590 248223 87805 -557054 -719509 969270 677149 -955028 -794680 -76149 -72672 -890014 529121 318816 -775983 556664 -955982 748100 472114 453176 -820381 -597586 100616 384331 481173 -787181 -143297 733333 40367 -917647 -768863 331965 -533720 312976 49391 823834 539524 -489605 494062 624227 -624053 -135146 -820315 -39058 419173 734005 -498151 544786 485431 546890 -278000 -138778 -668396 -207471 345407 978444 75109 -962578 -915425 -911204 981306 558958 611062 111390 -63069 665270 411098 605850 477892 -932704 -875681 -504648 28153 -723811 -113040 496973 418781 -896469 -660223 674563 -708615 -206915 -204093 689460 534400 -959655 953244 -675103 244210 17124 -256192 2767 -796286 -657542 -76139 -688083 -89087 -763351 -884395 107661 -157905 -695968 939499 692452 222617 476615 444684 -183513 122921 811590 -633048 -914260 125699 503917 -180707 479336 -30850 -689880 815922 -232463 -324891 -129061 759717 661810 108161 240162 -17234 -496181 585977 717475 -58553 19762 -85327 638861 115795 -250749 -642711 -290322 -119656 -298705 -531886 -658165 607751 -196614 376015 195477 -176046 -668686 265171 185657 442535 229545 187813 -716183 -795848 -798265 -959990 856927 -418712 978632 307096 518045 -421412 129859 -258822 856760 444501 -805342 -235869 454011 -717506 691811 -423244 136238 698391 982337 911428 90890 40558 -418084 -119200 -581134 224230 -218890 694307 -968444 362675 -530112 912717 26579 668845 -320804 -909005 -690066 -232553 504221 695218 162599 716119 269710 401486 141170 798406 548684 578130 -303993 308819 112793 -437778 -775333 67546 -578061 -321872 987032 2739 816440 323577 184794 -248542 693548 -307103 268147 407626 -83914 39079 833612 -657384 350449 142681 -260042 -562268 -101766 -855913 406392 71894 853089 864733 -853748 495442 -827195 936524 340369 192795 -400711 -705653 -680217 -708016 864901 -505249 259717 497766 -651899 606365 944451 896516 -79420 622795 -950167 -369923 -932827 44111 -660803 774219 833979 -981483 378574 -800156 586496 -528449 386799 391007 536191 -722939 -315611 -704603 -150547 -736081 -66253 -945953 522199 -789492 -238315 -250433 566927 613781 -531794 -684324 -37472 132750 16413 -813323 -754680 -806752 739308 336820 813701 -646799 -618469 -41172 -586827 896981\n195 365\n134 222\n450 466\n127 214\n378 402\n256 386\n90 376\n262 449\n391 461\n402 416\n419 469\n234 327\n164 239\n56 221\n108 476\n169 262\n103 351\n468 471\n332 447\n359 380\n424 437\n157 220\n223 313\n365 448\n444 448\n273 456\n206 280\n444 457\n104 369\n99 171\n108 415\n406 460\n59 72\n251 448\n473 482\n242 295\n16 388\n399 441\n446 448\n226 237\n412 449\n116 309\n428 448\n42 136\n257 316\n10 132\n196 272\n48 165\n304 323\n310 424\n424 456\n410 411\n371 458\n348 414\n387 390\n464 480\n383 413\n74 458\n156 366\n346 443\n210 407\n272 387\n466 477\n357 467\n124 308\n146 289\n371 377\n452 466\n463 477\n209 419\n99 178\n248 336\n472 477\n144 271\n361 435\n482 482\n423 462\n400 425\n417 456\n172 432\n34 114\n51 409\n241 450\n361 420\n348 355\n322 452\n98 148\n453 474\n201 278\n57 436\n465 479\n234 259\n440 444\n209 308\n334 421\n468 479\n188 203\n38 402\n305 330\n257 267\n61 94\n147 422\n173 242\n142 209\n307 405\n108 404\n363 448\n220 458\n288 340\n241 271\n167 261\n380 415\n410 458\n432 478\n38 456\n204 307\n",
              output:
                "-797077\n-2849156\n-2431772\n-6117477\n4836128\n3076645\n-7760737\n4564634\n-605507\n-308510\n-4517809\n-2567487\n-4628270\n-4859485\n-7344993\n-3776324\n-9946576\n-572633\n6745222\n110666\n531346\n-2928196\n-606414\n4433070\n205133\n4179164\n-4531391\n-316523\n-8813937\n-4190619\n-3467436\n-2564330\n1190796\n890032\n-667889\n-1389639\n-3999793\n1031728\n-1403065\n2263340\n-156286\n-6986584\n83451\n-1965536\n270166\n-4839843\n-1014206\n-1707961\n398231\n7378717\n-1881444\n-117361\n2923080\n5029921\n-320159\n-1965518\n2967216\n-5113204\n-4028724\n6199891\n4854048\n3168010\n-975572\n3187025\n-4839298\n-5852791\n-952783\n-2290122\n-897393\n4985498\n-5194128\n-4212332\n-484926\n-2528238\n4763467\n896981\n-3707202\n1737794\n-72230\n1344784\n268746\n-69125\n4396632\n4599519\n-455400\n6179593\n-3341541\n-6160311\n-3363489\n-549681\n-1673913\n-1008803\n-1145223\n-759103\n5506428\n-2322827\n-2183335\n-1203573\n41582\n-821793\n1150564\n2032358\n-3919963\n-3405438\n5696721\n-2718362\n4076166\n3041011\n-999826\n44504\n-3121892\n3905010\n-2117880\n-3909330\n-1277210\n-706227\n",
            },
            {
              input:
                "338 183\n-9637 -99609 28584 -9183 38676 11004 49983 51999 -56559 -57609 -68024 12107 -13044 -3479 49706 -63678 65573 -35424 -75276 56705 31806 35059 -87488 80970 -82785 -22197 -23949 67921 45946 -81243 33357 -28024 50832 -8145 -95006 -82607 -77180 63633 -46653 -1406 -20892 96989 -90943 54378 -54688 -87487 91845 26405 16458 -85853 62043 -28925 77608 -48511 78922 68121 77122 3504 -37581 71885 7224 -50699 -26681 -63134 36587 -14152 19095 12285 -37190 -3066 97361 54041 72595 67313 5332 -60277 -76462 -93330 -29751 76761 13042 70828 -45280 55943 -86262 -31523 48198 -2711 -68881 33264 56617 -82112 -2395 -92514 -53811 -49022 -7562 35580 -54948 44569 -4969 56389 50896 5239 77201 -76961 24979 29325 34555 -399 -94952 -24106 85568 -48938 -51161 16669 -98661 46358 -76382 -50596 -60322 -88079 -68095 -84442 28540 21113 -19066 -5357 41053 3616 17281 6204 -10457 36337 50314 738 -23210 72609 32083 66632 -59464 -45967 20169 -13723 -11261 -19044 -63447 34165 -43030 81378 -22977 51887 94315 -67976 74386 -97979 -50510 -52424 -9817 75843 -50616 87419 70224 -33687 48577 -11594 95286 61576 -30949 -50604 -8221 77574 52135 -34592 66772 -16713 -10888 -71791 59513 -28900 -31637 9573 -20872 44781 -13490 -48467 -49225 -48235 76512 -49563 97167 -75880 60106 -72854 -94099 -68106 -61987 -72965 2455 -86772 -67569 63825 -72727 33268 -44707 -27720 -3174 -19015 9111 -79397 -11962 -83873 97342 -72420 8483 -3896 -11284 20718 -13196 -69845 84519 12989 -73309 -47681 -7522 82096 91533 -74701 -47015 -62028 -64293 -48164 -79847 10410 53349 -36827 -43980 74452 12102 29761 -52941 -95889 -12848 99939 7087 -48975 -61700 33299 -68339 24693 -65984 -97234 83302 61432 -75282 -32832 -77920 97488 32602 -28579 -26365 -63310 2583 76207 10208 21902 -36371 -42896 93596 -7222 -48341 44303 -16471 25448 56686 -89209 -85327 77143 -87075 50889 -90429 64954 -76701 -78083 -11316 -29635 -42329 -50816 -90183 -78617 88492 8758 29363 30040 -80544 124 60263 99142 -58789 4686 42599 56830 64313 -71717 45046 -56811 83105 -40871 16384 57499 54945 -38992 -15419 5023 -62957 66372 -48547 -20582 72872 22889 26502 -52453 71742 79543 -29595 21334 55632 52337 59574 -74054 -89493 -95100 94677 70309 11946 41308 24191 -96450\n300 323\n8 231\n68 289\n174 338\n315 316\n269 311\n85 204\n249 330\n60 302\n276 301\n55 178\n153 234\n30 140\n79 103\n150 163\n153 331\n212 265\n74 309\n232 233\n315 315\n321 336\n85 88\n280 330\n205 246\n130 133\n250 303\n160 262\n279 327\n189 315\n119 186\n166 272\n38 67\n15 299\n175 329\n24 126\n34 74\n279 300\n232 325\n235 275\n17 27\n102 122\n224 329\n246 310\n64 128\n331 331\n62 192\n284 326\n218 227\n93 110\n317 329\n188 327\n93 189\n248 291\n162 235\n62 180\n16 287\n35 159\n295 337\n92 204\n283 301\n142 265\n321 328\n136 237\n155 157\n208 256\n129 131\n168 237\n326 332\n98 161\n283 331\n100 331\n19 67\n70 78\n288 304\n293 301\n122 326\n50 56\n169 323\n123 196\n205 219\n323 336\n178 256\n193 269\n229 327\n23 205\n200 315\n74 265\n126 291\n212 298\n243 277\n198 226\n317 318\n274 325\n250 254\n201 271\n266 280\n110 229\n253 284\n115 200\n282 329\n263 338\n84 141\n2 71\n219 221\n100 114\n99 280\n247 316\n9 146\n281 327\n8 169\n293 332\n141 250\n328 331\n145 217\n204 317\n87 312\n110 119\n21 224\n158 186\n166 293\n104 294\n298 326\n183 190\n31 318\n206 281\n284 331\n166 267\n229 266\n326 338\n137 233\n61 129\n75 224\n130 247\n96 134\n328 335\n39 200\n199 218\n208 336\n270 288\n127 179\n15 64\n112 242\n274 285\n287 303\n302 322\n239 313\n143 241\n207 286\n210 242\n319 338\n121 160\n76 166\n240 285\n167 222\n270 328\n183 196\n291 301\n109 278\n144 334\n169 283\n118 304\n318 335\n163 205\n159 313\n41 52\n287 300\n21 322\n27 304\n322 329\n311 314\n38 54\n39 115\n53 131\n113 264\n333 338\n289 333\n211 238\n133 304\n158 268\n38 291\n331 333\n266 291\n257 331\n",
              output:
                "282458\n-1213307\n-1783370\n-1242343\n3415\n-35878\n-797683\n-49352\n-1600898\n-392600\n68823\n-838250\n-309624\n-69654\n183153\n-1020266\n-541485\n-1737600\n-128011\n-62957\n244209\n-72298\n191812\n-542618\n16644\n-259814\n-1007744\n66880\n-1313126\n-24553\n-1091535\n194214\n-1736051\n-1095085\n-512495\n194615\n-337806\n-324947\n-99867\n-57006\n-243378\n-265681\n-372894\n-530626\n-89493\n-279097\n149610\n80302\n16152\n311248\n-1095652\n-198572\n-551639\n-700123\n-169761\n-1742990\n-477720\n525263\n-746385\n-233546\n-1060601\n225042\n-808170\n-74103\n-665662\n61950\n-1037155\n-69770\n-233345\n76905\n-1149465\n-67090\n63507\n53944\n126884\n-1037762\n123405\n-1328567\n26649\n-234990\n270160\n-1329202\n-1119543\n-421317\n-777629\n-1053912\n-1531913\n-1267783\n-831947\n-214430\n-454228\n-69129\n-25345\n6209\n-780884\n-42945\n-964750\n-163670\n-554794\n305406\n148364\n-399488\n-96677\n1478\n158396\n-1255843\n-314947\n-582633\n103066\n-290584\n342235\n-1016381\n-51636\n-545243\n-872844\n-1530482\n-246004\n-994374\n224011\n-1515993\n-1674282\n394093\n-108559\n-1556791\n-807016\n153606\n-1130975\n-459536\n76211\n-791860\n-559729\n-1209194\n-753887\n-313003\n30196\n-443754\n-349314\n-511123\n-393531\n442722\n-92443\n-1173294\n-243020\n83332\n163431\n-385149\n-788217\n-910077\n-502316\n267711\n-107984\n-499646\n-484117\n-593890\n76227\n-262225\n224134\n-1371377\n-956432\n-1406895\n-1435733\n278080\n-357750\n-1076217\n-20670\n-80410\n-1522941\n-1592311\n258114\n5557\n24001\n59879\n-247762\n-1289924\n145981\n365362\n-315952\n-1147559\n-1038352\n-1579281\n-89916\n-437608\n31399\n",
            },
            {
              input:
                "500 5\n-304574436 -676053861 -152123001 397871144 -896305688 -844444263 763673106 150797845 -797857272 -214689028 251527726 -875448262 953574602 89709946 -538939162 -919478676 -815429715 -68752979 -101982131 -849986617 -483180142 -805195284 183364967 -88351981 -873061157 775651415 214302567 -734137327 -520597972 354258844 347402586 251976312 -867152264 239319143 257440634 -148135158 -893507762 -525230392 -899964456 195428767 843546981 -714009258 -378068789 -99905759 -690214574 161114102 -747043104 226027820 -337540324 203143340 752618007 464589642 -611893051 -778689551 248976840 226652084 372056227 -596550046 -200282367 -790769431 176272276 529246225 -865161701 211971681 -872007462 329312984 -557707025 66042002 461147818 141860529 -81752513 669086092 -325374089 -127608 257484520 983075267 -26793960 -223507796 -356255274 -466507973 705916947 -613953843 501079114 674671376 -475806723 -824217697 233565527 -355219926 127850896 63254275 879343459 -262391578 566471824 -36135907 -381658364 307729534 -842802329 -746455672 99367390 -102088076 -645746582 625947775 -265440745 -673615702 50040257 -94409676 -915803061 434982632 -833311293 641903439 198458557 230563833 694566831 880074283 757400421 -326232346 -269592799 493135431 -247997635 276399590 66600997 245315469 711312494 -20306507 -852332696 803817087 -799004133 -420309824 18118420 496886434 426256013 -860413607 -869713403 570152711 506442651 -335123227 389698624 241130073 462945689 765070034 -42993736 -388835753 538946473 -171519193 904904516 435920783 -254811874 -951546493 -8516919 -236646636 -639118861 311939740 -748538692 60197637 -873396352 -531402371 649767776 -382744628 -722243993 585623283 -468251199 -145521240 -160441906 968847849 871364440 66240030 -826952973 -642731123 -35377407 -137475525 179913224 -403345009 897052332 -705953345 759390060 -75461800 855392516 181587503 -402095322 516975389 -108157530 -229544800 466136594 898789634 -183008540 -504464897 -675899810 -821791723 -621575304 -675089186 -501876421 414153796 -498914571 -974094769 41449535 784759831 265133103 -608421657 -435755934 -394558370 -991209044 -687162329 -100319241 148025344 -207033994 309562235 216208520 -315786630 -730509037 482823830 845122137 107009419 326270330 406529761 452128621 588675648 -884051150 -19365074 931732423 870414234 674971720 878002761 461523903 713419473 201026916 -157372719 -145151983 -143199486 -153633706 -777655786 34062382 362126469 -140055997 -866323820 -590669122 -855372098 -551684475 -53761000 -651456558 -763930756 -269740342 290051972 -887094738 -780141488 -999499036 217158539 -675161025 152379865 -782106930 -219153641 317990736 -945237251 -848998450 877614491 -553425010 318703118 -192053595 -680990258 362384195 -458280593 -253986632 293384711 -217964972 18232521 -736198315 -752280223 823078163 48118162 704747 31640628 39027013 -330302241 -815564081 -690510035 -780553767 609912490 -264195137 589892146 -431438899 27832785 779953373 486180603 -653313225 108819937 -950402311 -559304133 134424124 -223142502 -685173451 481908850 166453893 963113121 -941926698 628099605 134106386 -359857277 380653905 853976393 -804556335 495071203 815584891 -439259388 113248780 -212518197 950470378 -641279965 -236148297 657724043 -521556205 143733458 163006534 673007632 79533637 -292049823 366748638 -521021663 316897577 742707120 693074520 628484993 831006405 -580927101 731040585 -485918894 757356619 -139536869 588865203 725129598 -513080654 -570679400 111620700 58240949 -236435257 569819130 -937765605 -940005586 696757187 -399953251 14127814 -443427287 -584150654 487179538 299526164 -260662341 -39585884 736381711 552905458 -249412249 -216950398 -827045683 -526560768 -780619196 -512852290 9489083 -577576722 -274714282 -561111543 36490074 340172368 933397434 310527974 804821557 -995901926 29661340 952490401 402259676 -261250809 717221868 381117823 -817939595 792394662 418596892 -742508924 953731524 -165625853 679982648 527919544 610914377 -571964848 26567496 909136607 -616627521 -68153002 694655439 365460770 -285924740 -813706111 719755504 550106813 -149943297 -5370313 -138028377 596337779 -817637305 556493281 -658859224 -634919921 -727187174 -940839292 -675406338 268759747 943155076 -660145 731949818 408444749 -686093060 313343735 774917739 279621629 18673750 411472908 -247505591 -665180617 178238479 177434287 -718714305 -954050983 -969413536 716606101 559867822 395165730 -779298692 130824188 609530890 -700961340 -68401340 872053692 -581658502 774154890 876700678 -546790018 -939883927 -459188859 -543058874 -370858904 76237035 -483445594 639989840 259364230 -299943295 -443018344 168988663 -100177405 791420122 -718521411 -869208542 954246750 588970509 -240254600 927804669 -16106778 422653864 252731951 750300171 941962532 109735450 -96707667 776268928 970791017 885853094 77282906 -719188034 142085419 -673933843 124221836 96391372 -959831610 874335755 -54838954 667534281 -606778802 306861147 -991555064 666530986 716205475 -678301613 -629888241 -696004424 16818331 329509787 557340695 -741579090 195022319 -867381531 -299958670 465295448 113145386 139726171 192802336 36132968 684212313 667499797 -772131764 896717285 203226799 -877974454 -466362500 -589173204 -405325112 -909378576\n1 500\n1 1\n500 500\n250 251\n100 400\n",
              output: "-18308444573\n-304574436\n-909378576\n98837095\n-8753282006\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_dynamic-range-sum",
      title: "Dynamic Range Sum",
      type: "full_source" as const,
      tags: ["hard", "Array", "Design"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "請維護一個長度為 $N$ 的整數序列 $a_1, a_2, \\dots, a_N$，並依序處理 $Q$ 筆操作。操作有兩種：\n\n- `U i v`：把 $a_i$ 的值**設為** $v$。注意這是覆蓋而非累加：不論 $a_i$ 原本是多少，這筆操作之後 $a_i = v$。\n- `Q l r`：詢問目前序列的區間總和 $a_l + a_{l+1} + \\dots + a_r$。\n\n請對每筆 `Q` 操作輸出答案。",
        inputFormat:
          "第一行包含兩個整數 $N$ 與 $Q$（$1 \\le N, Q \\le 10^5$）。\n第二行包含 $N$ 個整數 $a_1, a_2, \\dots, a_N$（$-10^9 \\le a_i \\le 10^9$），為序列初始值。\n接下來 $Q$ 行，每行為下列兩種格式之一：\n- `U i v`（$1 \\le i \\le N$，$-10^9 \\le v \\le 10^9$）：把 $a_i$ 設為 $v$。\n- `Q l r`（$1 \\le l \\le r \\le N$）：詢問 $a_l + a_{l+1} + \\dots + a_r$。",
        outputFormat:
          "對每筆 `Q l r` 操作輸出一行，為執行到該操作當下的區間總和。答案可能超出 32 位元整數範圍。",
      },
      samples: [
        {
          input: "5 6\n1 2 3 4 5\nQ 1 5\nU 3 10\nQ 1 5\nU 3 -1\nQ 3 3\nQ 2 4\n",
          output: "15\n22\n-1\n5\n",
        },
        { input: "1 3\n-7\nQ 1 1\nU 1 5\nQ 1 1\n", output: "-7\n5\n" },
      ],
      testcases: {
        sample: {
          description: "題面範例",
          cases: [
            {
              input: "5 6\n1 2 3 4 5\nQ 1 5\nU 3 10\nQ 1 5\nU 3 -1\nQ 3 3\nQ 2 4\n",
              output: "15\n22\n-1\n5\n",
            },
            { input: "1 3\n-7\nQ 1 1\nU 1 5\nQ 1 1\n", output: "-7\n5\n" },
          ],
        },
        hidden: {
          description: "小規模邊界測資：同點連續更新、更新後立即詢問、N=1 與極值",
          weight: 40,
          cases: [
            { input: "3 4\n0 0 0\nU 2 5\nU 2 7\nQ 2 2\nQ 1 3\n", output: "7\n7\n" },
            {
              input: "4 5\n10 20 30 40\nU 4 -5\nQ 4 4\nU 1 1000000000\nQ 1 1\nQ 1 4\n",
              output: "-5\n1000000000\n1000000045\n",
            },
            {
              input: "1 4\n1000000000\nQ 1 1\nU 1 -1000000000\nQ 1 1\nU 1 0\n",
              output: "1000000000\n-1000000000\n",
            },
            {
              input: "5 7\n1 1 1 1 1\nU 3 100\nU 3 200\nU 3 300\nQ 3 3\nQ 1 5\nU 3 0\nQ 1 5\n",
              output: "300\n304\n4\n",
            },
            {
              input:
                "9 8\n-23051700 655245616 -624732602 515078126 -155966665 571869926 -248945794 -69034835 88484351\nQ 9 9\nU 8 -434317703\nU 4 -279839689\nU 4 -616758429\nU 6 -205297563\nQ 4 7\nQ 9 9\nQ 7 7\n",
              output: "88484351\n-1226968451\n88484351\n-248945794\n",
            },
            {
              input:
                "8 6\n1000000000 1000000000 1000000000 1000000000 1000000000 1000000000 1000000000 1000000000\nQ 1 8\nU 4 -1000000000\nQ 1 8\nU 4 1000000000\nQ 2 7\nQ 1 8\n",
              output: "8000000000\n6000000000\n6000000000\n8000000000\n",
            },
          ],
        },
        hidden2: {
          description: "較大規模混合操作隨機測資",
          weight: 60,
          cases: [
            {
              input:
                "304 241\n7331 -48073 -48627 77392 4334 -85277 12131 16041 18303 -90543 38355 -14544 -47165 -37757 29568 65086 60236 97827 68491 37092 -49608 5452 -14337 24805 -66339 11598 21883 95399 87497 85583 72215 -90368 36929 -34839 97351 -33326 17161 23621 29055 -28983 -87972 -53541 64298 -73823 -89859 -394 -31657 -96954 -53655 -44166 -47134 -67291 -6192 -66578 -42160 80683 71489 -48090 14221 -37665 -19220 70414 -8065 -49701 -21690 -23440 -11809 20585 -36470 -8382 -84957 60764 -48988 653 2637 36611 99878 50163 -9250 -8394 7312 -58569 -36927 45674 -8534 -9529 -70881 -48058 53946 -14968 -96034 -78791 74564 32220 2214 49471 -16340 -72466 -24525 93335 -55733 -33981 55868 77574 30925 86372 -20759 71423 70693 -66224 46695 -51477 74095 46029 22361 -64953 15267 -85703 -95931 -54933 -9047 90273 70383 16475 22121 95935 58369 -64337 -93088 31035 -73459 -50784 48223 -58895 67001 -96639 -83848 70887 -77069 30103 584 -98352 -3775 -48940 36948 78596 76928 -77324 -45988 8055 22549 -90482 41621 -33388 98201 12057 30965 -36148 70504 -38594 74596 23395 58227 -54705 -80912 -41084 18985 23146 62534 -38614 -78290 45210 -45563 -94844 -88900 9565 -84253 69620 -17949 32683 64520 81820 56000 33405 68272 -1646 3071 47935 27809 -2639 -18573 -59952 -34524 -50069 -73764 57950 44506 40853 92632 47184 17731 30002 796 41291 45572 -68800 -34127 -35606 66532 -21164 73345 28882 43752 -68521 60945 83470 -26980 -42185 -3705 58720 9529 62052 21922 -61079 -86352 55050 98263 44775 -47357 24120 -10900 -10443 -37694 93655 63704 51744 -43619 -40334 -78368 -2402 79165 -32677 66184 -49210 -48049 -20942 -48547 -58673 16109 -94619 83814 -88160 81335 -9914 -24277 -11604 -47080 -63427 -63108 91265 3839 -96239 -94381 -89901 -21104 82197 6259 -16142 -63438 53160 -79653 1300 -87053 72715 49909 18160 -3874 77702 -67019 -25516 -30734 45091 11797 -14663 -54660 81967 -50728 -31659 96799 75879 73988 -44079 8137 73752 84643 -9140 18376 65256 94354 -37800 -25129 -47181 -94322 64502\nQ 231 258\nQ 279 279\nU 111 -83200\nQ 121 206\nU 188 63306\nU 229 55404\nQ 196 242\nU 196 54782\nU 274 -49307\nU 45 -3437\nU 114 74451\nQ 23 149\nU 133 27129\nU 35 -75960\nU 27 97519\nQ 194 237\nQ 105 172\nQ 187 301\nQ 122 137\nU 280 14462\nQ 103 233\nU 80 -48586\nU 238 -95653\nQ 8 68\nU 121 13888\nQ 281 300\nQ 188 226\nQ 137 171\nU 188 51243\nU 251 -84365\nU 265 54858\nQ 220 281\nU 123 -66355\nU 141 -65280\nQ 180 289\nQ 44 186\nU 34 -9108\nU 119 36628\nQ 56 72\nQ 181 291\nQ 40 77\nQ 196 286\nQ 216 281\nU 302 -82666\nU 156 -98419\nU 211 -37113\nU 42 55709\nU 262 -12811\nU 87 -86410\nU 284 65735\nQ 303 304\nQ 81 176\nQ 69 299\nU 63 -46214\nQ 304 304\nU 136 78754\nU 48 16682\nQ 197 253\nQ 225 295\nQ 127 298\nU 12 -92333\nU 200 63760\nU 243 -21487\nU 242 13036\nQ 60 191\nU 217 -69172\nQ 139 182\nU 235 1104\nU 180 -53384\nQ 214 216\nU 95 13576\nQ 59 220\nQ 48 197\nQ 120 132\nU 111 -8714\nQ 291 301\nU 208 -71935\nU 290 -20570\nU 87 86132\nQ 243 270\nQ 69 204\nU 201 -42800\nQ 26 158\nQ 283 298\nQ 263 300\nQ 199 237\nU 204 88231\nQ 49 272\nQ 81 86\nU 264 97389\nQ 96 210\nQ 59 226\nU 213 -88851\nQ 237 275\nQ 165 247\nQ 138 292\nU 105 -45970\nU 222 10228\nU 38 60077\nU 202 -81260\nQ 187 285\nU 196 -74543\nU 171 -19036\nU 106 -58410\nQ 148 303\nQ 141 150\nQ 264 274\nQ 100 242\nQ 9 167\nU 217 42995\nU 284 -85769\nU 193 97786\nQ 301 302\nQ 139 226\nQ 156 298\nQ 155 210\nU 99 89406\nQ 285 285\nU 40 64339\nQ 5 245\nU 103 88635\nQ 127 238\nU 51 -40679\nQ 117 280\nQ 228 252\nQ 244 296\nQ 16 196\nU 99 -309\nQ 119 178\nU 25 -79479\nQ 284 287\nQ 196 244\nU 127 26539\nQ 267 283\nU 256 -15401\nU 12 -64308\nU 185 11334\nQ 158 169\nQ 249 274\nU 8 -74209\nQ 125 297\nU 120 -73547\nU 146 24027\nU 131 10196\nU 51 13001\nQ 178 231\nQ 211 268\nQ 65 152\nU 167 -53096\nQ 261 281\nU 176 -13589\nQ 262 271\nQ 292 301\nU 230 -26882\nQ 20 176\nQ 269 288\nQ 26 26\nQ 57 199\nU 293 46099\nQ 120 193\nU 216 22392\nU 9 45850\nU 143 75516\nU 32 -6922\nU 283 -88853\nQ 91 204\nU 172 -64614\nQ 172 200\nU 11 60699\nU 232 12795\nQ 207 294\nQ 147 302\nQ 185 201\nQ 18 173\nU 280 -69778\nQ 230 302\nQ 123 134\nQ 295 301\nU 122 47175\nU 80 13801\nQ 265 290\nU 69 -74992\nQ 13 185\nQ 184 235\nQ 293 302\nU 46 44172\nQ 142 211\nU 70 43479\nU 213 21102\nU 168 -7085\nU 30 93795\nU 51 -65015\nQ 243 285\nU 283 38558\nU 252 39150\nQ 151 212\nU 249 -83495\nQ 12 203\nQ 224 282\nQ 273 287\nQ 54 203\nQ 185 231\nU 104 -16213\nU 190 45657\nQ 304 304\nQ 140 282\nQ 116 161\nQ 134 196\nU 104 84390\nQ 234 269\nU 15 85464\nU 91 -51141\nQ 50 157\nU 269 -25922\nQ 80 302\nU 54 -75456\nQ 51 163\nU 220 -75339\nQ 83 202\nU 130 -45011\nQ 76 185\nU 241 -27352\nQ 180 303\nU 255 -20726\nQ 57 124\nQ 91 293\nU 36 17158\nQ 198 199\nU 61 -38816\nU 209 -17644\nU 154 44735\nQ 289 298\nQ 72 229\nU 82 53488\nU 114 -82262\nQ 228 266\nU 174 -54509\nU 148 -90722\nQ 155 248\nU 258 34769\nQ 236 269\n",
              output:
                "-285229\n-67019\n281885\n788590\n-482209\n736205\n-88543\n381530\n-42329\n676848\n-138880\n456576\n382623\n-88632\n-514061\n218726\n-800294\n-31333\n335910\n-580181\n26658\n-503461\n-29820\n-614556\n80195\n64502\n235926\n-85115\n68545\n-180447\n-280102\n75894\n-65407\n-566364\n-74860\n302358\n-621113\n278660\n-60731\n369614\n247764\n424363\n-607550\n-60573\n205060\n132823\n-726468\n-43376\n-318279\n-447832\n-456021\n-139132\n-430\n-80135\n-168407\n-107795\n-143784\n-140729\n118079\n-54660\n126519\n-64264\n-528433\n-414019\n-388874\n229912\n-319126\n-109190\n143678\n-119380\n79944\n-405425\n-419327\n462482\n-261220\n-216594\n-45177\n27438\n228370\n-344270\n-250346\n11598\n-232026\n-199502\n-73440\n-5923\n-535763\n-609122\n109008\n72294\n-572714\n-104029\n190560\n-231835\n86809\n219635\n227745\n-289861\n-862158\n-242080\n36103\n-543128\n-187535\n-347721\n226323\n64502\n-687797\n-202451\n-395826\n-444412\n-269471\n-359059\n-82203\n-177879\n-178689\n-220217\n52932\n-884056\n133485\n385124\n-2668\n-436559\n-469945\n-506425\n",
            },
            {
              input:
                "299 288\n-33469 -75674 48357 28206 20161 7817 10843 43420 -32690 -25328 17352 -44349 73439 12869 -62790 90163 -88277 -34581 62369 -98360 1080 -19465 61892 -40016 7363 -42624 -73065 -74145 -75836 -14555 -82792 56355 86220 -80255 10144 48878 39981 67102 -92877 -84117 -83954 -75031 -40275 -66564 43896 -16352 -80267 62540 -23722 -14212 5757 27253 -92162 -37047 -70413 10657 -25684 81348 587 76927 87368 -27329 67172 92226 26433 88875 -56158 -20029 40288 -11182 83868 60601 -23321 -38223 -33141 -60236 -25601 60117 -92311 -80248 -80076 -82866 -50799 -26720 39680 3473 58316 34090 95448 24715 -67684 93904 3337 88245 15247 71962 75630 90313 74035 -16162 11804 78423 43220 85914 -5212 50143 20455 -94290 40209 -60113 -19259 56742 24696 89850 70917 5101 -93307 -93096 99405 -90882 4154 -80388 -68411 -88990 -84289 -23915 -15222 -80474 -9796 -88377 -35023 -35095 97815 26006 -45647 -40733 77645 36164 51945 28376 90774 -50133 -21333 50783 -84822 -85666 72595 54625 -79026 65985 33237 31622 56260 93499 65289 22690 22692 54049 -14975 -6912 82148 -42164 -7590 33789 77290 -4308 -96742 43732 67757 16639 13572 -51903 -60987 -34695 45252 -67055 86032 -87874 -78781 -55514 71133 78747 -79836 -72720 83182 81697 48520 -82273 -79421 3223 -97499 -60943 31635 44195 -51395 -37247 22946 -46664 -12447 -29786 -66352 92470 79380 81966 -23094 -58907 20874 -77369 -23487 -63706 -87985 -18227 77237 -20820 -22911 81576 -81576 11441 -60589 68181 31420 -86245 86656 12564 77337 -26314 24723 -50604 48452 63608 -35681 96192 -88137 3406 -62040 31127 46142 -89426 65725 96327 -96045 2084 -77605 -77683 -93023 72632 -36975 -6253 -98144 -13762 -59957 -20509 93574 -18301 97256 52708 18624 -44800 36776 63476 -7420 -27447 23327 26832 6839 67551 -51631 -260 6772 89440 13662 45694 31240 8086 -81009 -21011 -71678 16644 -71185 9372 90306 7157 42102 37262 -31747 -49478 -15953 20549 10704 -84979 -61303 76479 21429 -1847 42173 42697 -35135 -98194 -12500\nU 121 60989\nQ 15 153\nQ 194 205\nU 250 37909\nQ 27 209\nU 152 -93069\nQ 281 287\nQ 165 219\nQ 285 291\nQ 97 109\nQ 12 235\nU 51 3337\nQ 257 287\nQ 194 197\nQ 65 249\nU 90 11308\nU 173 90813\nQ 8 10\nQ 254 282\nQ 181 290\nU 19 53416\nU 82 44215\nQ 237 270\nQ 136 221\nU 94 9440\nU 174 83120\nQ 141 278\nQ 180 199\nQ 274 278\nQ 55 284\nQ 7 109\nQ 197 211\nQ 263 282\nQ 41 122\nQ 134 135\nU 257 -81838\nU 151 -32821\nQ 167 231\nU 236 88696\nU 290 53167\nQ 214 250\nQ 257 263\nQ 204 208\nQ 146 234\nQ 225 284\nQ 183 185\nU 11 50593\nQ 182 260\nQ 162 209\nQ 247 270\nU 155 -3939\nU 1 -13647\nU 23 58569\nU 21 -29054\nQ 266 290\nQ 154 230\nQ 291 296\nQ 280 281\nQ 125 219\nU 251 -44351\nQ 183 289\nU 53 82825\nU 11 -18465\nQ 132 217\nQ 156 176\nU 49 -9368\nU 175 -49860\nQ 117 149\nQ 293 293\nQ 67 133\nQ 171 232\nQ 11 293\nU 1 12250\nU 253 43131\nQ 36 59\nQ 85 169\nU 24 63187\nU 214 41323\nQ 60 291\nU 99 46828\nQ 104 179\nU 220 66178\nU 42 37997\nQ 90 215\nQ 65 124\nU 199 -53664\nQ 189 222\nQ 255 293\nU 88 33838\nU 62 -20982\nQ 48 242\nU 35 67181\nQ 277 290\nU 206 59965\nU 259 73592\nQ 131 168\nQ 289 292\nQ 228 264\nU 120 -39374\nU 126 44127\nQ 111 257\nU 111 -63787\nU 150 -92592\nU 273 -41562\nU 219 -66939\nU 172 -32029\nU 167 -802\nQ 260 297\nQ 193 210\nU 128 -46532\nQ 218 269\nU 126 53927\nU 297 90346\nQ 259 262\nQ 184 211\nU 89 18690\nU 151 10760\nQ 264 279\nU 267 -17548\nU 17 -71740\nQ 243 285\nU 262 72344\nU 273 -14778\nU 107 -52562\nU 64 63941\nU 70 -52118\nU 181 14322\nU 211 -68887\nU 74 45929\nU 157 19406\nU 180 -93318\nQ 16 291\nQ 143 200\nU 287 -76333\nQ 97 102\nQ 204 246\nU 215 27467\nU 172 48535\nQ 271 277\nU 97 -89117\nU 73 23725\nU 62 54651\nQ 175 299\nQ 277 287\nU 274 -36416\nU 122 -1752\nQ 29 216\nQ 253 264\nQ 24 189\nQ 167 272\nQ 85 90\nU 184 29359\nQ 128 142\nU 186 71463\nQ 286 288\nU 246 -63039\nU 163 -79598\nU 174 90948\nU 232 -3215\nQ 257 298\nU 224 4185\nU 298 -53465\nQ 46 125\nU 65 87429\nU 57 50887\nQ 137 232\nQ 293 294\nQ 206 238\nU 151 86631\nQ 272 289\nQ 271 280\nU 167 -32907\nU 273 42557\nQ 3 131\nU 104 -38172\nQ 231 263\nU 51 -77896\nU 30 -2730\nU 114 96947\nQ 298 298\nQ 131 157\nU 169 97241\nU 159 90598\nU 74 46110\nQ 104 140\nU 212 59516\nU 126 57987\nU 268 42083\nU 59 52596\nU 204 74001\nQ 43 255\nU 45 -54016\nU 267 -56949\nQ 219 243\nU 283 13870\nQ 94 209\nU 103 94468\nQ 80 255\nU 249 -61964\nQ 211 264\nU 53 -63772\nU 159 -85401\nQ 177 245\nU 162 -31335\nQ 278 295\nU 271 -73685\nU 4 82335\nU 25 35380\nQ 175 269\nQ 297 297\nQ 185 243\nU 270 65558\nQ 120 211\nQ 212 214\nU 28 4511\nU 17 42140\nQ 131 264\nU 259 -3808\nQ 276 293\nQ 218 268\nU 128 -76262\nQ 207 252\nQ 62 284\nQ 183 265\nQ 222 243\nQ 80 87\nQ 102 275\nU 247 -88007\nQ 102 154\nQ 291 295\nQ 37 257\nU 144 -25397\nQ 204 273\nU 210 14699\nQ 29 244\nU 10 -22663\nQ 179 220\nU 247 -8331\nU 184 -64715\nU 137 95802\nQ 96 162\nQ 197 229\nU 33 -53603\nU 297 -46284\nU 147 -14993\nU 35 -61546\nQ 255 272\nU 11 -55002\nQ 32 75\nU 282 -24183\nQ 167 192\nQ 275 283\nQ 146 245\nQ 68 166\nU 109 -74852\nU 14 -46941\nQ 82 96\nU 91 28869\nQ 10 33\nQ 77 79\nU 110 -10467\nQ 126 267\nQ 36 298\nQ 58 126\nU 31 60182\nU 176 94391\nU 156 17454\nQ 66 161\nQ 79 174\nQ 75 93\nQ 244 291\nQ 29 125\nQ 196 246\nQ 244 245\nQ 199 205\nU 154 21679\nU 193 -17956\nQ 250 270\nU 144 89639\nU 68 -54032\nQ 131 184\nQ 224 255\nQ 102 132\nQ 268 271\nU 126 -89138\nU 80 6816\nU 183 38056\nQ 1 39\n",
              output:
                "-127468\n53972\n-8764\n79649\n-532617\n-212207\n454482\n-276784\n167543\n-21501\n-50371\n-14598\n317020\n-146134\n98515\n184906\n284511\n-210681\n-148968\n994373\n144049\n-192161\n146148\n500309\n-19641\n-121887\n-95000\n-37926\n-56530\n223954\n194333\n-69374\n-299901\n-93407\n148925\n155756\n220063\n119628\n99678\n-226183\n-238322\n160061\n361894\n-547503\n21429\n52925\n-152193\n106192\n-227757\n760805\n677832\n-10276\n168039\n415402\n-441203\n338070\n804333\n47222\n358864\n79047\n-54787\n-164608\n253054\n-39333\n105305\n102201\n-303552\n-56816\n-38599\n427882\n-199537\n286836\n27525\n-121034\n-68892\n-97578\n582122\n300307\n516901\n317064\n165305\n57389\n-105262\n283071\n557480\n428025\n19582\n18833\n-173845\n-210705\n271563\n-278362\n-53465\n198136\n-222753\n637226\n22688\n307809\n187388\n105204\n-292316\n107219\n-237810\n90346\n9739\n-195533\n178076\n302325\n-25796\n-49328\n-338791\n506404\n-176880\n-7971\n-92159\n16935\n-77006\n76931\n89215\n90376\n354742\n-64812\n31305\n300865\n301940\n168569\n-87513\n-138874\n-52779\n28084\n258207\n-266695\n-57795\n-21940\n172711\n760781\n90865\n298975\n-53385\n-240386\n99526\n-56288\n-170706\n72955\n327810\n317908\n-223540\n-372518\n40728\n-85619\n",
            },
            {
              input:
                "500 176\n48698 43137 92495 -90431 -71422 22339 91207 -886 30579 -98480 -88277 -6132 20684 74499 72944 55808 74185 37098 -8602 74929 76052 80226 -44822 -36905 24392 -15203 45849 -29019 2416 79923 86210 66972 -41391 -37201 16595 71642 -87892 89764 2000 -35143 52855 -99340 -89891 76527 -83114 2573 -4465 32655 -50079 59632 -32784 27971 39154 -83050 -75555 81731 -34664 -73314 -29448 70630 59424 -14796 17811 -43711 60891 -93633 -87601 70927 -1882 -35173 -13895 -85008 96584 13854 -79713 63330 -90195 -10454 -77628 79641 92718 -27671 67466 57010 -85610 -47262 -16949 -22397 63227 45507 91368 -28450 -1967 40053 -64001 -33492 71013 -13518 28984 17974 70966 30557 25951 -98617 -59802 50248 -45397 -39678 36668 -45126 95989 39665 -42214 28726 -80327 98646 63713 82151 -90162 53345 -46813 -21800 93989 -49313 36432 -46156 -77169 -2388 -80889 37624 -34324 96182 59862 -69031 -62153 62700 -38998 38843 -37548 -54620 -90010 77229 55206 75183 97097 -2990 -3528 -64090 -46839 25085 -91256 54812 -48303 -4686 -83422 88161 -4666 72776 -60074 10299 36089 -73511 90087 97793 70254 -46348 72064 39998 81028 38495 34687 -2591 -62285 -39455 17605 757 16655 -94753 -42687 75244 -60317 -91775 80723 53922 -29129 85216 59660 17072 -60515 -11019 -48309 -43688 -46725 -86743 -18565 51166 83251 -8209 9661 49755 -68031 29667 -32272 2784 -32603 65936 -45727 -74297 -4621 -33033 98989 68518 -28613 71422 -38178 -38440 87177 -64941 -22057 -96166 34550 33782 -32355 94941 -40268 91365 5054 2757 -37939 -47186 32038 -99784 6318 -14416 -8371 -8741 7768 86522 76168 535 72210 -40990 33775 -83536 34335 -2683 -89313 81573 47140 -18733 -59293 18451 72450 56515 14401 -73187 16397 77287 65650 32615 75872 45455 -78422 20159 5044 -87950 -71883 -88889 -391 -57255 -55878 -8190 80434 -11327 57989 6185 63468 -30711 4657 -54213 -80047 -91262 -55938 94271 -12094 -73933 83252 44058 -60108 16369 54613 93515 -85435 76207 14002 57735 43780 79202 16906 -59851 16983 60965 88301 62148 -51387 40106 -10398 -51024 -6941 25503 -6166 -18871 55134 -67755 76256 -91145 32993 -97387 30507 -93530 81550 -64382 83187 30100 61564 -1201 11621 -27193 -64850 -61549 46805 89019 -61153 -37333 34726 -66774 -57439 90838 -36702 -52107 -96289 27870 81760 -7050 68023 -63151 -66338 6859 9900 98870 15553 97681 62587 -39631 -732 43449 -11783 -197 -70088 60925 86969 11137 6284 662 55715 -43202 -14305 80415 -2866 30 72382 478 -24529 91378 -47179 6534 -57253 25450 -22663 36058 4346 97255 -70475 -46111 -96338 -921 26013 24834 80135 92482 -41526 94121 57253 -52017 -67169 65122 -56467 -84301 34064 -72384 -32923 -95908 -61356 -85632 -17944 51620 47002 50948 -52355 70574 -95881 48806 -21334 47702 70964 57457 42663 67774 25960 23837 -46649 32888 63593 -6880 -40705 -81396 30810 -58654 75434 33333 57616 -78568 -90340 54699 41036 -51219 -6592 -554 19238 -14855 -52325 -19925 -97030 22558 57895 -46845 -91175 -71196 -46959 -33391 61680 -52908 -17412 -56034 -32024 -59404 28228 -55343 -45497 18035 -95766 -10588 -95612 -21685 -70146 12227 10723 -91775 82854 -27766 -31082 78024 -22321 -31817 44486 -88456 -98020 -72321 -55693 5605 91894 26554 -49789 97588 -71610 98384 92609 13804 78341 -65091 70944 63685 35787 53930 85752 38932 33472 -65622 -25344 7038\nQ 469 481\nU 302 54150\nQ 168 380\nU 420 -99697\nU 165 -66909\nQ 157 256\nU 385 -12922\nQ 395 425\nQ 182 375\nQ 469 484\nQ 227 236\nU 412 -86978\nU 245 52508\nU 208 -88996\nU 231 49746\nQ 159 387\nQ 367 473\nQ 191 247\nQ 127 309\nU 82 -50790\nU 399 -86877\nQ 264 468\nQ 355 469\nU 104 -98879\nQ 438 457\nU 414 -50715\nU 417 29797\nU 304 -77563\nU 336 -98104\nU 164 90951\nU 407 -14820\nU 216 63967\nU 268 -7277\nQ 276 389\nQ 310 411\nQ 36 122\nQ 181 239\nU 184 -22692\nQ 138 462\nU 237 -54408\nU 192 -63256\nQ 368 405\nQ 472 491\nQ 494 496\nU 5 40908\nQ 362 459\nU 116 -58634\nQ 331 390\nU 26 -89520\nQ 237 436\nU 377 38889\nQ 255 296\nU 424 58022\nU 380 -95596\nU 439 76665\nQ 468 491\nU 252 -595\nU 356 -20871\nU 464 -72807\nU 41 -59517\nQ 182 212\nQ 16 89\nQ 254 405\nQ 39 210\nU 124 67323\nU 164 -48755\nU 351 -40334\nQ 275 285\nU 358 2910\nU 15 88491\nQ 128 476\nU 479 67465\nU 78 63344\nU 312 -32884\nQ 63 283\nU 298 33909\nQ 335 423\nU 59 16981\nQ 475 475\nU 113 -53025\nQ 138 218\nU 361 -92539\nU 297 -43700\nQ 165 209\nU 185 -491\nU 21 43532\nU 21 -10509\nU 82 -24233\nQ 11 342\nQ 361 468\nQ 415 456\nQ 467 490\nU 400 72496\nQ 436 492\nQ 448 473\nQ 395 476\nU 200 -38983\nU 402 -68359\nQ 496 498\nQ 72 444\nU 127 -8374\nQ 382 477\nU 160 -30976\nQ 396 477\nU 120 16050\nQ 432 481\nQ 68 280\nU 123 -2169\nQ 384 467\nU 240 -70526\nQ 153 363\nQ 376 485\nQ 98 487\nQ 116 274\nU 317 12930\nQ 132 431\nQ 371 415\nQ 40 263\nU 47 -99880\nU 94 -41368\nQ 478 478\nU 176 -94859\nQ 362 500\nQ 158 364\nU 222 9920\nU 447 86679\nU 481 -19273\nU 49 -51463\nQ 407 440\nU 6 17962\nQ 370 459\nQ 426 496\nU 237 -12127\nU 293 -57612\nU 438 90217\nQ 481 497\nU 228 -67366\nQ 42 434\nU 127 39723\nU 433 55343\nU 167 38762\nQ 337 491\nU 168 59880\nU 81 13150\nU 221 -10197\nU 248 -60163\nU 393 52602\nU 139 -8213\nU 184 -52475\nQ 297 338\nU 179 -36357\nU 91 -10289\nQ 198 471\nQ 321 337\nQ 240 393\nQ 492 500\nU 236 -26581\nU 205 -87904\nQ 445 456\nQ 263 431\nQ 304 440\nU 360 -27317\nQ 153 499\nQ 166 193\nQ 130 196\nQ 377 408\nU 73 44089\nQ 209 490\nU 227 72337\nQ 1 171\nU 472 78057\nQ 34 45\nQ 4 266\nU 455 74414\nU 69 24228\nQ 306 384\n",
              output:
                "-124613\n766759\n267097\n-160448\n776252\n-50260\n-170270\n844616\n-841832\n-85174\n467302\n-794004\n-820489\n-502438\n541658\n-40637\n-25521\n118565\n-273862\n-185137\n143115\n178614\n-840404\n592899\n322878\n104134\n75346\n-89822\n35404\n92358\n-592185\n-97695\n-879524\n-27496\n-81913\n44486\n-31231\n-263108\n242314\n-1241835\n-327676\n138283\n-645407\n-696260\n-1391975\n6782\n-6912\n-1214325\n-1395277\n-1073999\n291865\n-1055232\n-216618\n-1161979\n-1035929\n-120892\n-77289\n-203776\n-142892\n-72321\n-458958\n-278719\n6258\n-497144\n-380349\n584019\n-699485\n-430278\n-182840\n-828576\n-34632\n216500\n227630\n-209919\n-294577\n-112016\n-925844\n-206503\n-281063\n-141766\n-643723\n200615\n-235570\n-414409\n-205031\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_largest-rectangle",
      title: "Largest Rectangle in Histogram",
      type: "full_source" as const,
      tags: ["hard", "Stack", "Array"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "一張直方圖由 $N$ 根等寬的直條並排組成：每根直條的寬度為 $1$，第 $i$ 根的高度為 $h_i$，底部全部落在 $x$ 軸上。\n\n請找出一個完全位於直方圖內部、邊與座標軸平行且底邊落在 $x$ 軸上的矩形，使其面積最大，並輸出這個最大面積。注意高度可能為 $0$：高度為 $0$ 的直條無法被任何正面積的矩形覆蓋，因此它會把直方圖切成左右兩段。",
        inputFormat:
          "第一行包含一個整數 $N$（$1 \\le N \\le 10^5$）。\n第二行包含 $N$ 個整數 $h_1, h_2, \\dots, h_N$（$0 \\le h_i \\le 10^9$）。",
        outputFormat:
          "輸出一個整數，為最大矩形面積。答案可能高達 $10^{14}$，請使用 64 位元整數。",
      },
      samples: [
        { input: "6\n2 1 5 6 2 3\n", output: "10\n" },
        { input: "5\n5 4 3 2 1\n", output: "9\n" },
      ],
      testcases: {
        sample: {
          description: "題面範例與含 0 高度的小測資",
          cases: [
            { input: "6\n2 1 5 6 2 3\n", output: "10\n" },
            { input: "5\n5 4 3 2 1\n", output: "9\n" },
            { input: "4\n0 3 0 3\n", output: "3\n" },
          ],
        },
        hidden: {
          description: "小規模邊界測資：單根、全相同、遞增、遞減、山谷、0 高度分隔、全 0",
          weight: 40,
          cases: [
            { input: "1\n1000000000\n", output: "1000000000\n" },
            { input: "10\n7 7 7 7 7 7 7 7 7 7\n", output: "70\n" },
            { input: "15\n1 2 3 4 5 6 7 8 9 10 11 12 13 14 15\n", output: "64\n" },
            { input: "15\n15 14 13 12 11 10 9 8 7 6 5 4 3 2 1\n", output: "64\n" },
            { input: "7\n9 8 7 1 7 8 9\n", output: "21\n" },
            { input: "9\n3 3 0 4 4 4 0 2 5\n", output: "12\n" },
            { input: "5\n0 0 0 0 0\n", output: "0\n" },
          ],
        },
        hidden2: {
          description: "較大規模隨機測資",
          weight: 60,
          cases: [
            {
              input:
                "652\n788668032 153382406 857606675 12318995 762211940 17422677 471849170 207077949 129993430 752507175 697100701 466634502 522920907 768244789 150217669 517602529 924472673 523514012 119403395 587497182 843520913 132422884 581429005 673472697 622875100 382912186 504478212 736470146 946471820 212125598 962890176 860275874 886516603 276316928 370489515 2074518 218856977 725181063 0 343167168 371046339 14663481 692459394 295791711 0 0 728773765 227603938 514259438 49805919 970293987 73684954 698688445 421490317 26848919 0 322648487 53241353 848998311 12145488 763748624 31824499 240105186 556846562 226788453 858700740 0 56313301 114696813 895027275 744026251 0 758360745 887466982 118342224 672244206 788236646 831604674 91998984 726616725 790930831 369664403 405775065 550455959 0 0 569031903 852618286 756680872 0 0 454123981 53008128 149189313 865003535 20657096 166347733 380830199 175338946 466387679 567122440 993023488 625980213 418041840 187879508 0 757420514 929752130 445921183 567378903 257955715 482021299 839096832 182932013 359063138 823168965 612084250 647767797 629527073 145314321 0 0 669233635 578488056 950661382 391235427 866207710 581754001 978651197 297941231 626805814 16156697 979311597 347748674 0 867951724 650091848 584279317 808002616 569750254 546584037 513402698 677671770 867096868 720704875 938809475 585052755 459896162 0 954743409 0 0 306836037 149496300 644975275 822459056 471337266 322599867 0 938997561 0 0 712195799 350407455 135126699 779366309 383778570 239721951 579968092 125604147 0 180839294 211544986 668322723 861545391 280362062 941848964 184427629 535599473 601655556 818062433 125497764 490062991 158065653 346142788 772660746 215295398 230070189 485319884 889123607 327371126 575398358 699458208 571276095 156380346 231633107 206203292 645553799 123485144 0 629477064 32626276 835787003 684049005 473038444 862245458 242361196 349945540 0 20665067 861420195 246372536 648210118 539522863 776304501 804265088 780798507 810002352 0 540076179 258875404 326420456 932788154 414441019 975474351 926220341 386073631 301867273 946376943 471671465 205553927 518485754 908712131 885738624 931491999 268379459 423883757 837979498 872960798 547295403 0 0 755416340 30652394 205256450 105262443 421426312 796167058 490523711 0 436565610 368558732 394037674 0 107966016 127246929 0 924637038 297491652 413343116 759522364 499507403 503447187 197804216 301012548 905498575 878279307 722205817 882261741 653145938 380624358 290378672 938957631 748616780 805930372 0 788051266 395048838 991570097 442328581 74350044 453690745 533003076 442099748 681718924 543001535 690191784 281187525 21473048 595370639 271601699 102150925 810706727 794814344 613376473 313336670 799582907 596558136 65081147 286403358 350375721 275976184 877203559 900781075 105932925 499299716 548405178 0 523413346 282422552 829859824 0 692282106 185651703 929567456 433041973 745738928 258998441 779323689 573573010 0 128007930 81171453 828713526 0 108585395 901869736 625423550 485153734 178143420 188515115 929490950 519815973 697491549 0 805790270 677776705 424872974 26702970 509697448 10972313 824548107 321900833 385803935 837026454 197536678 880383166 495765909 629483869 367958916 0 0 387435743 710862178 848829234 925196057 270389611 0 705985024 893319464 392190678 807950381 605083180 907192343 0 303907145 935796881 56884476 158658607 0 0 943852547 573066932 663706638 351551491 644746325 89229655 909958894 838119232 952553575 722029506 826542293 245272915 112338878 426118708 205784136 109545193 324925059 244101764 99715084 942335777 953104881 569071211 677953000 827709591 0 708549329 620794419 693703155 903939818 958761965 881431455 0 845210133 484869297 958156668 283182128 523849366 208509243 712406058 180653792 231872001 0 554683916 72546400 301831408 789528351 871606615 821206503 0 428151496 843211443 0 253733638 599854228 771639593 768782205 723826445 508436984 737827823 490870576 243467480 868706757 754840604 107925573 845563071 615960287 261717260 656988505 0 211517291 533523306 689158763 7181741 602286597 484733801 223557586 867167631 337320262 949262623 928496280 664056527 531701017 882605173 49073305 891369608 447469047 471517397 642664271 0 808650891 60846771 728200098 748646347 928312419 651146205 138657777 0 225538067 285273122 770447902 0 648537860 394528436 238431141 635806229 767365651 254085025 603890559 699801971 720357434 0 58116969 290438514 640447303 177622883 36277731 213180804 842940685 915091037 619427958 656000064 996196402 833131282 995251672 371766735 538679603 0 670750607 0 774636654 302827856 108649455 830658757 897897608 890805649 367413210 26589086 69109423 320286122 764226036 290064291 22686542 744910749 969282151 224060019 766276904 804302286 493136837 5820732 940374961 0 461479438 780987531 952274623 0 435482218 226640761 581203900 955388905 920736901 426605158 215140531 617296926 0 425320219 639713541 0 0 8618115 610265204 985635812 850646240 253030217 256610100 291506108 846569048 0 184308322 0 919222629 357209599 569144657 419363371 848315599 607819985 648812236 77989720 57157994 269688235 574299345 532210695 0 175869402 850589061 894021978 749806082 925464795 605888577 297094423 984876371 0 749149286 313391600 353129687 533499624 276848908 420250711 315593865 350414819 770479558 544383337 947527707 306937387 885243366 73122034 80485161 540122435 504779943 599995077 323093202 138794725 931650808 521818192 522594986 36298892 769278918 31332705 531938041 346054068 26926942 739383871 107097718 694707094 371229781 144515019 129985785 243660925 698517427 152740906 0 524754980 636681834 838001082 265416106 861704914 417671630 450660069 0 80050248 939506155 608968721 384031963 0 0 676955045 78369320 549291117 33701638 763118357 492873016 113619892 220463332 122838543 241123396 561478162 260815420 658538160 29524962 797359618 176232544 968824956 649902083 916338695 937690580 493067542 735079621 692531511 0 0 851859592 139018342\n",
              output: "6160832376\n",
            },
            {
              input:
                "888\n1567 554706 444018 173766 448430 598825 258307 940434 527225 960861 723883 0 671686 533429 367421 0 91280 848365 316433 787956 914966 0 50054 465835 0 710435 935940 708488 249677 197206 147464 343394 251243 616165 421328 834280 0 280996 683313 54953 389157 626468 0 29944 203912 369752 578277 603586 708807 0 538223 20194 742275 466678 0 0 127622 514163 323738 564213 469124 857050 601258 690439 162145 480678 354958 146213 725512 777261 8086 881851 834537 703373 842870 749677 594311 781146 276207 959496 261632 869655 112839 845976 438292 346041 203101 201750 96480 23605 108141 129725 533074 883734 436445 0 0 433933 482873 738079 209278 766132 0 142828 441641 224082 448409 16445 799758 827658 204103 126644 11064 921638 268672 0 294542 704831 487610 774387 577214 626747 0 708572 0 38284 93199 0 196736 965384 0 435033 77826 400498 962186 164845 627323 580186 883465 465536 244035 148173 317674 506008 931083 686969 281620 609351 991495 19600 681236 850778 613723 15071 721077 674053 643700 0 956223 487664 816225 122664 563677 252691 332206 0 161751 0 738582 312969 848153 150837 11194 185 492606 571888 419570 265089 0 326028 571343 719306 987903 817935 77411 60649 0 632089 0 68572 569545 769477 32922 0 208826 0 527410 131833 561961 125022 742553 446300 0 0 400584 569661 506170 330935 241758 30841 69769 602823 460577 795870 693062 278186 9943 425588 742736 12122 283502 199428 799210 949988 0 16462 273221 139744 766060 13186 731964 250294 922765 418637 57378 428809 972203 940115 467767 372913 473003 652725 256590 704858 955009 647631 559467 510347 0 669712 744125 543661 936359 863364 234199 576282 616355 2611 23351 201625 794798 569365 0 281434 15415 728775 287348 670156 298821 176636 38928 0 116424 767123 781170 983724 31707 0 309971 339375 416776 875454 279232 140967 997083 479975 159501 909765 875024 0 899863 834734 424858 525045 259973 101442 560640 92351 270005 825090 616796 836582 290926 423569 979709 651605 652345 245776 185356 340887 824779 776305 594380 695406 736527 809130 344437 241582 924860 745037 173553 83277 0 887955 0 568276 586348 636405 32866 0 648837 230689 768681 589911 866869 638775 983094 112144 321968 76791 675965 164865 618443 982480 609657 544714 737010 496199 475895 0 76434 897869 904823 916840 754600 542171 252792 557567 508692 0 144934 238925 816662 0 590127 411688 696982 681447 596528 374766 584982 853093 473096 67701 599903 482701 535061 521544 879348 429223 729749 690269 260603 968744 23513 270232 780932 724004 399293 306184 0 502978 480070 45718 606437 827914 369687 419644 841608 165221 277642 397638 986092 193703 899506 414031 539080 708573 0 14478 185481 898583 0 234390 62204 0 945570 0 190876 841033 690515 667825 318534 320489 221860 187480 306488 0 350604 552744 0 328318 151950 690539 168940 505957 640935 120852 380166 889168 286813 420416 925910 508983 799195 447043 594974 704146 981394 631359 205726 722816 62071 0 647018 822713 424828 958355 656325 0 131895 200561 711808 296527 423371 515688 172108 877123 356717 904806 133780 112589 691822 698864 608544 882352 989614 284089 943747 447261 827111 109569 0 707617 308748 18297 127374 488875 883035 552899 465766 934856 161386 545029 991293 192318 15638 85761 764286 343975 364462 867091 330844 501980 22962 940386 122631 48497 172606 87706 930837 55712 931232 306390 972169 200340 72332 367728 624039 660586 963380 292638 0 0 313260 0 367839 195104 368592 192384 139388 102589 735105 497870 396195 925996 338644 849119 85970 788399 705440 805233 5554 986415 295862 650498 314923 96410 721329 701298 252622 933035 659268 65599 920924 576926 449229 530146 569123 778479 729678 0 219263 634207 274155 911720 0 33806 421567 474058 90108 51520 772177 776360 161053 910947 321540 0 883137 210570 65441 0 750186 26492 276621 593823 719551 980764 601788 763827 912752 0 706752 276971 984731 955830 399927 781982 0 271756 448067 904641 30076 549378 0 0 58946 759374 640388 761651 777456 645763 319588 881844 517584 371943 979811 0 486646 216962 453578 598466 0 37517 237445 962922 0 992153 0 944552 784637 22270 0 85791 297317 437468 548116 0 560405 0 14027 634299 835447 428135 0 780546 785542 661588 414563 544000 23533 360324 604618 736640 324913 989554 179184 836999 713886 210407 0 883436 819186 300216 672000 193826 513813 116083 853 154367 512750 420290 595493 269010 0 635353 786927 365531 463910 351288 693642 0 709081 862939 408591 523073 529674 647941 184009 906640 990060 0 985990 867855 794328 170355 247941 863063 913215 559817 827151 413603 566956 238051 360087 0 998875 439238 357322 716723 25697 929163 306288 828853 616733 512053 270189 742063 276687 690739 82199 170736 143695 251689 370318 0 0 0 541403 319165 430007 969021 943419 602982 963695 961335 193534 967487 0 182138 909775 139473 472889 105940 690794 535646 5992 389688 981757 0 341280 829108 828953 637981 168084 732921 92545 0 113664 174487 0 850390 552284 899284 106858 255263 225746 177561 972044 988159 28566 138808 226804 197641 474428 571129 0 0 890929 959423 747620 389347 670532 769127 545099 932921 929494 467030 882640 0 0 224750 575432 108336 594562 57557 648745 634626 546818 646175 401275 624885 683527 368748 872354 524027 381990 456948 0 317111 508660 779265 778609 49317 0 868598 372686 464066 686572 710103 35600 286454 4056 431592 670677 587117 633813 247223 723044 10896 859007 738313 909824 82970 979901 408214 320280 698909 420165 589361 507202 705102 371420 377815 356741 100642 702561 639475 556802 599407 654908 679538 826523 206021 420883 340074 496944 886871 974820 742361 82311 471614 450601 913713 314136 998505 186168 550871 894505 556983 662102 870666 363008 754819 28038 335911 0 120187 0 1832 32773 577762 23436 934679 605931 371170 707797 743909\n",
              output: "4424976\n",
            },
            {
              input:
                "569\n100 72 99 99 70 36 84 18 92 31 0 79 28 11 8 9 72 81 0 0 16 9 41 3 14 36 49 35 61 21 43 78 32 78 0 0 0 68 65 15 91 85 84 40 99 46 2 39 92 3 0 4 9 7 9 31 61 26 28 74 24 73 0 10 81 76 59 75 88 45 46 0 56 19 70 90 5 0 83 9 88 8 0 19 23 60 42 100 87 37 11 17 0 38 88 0 64 6 86 24 72 95 0 64 5 1 10 0 45 0 38 39 57 66 45 60 81 52 55 52 0 14 52 33 41 7 59 69 42 0 78 3 13 63 62 57 0 55 3 89 92 16 69 27 71 68 6 2 12 53 60 91 3 16 95 34 43 49 1 92 0 57 45 7 74 20 86 0 67 33 23 89 23 89 35 2 0 83 13 0 96 94 39 90 10 94 92 0 98 8 0 32 41 17 58 72 58 36 64 20 64 95 80 59 93 45 0 0 83 0 58 67 61 8 38 27 97 37 0 68 5 42 49 38 6 43 93 6 78 47 62 45 13 12 0 39 32 59 17 12 64 72 29 84 5 16 95 30 2 48 0 54 81 69 8 87 42 78 5 68 91 30 71 100 24 81 99 0 79 90 16 49 98 81 79 63 76 87 7 38 11 95 0 69 17 18 64 32 72 63 36 29 66 70 27 25 77 17 75 3 96 3 16 84 89 42 41 56 86 75 82 18 0 8 51 31 63 74 54 64 85 27 22 96 82 65 15 40 83 0 60 60 84 68 26 4 80 17 51 55 0 23 71 39 75 100 98 0 3 87 28 71 0 2 50 11 99 62 42 55 51 86 38 60 15 88 45 40 68 46 78 7 70 0 27 5 79 41 95 2 45 42 41 0 49 51 82 18 85 9 0 93 57 97 59 50 74 96 0 0 16 2 73 34 22 71 96 44 91 67 71 75 39 0 19 79 97 32 25 100 57 90 12 0 80 0 28 96 81 5 32 31 96 39 95 71 25 39 77 31 80 69 14 64 93 80 0 11 27 21 54 96 85 0 57 88 39 43 18 52 46 17 39 0 44 30 16 71 67 27 0 2 0 0 43 74 75 58 67 92 93 2 0 0 91 69 32 64 68 50 93 0 11 51 69 77 0 70 80 19 0 25 77 97 26 86 95 43 55 79 36 50 50 91 53 2 8 33 44 0 45 12 34 0 33 93 54 0 0 74 36 41 8 13 33 21 7 10 70 41 79 85 49 79 49 0 97 0 25 97 5 62 81 2 0 1 27 58 31 8 65 14 12 78 43 72 85 57 16\n",
              output: "380\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_count-inversions",
      title: "Count Inversions",
      type: "full_source" as const,
      tags: ["medium", "Divide and Conquer", "Sorting"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "小翎在分析一份長度為 $N$ 的整數序列 $a_1, a_2, \\dots, a_N$，想量化它「亂」的程度。她使用**逆序對**作為指標：一組索引 $(i, j)$ 若滿足 $i < j$ 且 $a_i > a_j$，就稱為一個逆序對。\n\n請你計算整個序列中逆序對的總數。注意兩個相等的元素**不**構成逆序對；另外答案可能超過 32 位元整數範圍。",
        inputFormat:
          "第一行包含一個整數 $N$（$1 \\le N \\le 10^5$）。\n\n第二行包含 $N$ 個以空白分隔的整數 $a_1, a_2, \\dots, a_N$（$-10^9 \\le a_i \\le 10^9$）。",
        outputFormat: "輸出一行，包含一個整數：序列中逆序對的總數。",
      },
      samples: [
        { input: "5\n2 4 1 3 5\n", output: "3\n" },
        { input: "4\n3 3 3 3\n", output: "0\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "5\n2 4 1 3 5\n", output: "3\n" },
            { input: "4\n3 3 3 3\n", output: "0\n" },
            { input: "3\n3 2 1\n", output: "3\n" },
          ],
        },
        hidden: {
          description: "小型與邊界測資：單一元素、已排序、全逆序、大量重複值、極值",
          weight: 40,
          cases: [
            { input: "1\n5\n", output: "0\n" },
            {
              input:
                "50\n-91 -89 -88 -88 -86 -85 -85 -83 -82 -78 -77 -76 -74 -70 -69 -66 -64 -62 -54 -46 -44 -43 -39 -26 -22 -18 -7 1 1 7 7 8 11 29 37 38 41 42 43 44 46 47 48 49 49 49 60 61 66 74\n",
              output: "0\n",
            },
            {
              input:
                "60\n60 59 58 57 56 55 54 53 52 51 50 49 48 47 46 45 44 43 42 41 40 39 38 37 36 35 34 33 32 31 30 29 28 27 26 25 24 23 22 21 20 19 18 17 16 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1\n",
              output: "1770\n",
            },
            {
              input: "30\n2 3 2 2 1 1 3 1 2 3 2 3 1 2 3 3 3 1 3 2 1 3 2 3 2 1 1 1 1 1\n",
              output: "183\n",
            },
            { input: "6\n1000000000 -1000000000 1000000000 -1000000000 0 0\n", output: "7\n" },
          ],
        },
        hidden2: {
          description: "中大型隨機測資與大型全逆序測資",
          weight: 60,
          cases: [
            {
              input:
                "600\n950726856 157981378 984224211 -229751883 3172678 -895801978 424792360 81301736 -539315436 292877138 -523910933 970387350 -380402790 42525068 486966512 681506810 -543924365 -293397374 -59440765 -848912750 -451872117 -584920125 -654112164 -809166934 -43915044 653330349 153903088 -212915078 -588517791 12929945 688519097 -299859623 -487137263 368863876 699078283 -132643536 -93113237 -552748507 -864925531 -76251238 4412071 -346542595 -545275165 -762060651 400755918 768219761 341992482 460604545 -294483922 427628039 844411861 895039579 -425937766 -152510763 679991835 -185505972 -507973943 -91685210 -834989999 -131225972 598735029 436527329 -101416461 -986001422 872237954 -3341226 -534640199 149083225 -796633605 -258013940 708549258 -953042777 -203488794 513107139 -227738109 -979719459 -437218927 212062233 759606048 -670647506 -925735105 -72742144 -611644865 -403549604 -858826484 639833865 -676248079 -130967748 470742195 563961592 778383595 -220926506 925038468 400994057 222067003 20342779 -642807776 70416896 812164894 880982809 96153533 -331500961 864544114 868290401 -610967958 484083613 139402542 467711732 874824601 -987227369 -819479645 -858376646 -931295701 236253066 -257474445 147163080 507837481 880566629 -50237051 800827461 754974249 -744724183 451325631 515531844 309688688 663180591 300177398 737865831 -10823527 701309923 369219042 -698674044 472675921 -615960407 985153665 702009895 -568654131 585308157 916520527 175394445 -41199549 910341803 -700621499 -825579631 -677908064 899395584 -330121524 -275102709 -194654728 -854931633 -872056183 177973764 181833084 480057513 -247576250 -5682766 -876534011 -586576723 -401559634 458279705 770603703 -296538567 -805375655 -398456250 -669192239 -463089963 984899 -560972527 -87360076 -759068137 126118970 718543922 934990943 -314619393 -475267618 -794646974 -397426715 402971825 906052200 -621946418 -973991394 -969624907 359455391 -150704699 839787509 316392482 -14691957 408620561 222723635 -904526998 727153787 -277423732 -487775647 698335172 -413207918 12014603 418215594 -579580728 186134854 273719349 149649624 -322763962 -281978329 -960225272 -712770659 -381199532 -257949212 457895401 -217584089 920194225 -134045973 -139295565 370872189 -883322780 599933946 -526698594 108860701 -857639328 -535826768 -681901530 427916435 -741346117 -686781191 -264490612 -739244168 -205574203 -948928944 -39251402 847230480 428278374 -565347134 453206292 441572782 475843419 767895373 -217560229 102001228 423483479 345208263 180698386 -551338889 -726149877 -15614826 172186086 194235838 -316350976 -355310590 451491168 -353344325 577916628 -451182218 -483052565 894329777 -65575459 -562867048 -23106133 -362425636 613518230 -913014347 -471552903 -893454398 241609243 -264237375 588991451 887332811 -57766983 -58290275 431651519 -889136847 -422356843 187009222 525531722 -560918910 -927650960 660466971 932427976 -1078115 328120776 980187800 803789073 -874917746 -971562760 -115628738 991696819 -29181757 432990644 -411301941 653655709 323823855 -691944836 46675220 604480853 729328962 841873484 365347755 -867754405 -923538405 486295253 868415055 -428814084 298063234 370673699 -739762180 484355826 -815061367 341485061 713840871 -34257114 -272084024 117637477 567735584 -844178774 -684744817 8370755 532503988 -104182650 -766661973 -430530942 -986268753 -487806717 -233341951 -534475326 383512220 710186901 141707178 -793629865 -501056237 575254199 -587063762 398536115 -660579695 -630601656 567659707 967417750 261289736 679877035 427633490 587579097 933260561 -587884683 -36355329 -705841199 -918792587 -593524436 924549886 109293553 536103328 706047098 972531497 467607348 97790361 890375998 -512982519 -774484941 272746232 132805113 -973481978 -284929705 936282330 999430453 92066468 940917565 -724858283 238857267 416845122 32975362 949085568 -723191240 -764455496 -762733548 -912106904 -37171399 312934191 225595537 530508944 875617464 316899464 293828229 -803919035 -408663651 -134747516 618962305 -712426396 503291071 -872041630 -749971895 -381020886 470095637 139793204 -867254203 -793204229 -361710907 -381041942 -494925804 -643990787 553140171 777934776 -165875727 408274403 199128239 -186075717 -674829804 711035575 832367493 885164162 974320049 521670455 621592043 521325249 360640364 -285883564 496940214 -930377279 -484288211 -345217840 -163993874 928052803 -481322653 8102708 -477743340 -569670949 -123880173 -675346690 284814407 -647290278 64086180 -57188120 45647995 987990159 -584008080 898153346 -412113495 627253510 -941578778 623750852 949398568 -590129955 -293027859 669711339 -917374467 -518925010 -330599998 128898452 -432997345 -928093875 623659681 916395348 -194408144 -724103136 -453565653 272726950 765764702 422099584 552196255 382908678 465249516 324425158 -206903799 664169591 701363076 934955149 -16212433 325191508 -433444006 825022787 -880742501 -26547477 442347022 -351846704 -803553733 -621090407 420055724 -954807185 -202617556 35962963 834958035 -904002575 830051148 -174736738 -906640677 -239838718 -878240053 -502251923 -994441612 -184198063 -730560504 49868515 -159328015 793617892 -776123656 968806571 576556933 -599838090 -96202416 476773381 419734801 707714736 600671556 561066798 -58382895 -420928284 -207684921 763904837 564020199 -539363257 469591643 280113468 -388947785 833243390 -146724646 -703451526 627504447 -647208777 108820203 425204594 47816064 -361720108 975067726 -503503533 -97032901 885718105 844571052 128657040 -899595679 -884338381 139140590 -769480697 531157031 520417117 -977012215 615283515 495366294 52061635 -385768141 -18817970 343598754 -199198353 338459986 -379658379 -707023773 -216274641 30707434 -479030844 660083572 -706983843 653928707 -49318362 595059372 -862632564 -165498680 -782515931 334398822 635362533 34184108 -790545790 162426670 -868482145 901482882 453822541 -25503650 -415905289 749032561 -257532282 783023922 -179192323 -646618006 636612596 -835722491 191305935 684083556 -498159130 860490082 622826975 831709303 533799901 157023012 94993188 645109777 -103991389 588856997 -101183006 638355979 -628638391 957665464 491760557 -882961142 -195054815 591703372 792825832 254659545 -778378200 -972723780 -634317830 -451617329 761386958 537637078 -660035293 136255486 -728892976 207751065\n",
              output: "87634\n",
            },
            {
              input:
                "500\n36 28 -5 -29 20 41 34 27 -27 -1 -13 29 4 22 24 -45 42 17 19 29 45 16 -27 44 -2 6 -21 15 -34 -40 -44 38 -27 27 23 6 14 -22 41 17 17 -32 12 29 2 30 11 35 -42 -19 28 -39 -8 -2 38 -26 15 4 45 27 5 0 -33 -29 -4 -24 -41 25 -20 30 -13 5 -34 21 28 6 35 48 -16 -10 31 45 10 31 18 7 30 15 37 -24 0 -19 45 -24 26 25 19 29 -30 18 -3 17 -44 0 -35 10 -28 -11 -41 49 16 -1 42 -18 3 37 -28 -23 -10 7 -26 34 -30 -22 16 3 -33 -32 26 11 18 -21 -49 -40 -20 -1 -15 -31 -36 -35 49 -31 -50 3 -15 -10 -16 43 6 3 45 -19 5 -26 37 -12 45 37 -25 -48 9 -26 50 9 23 -24 32 44 -21 -17 -39 -29 41 -1 35 47 37 10 -33 -50 -18 -15 2 -22 -27 33 4 39 -20 40 -30 -41 31 -35 10 -36 -30 -15 38 49 -30 43 -27 50 -43 38 -26 35 -32 -33 7 40 27 1 11 44 -41 47 -7 19 -33 9 50 8 37 -19 -33 41 -49 -17 24 -15 21 -31 11 -25 -42 -39 47 21 46 -25 6 -47 -18 14 11 21 24 26 -30 10 -18 -16 -38 38 46 39 -27 -17 20 -40 38 39 -37 -35 46 33 34 -24 -31 49 -42 39 -28 0 -21 31 3 -33 -7 46 10 -15 -5 -17 7 -20 -24 11 35 -24 0 -37 -45 38 34 -7 -6 12 18 38 42 -39 26 -44 48 38 8 -23 -48 7 -47 -36 -12 17 43 -48 -43 10 40 0 -43 6 -25 7 43 -2 31 -21 -18 -9 -27 -15 45 38 37 -25 -36 31 -25 -14 32 -40 -36 20 -17 -13 44 15 -26 -24 -40 -47 43 -28 19 -22 -20 37 26 -16 38 -50 -24 6 26 1 42 28 -19 26 24 39 -29 43 1 12 15 -49 18 -48 5 -14 14 -42 16 -20 -8 3 -38 50 1 36 -40 4 50 44 -40 13 10 -21 -4 -49 38 44 -38 -13 -49 -9 13 15 30 31 -45 42 -27 -26 -24 -1 -20 -1 -8 18 -31 14 -49 -40 14 17 -14 26 40 48 -46 13 -2 -3 4 -46 -47 44 11 -6 47 29 19 -3 -16 -13 34 33 -38 -20 -16 -5 -26 -30 49 -4 -32 -1 -39 -2 32 32 -6 -27 -19 3 43 -4 -29 -14 -3 18 1 9 -8 -31 15 -49 -9 50 21 -3 -27 -46 -35 45 26 46 50 -25 -20 47 -50 3 45 8\n",
              output: "63996\n",
            },
            {
              input:
                "500\n500 499 498 497 496 495 494 493 492 491 490 489 488 487 486 485 484 483 482 481 480 479 478 477 476 475 474 473 472 471 470 469 468 467 466 465 464 463 462 461 460 459 458 457 456 455 454 453 452 451 450 449 448 447 446 445 444 443 442 441 440 439 438 437 436 435 434 433 432 431 430 429 428 427 426 425 424 423 422 421 420 419 418 417 416 415 414 413 412 411 410 409 408 407 406 405 404 403 402 401 400 399 398 397 396 395 394 393 392 391 390 389 388 387 386 385 384 383 382 381 380 379 378 377 376 375 374 373 372 371 370 369 368 367 366 365 364 363 362 361 360 359 358 357 356 355 354 353 352 351 350 349 348 347 346 345 344 343 342 341 340 339 338 337 336 335 334 333 332 331 330 329 328 327 326 325 324 323 322 321 320 319 318 317 316 315 314 313 312 311 310 309 308 307 306 305 304 303 302 301 300 299 298 297 296 295 294 293 292 291 290 289 288 287 286 285 284 283 282 281 280 279 278 277 276 275 274 273 272 271 270 269 268 267 266 265 264 263 262 261 260 259 258 257 256 255 254 253 252 251 250 249 248 247 246 245 244 243 242 241 240 239 238 237 236 235 234 233 232 231 230 229 228 227 226 225 224 223 222 221 220 219 218 217 216 215 214 213 212 211 210 209 208 207 206 205 204 203 202 201 200 199 198 197 196 195 194 193 192 191 190 189 188 187 186 185 184 183 182 181 180 179 178 177 176 175 174 173 172 171 170 169 168 167 166 165 164 163 162 161 160 159 158 157 156 155 154 153 152 151 150 149 148 147 146 145 144 143 142 141 140 139 138 137 136 135 134 133 132 131 130 129 128 127 126 125 124 123 122 121 120 119 118 117 116 115 114 113 112 111 110 109 108 107 106 105 104 103 102 101 100 99 98 97 96 95 94 93 92 91 90 89 88 87 86 85 84 83 82 81 80 79 78 77 76 75 74 73 72 71 70 69 68 67 66 65 64 63 62 61 60 59 58 57 56 55 54 53 52 51 50 49 48 47 46 45 44 43 42 41 40 39 38 37 36 35 34 33 32 31 30 29 28 27 26 25 24 23 22 21 20 19 18 17 16 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1\n",
              output: "124750\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_pattern-occurrences",
      title: "Pattern Occurrences",
      type: "full_source" as const,
      tags: ["medium", "String"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "給定一個文字串 $t$ 與一個樣式串 $p$，兩者皆由小寫英文字母組成。請計算 $p$ 在 $t$ 中出現的次數。\n\n出現的位置**可以重疊**：只要存在起始位置 $i$（$0 \\le i \\le |t| - |p|$），使得 $t$ 從位置 $i$ 開始、長度為 $|p|$ 的子字串恰等於 $p$，就算一次出現。例如 `aa` 在 `aaaa` 中出現 $3$ 次。",
        inputFormat:
          "第一行包含文字串 $t$。\n\n第二行包含樣式串 $p$。\n\n兩字串皆僅由小寫英文字母 `a`–`z` 組成，且 $1 \\le |p| \\le |t| \\le 10^5$。",
        outputFormat: "輸出一行，包含一個整數：$p$ 在 $t$ 中出現的次數（重疊的出現分開計算）。",
      },
      samples: [
        { input: "abcabcab\nabc\n", output: "2\n" },
        { input: "aaaa\naa\n", output: "3\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "abcabcab\nabc\n", output: "2\n" },
            { input: "aaaa\naa\n", output: "3\n" },
            { input: "abababab\naba\n", output: "3\n" },
          ],
        },
        hidden: {
          description: "小型與邊界測資：最小長度、無出現、整串相等、重疊、週期性字串",
          weight: 40,
          cases: [
            { input: "a\na\n", output: "1\n" },
            { input: "abcdef\nxyz\n", output: "0\n" },
            { input: "banana\nbanana\n", output: "1\n" },
            { input: "banana\nana\n", output: "2\n" },
            {
              input:
                "abababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababab\nabab\n",
              output: "99\n",
            },
          ],
        },
        hidden2: {
          description: "大型重疊與週期性測資、隨機測資",
          weight: 60,
          cases: [
            {
              input:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
              output: "2501\n",
            },
            {
              input:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
              output: "59\n",
            },
            {
              input:
                "abcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcababcab\nababcab\n",
              output: "699\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_longest-unique-substring",
      title: "Longest Substring Without Repeats",
      type: "full_source" as const,
      tags: ["medium", "String", "Sliding Window", "Hash Table"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "給定一個由小寫英文字母組成的字串 $s$。子字串指的是 $s$ 中連續的一段字元。\n\n請找出 $s$ 中最長的「所有字元互不相同」的子字串，並輸出它的長度。例如 `dvdf` 的答案是 $3$，對應子字串 `vdf`。",
        inputFormat:
          "輸入只有一行，包含字串 $s$（$1 \\le |s| \\le 10^5$），僅由小寫英文字母 `a`–`z` 組成。",
        outputFormat: "輸出一行，包含一個整數：最長無重複字元連續子字串的長度。",
      },
      samples: [
        { input: "abcabcbb\n", output: "3\n" },
        { input: "dvdf\n", output: "3\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            { input: "abcabcbb\n", output: "3\n" },
            { input: "dvdf\n", output: "3\n" },
            { input: "bbbbb\n", output: "1\n" },
          ],
        },
        hidden: {
          description: "小型與邊界測資：單一字元、全相同、全相異、視窗回退陷阱、26 字母循環",
          weight: 40,
          cases: [
            { input: "a\n", output: "1\n" },
            { input: "zzzzzzzzzz\n", output: "1\n" },
            { input: "abcdefghijklmnopqrstuvwxyz\n", output: "26\n" },
            { input: "abadc\n", output: "4\n" },
            {
              input:
                "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz\n",
              output: "26\n",
            },
          ],
        },
        hidden2: {
          description: "中大型隨機測資與大型全相同測資",
          weight: 60,
          cases: [
            {
              input:
                "dbcabbadcabccdbdaaadcbcbacaacbdaadcdaaacdacbcdcbbddbadaabaccccadcdbccbccbcdbdbbdaabadbcdcdbcbdcdaddaadcaabcbdddcacabbcbcbacacbccbabdadadbcdbbabcbdacbaadcacdcccabbccdcdadaabddbbbcbaaddcbcacccbccacbadccbddabadcdcbaabacbbbddbbdbdccdabccacadbbdcabcaccaaabcacbbadbdcbadbbbadaadbabdbaabdbccabbbdcdcbbbaabdbcacabcaadcbcccdcaddddbdbddccacdbbddcdbbaacaacbcabcaaddbdcbcccdabbdcccbbabddddbdbbcdbabcadaabbdbadacbdcbbdaadbbccdadaadabbdbbabbdcdabcaadbabbaccdbbaccbbdbbbabaabdcdbdacabddadcacacdccddbccdabddadacbdcccbccdaaaacbdcaccbdadbabaabddabaaaaacabbbdacbcaccbbbdacdccabdccbabbadddcbcdaabcacabbaacaabacbaccbbbbdabddddcaabccbaaddbbabcabdddadbbdcbddcbbcaacacadaabacdddcdbbddadaaccbdbbdddcbacdabcdddbbbcbacdadbbcdcadbadadbacdcbccdbadbababdabccdaacaaacbdaaaaaddbbdbdadbcbbcadaacccdbbbdcbdadcccaacbcccdddacdabddbacbccdcdadaabdccdbdacdccacacabadaccdaabdddcddbccbbbdbdaadcdbabaabaabdbadabcbadcaaadbdbbcaabcadbcadbdcadbccbabbbdddbadaabbacacadacacaababbacadccddcbbddcccbacbcabdabdbacccddbcdadabdddcbcbbccacdabbbdbbbcccaab\n",
              output: "4\n",
            },
            {
              input:
                "pgbmmgqmkdraheqbrclmpjromjecbjgnjhjrnheahaapmcqpfjbphegidgreprfibbpblnjekimpceimjoeogolrhlrepbmhrlphimbodnddabnrjrdahnqorglqekopdfjpjkblcamajloafjmfncfrplmfmpqighrnlejldkmmiocjkrhdhiicblddngnhnfblecqdqjcjfkiarpjkepejccngkjolorjbjhghfokifeqcicliogmkfqmbjoknqrojrfdllofnpehoprhdraqlehpkhmidboklkkmojagmigrpoingekrhdjojjqcjikpogbehlmolrlfkmrecdirqnagimakqpncbphkoqlerbhbdjniqcocmnbnjojiogpbcraonmdmblnlbkqcdqabbdpclhrcrqmopqdkrlfrnerkekanekdlradeaqoeghajqdqqmdaeopebigeikpgifkeabpkafgoranjiinqkbojkroboabcfkarofpffbrjcqpkblparrhcmloppjciibalegjbbmqlgodbjdekmdhnccghbcbopgfpilmrndcldrcgrhlcirghcbcaqbpndfmqoqbmpgaahfgoqflfgqjekmlibrgqplbcpfqrmqniqobgmpcabqlccjprooccehqanpddeooijnrckjcfpeidfjppambfrqndoqpjiokichlnlcnajrnannerqdoleocikmmalfojrdreongbjpqfgloppbopfaageeeimakmbeqcmrdblhfcicfnkagpkkqkrpcfaepcfoaqinogbiojgchcqampokgonrfrmcbfihbhqampqkcolgnedoqpcdbnanmddnhpljrfljlonjdkrjmjkkhfpjopqgjhcfgkmohllfpqppnarimokebraraphmafndbkmbbgimplibnjghagochficqhecdpkabmdrkoanldociqfqbdmhlqfjdcbkkidbfoalhjjlairganoorblljponohfjbknarfanmlkidoiibldejmdljlapimljrellohllmhholiqcrgqokekqhplbjqnfbpfdoimmioodpefccaonenhcbckilinjfigajrqbhcdpnrnqnfpdfgmrirhnbneqqmffpldhbimrqribahchpnokeapjplbapbmmkncnnkgdlpamblqenmrrlrhogphbbloqhmgijbpqnrnopabgjlgfqhripmkehodeqpfcoofhpiqndikdogfimbllpfkiibrjdqchqlciejgalgocjfobnleolaelaekdkeldfafprmjadghehecgplabheqfplgekjhemgapmhrkhojpfnpjbrbibkneqfdrphioemklpfbaadflppibakdpibqdmfdcbcnolgdbpnancadmcarlpoeinlrkrkngkjgeidodcoehfiblbnjedgrdipqbbamhdfmjkcdhpemfqdfberdjebqhdnjajmqbpeqmnfbpqckihmcralndcpoiafraqirhejbogbgmqjdbggakamhpndggnodaeieqjqfpqpjarlhqfeplqccrgmjihrfehegncibjoppembogkdkelqerajkaehnngeobpjbmrnoocfdrfgfkplmjkjorpgndjfbipqifbnbkjroqgnadjmkhaaaafcrkbeahqdhnfokcgnfiomnlerhondjnborpcpkqbcbjporrnnmlelpfbbgblojkhrhkffffiijeemcfihaggeqlmgmkclbcbhjhiaeddprenaraeaaiojknbbekojeidgodjjarhlmgfqbhirmikhrogqdeedqkabiiialkahpcmhpgodqrfgpkbgikehqpigqblkbppdcohibjdbgrhfkfdfgelcfhomqldieiccecjakdpriokjkjdficeaphmpdnbdrffjnaqccorimgfeidqpjacfralknqlrorieenflkikcmojhma\n",
              output: "13\n",
            },
            {
              input:
                "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq\n",
              output: "1\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_prefix-count-trie",
      title: "Prefix Count",
      type: "full_source" as const,
      tags: ["medium", "Trie", "String"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "你手上有一本字典，內含 $N$ 個由小寫英文字母組成的單字（同一個單字可能出現多次）。接著有 $Q$ 筆詢問，每筆詢問給定一個字串 $p$。\n\n對每筆詢問，請回答字典中有多少個單字以 $p$ 為**前綴**。重複出現的單字要分開計算；若一個單字恰好等於 $p$，也算是以 $p$ 為前綴。",
        inputFormat:
          "第一行包含兩個整數 $N$ 與 $Q$（$1 \\le N, Q \\le 10^5$）。\n\n接下來 $N$ 行，每行一個字典單字。\n\n再接下來 $Q$ 行，每行一個詢問字串 $p$。\n\n所有單字與詢問字串皆僅由小寫英文字母 `a`–`z` 組成、長度至少為 $1$，且所有字串的長度總和不超過 $10^6$。",
        outputFormat:
          "輸出 $Q$ 行，第 $i$ 行包含一個整數：字典中以第 $i$ 筆詢問字串 $p$ 為前綴的單字數量。",
      },
      samples: [
        {
          input: "5 4\napple\napp\napplication\nbanana\napp\napp\nappl\nbanana\norange\n",
          output: "4\n2\n1\n0\n",
        },
        { input: "2 2\nab\nab\na\nabc\n", output: "2\n0\n" },
      ],
      testcases: {
        sample: {
          description: "題目敘述中的範例測資",
          cases: [
            {
              input: "5 4\napple\napp\napplication\nbanana\napp\napp\nappl\nbanana\norange\n",
              output: "4\n2\n1\n0\n",
            },
            { input: "2 2\nab\nab\na\nabc\n", output: "2\n0\n" },
            { input: "3 3\nxy\nx\nxyz\nx\nxy\nxyzz\n", output: "3\n2\n0\n" },
          ],
        },
        hidden: {
          description:
            "小型與邊界測資：最小輸入、詢問比所有單字長、恰好相等、重複單字、共享長前綴",
          weight: 40,
          cases: [
            { input: "1 1\na\na\n", output: "1\n" },
            { input: "2 2\nab\nabc\nabcd\nabcdefgh\n", output: "0\n0\n" },
            { input: "3 3\nx\nxy\nxyz\nxyz\nxy\nx\n", output: "1\n2\n3\n" },
            {
              input: "9 5\naa\naa\naa\naa\naab\naab\naab\nab\nab\naa\naab\na\naaba\nab\n",
              output: "7\n3\n9\n0\n2\n",
            },
            {
              input:
                "4 4\naaaaaaaaaa\naaaaaaaaaab\naaaaaaaaaac\naaaaaaaaab\naaaaaaaaaa\naaaaaaaaa\naaaaaaaaaab\nb\n",
              output: "3\n4\n1\n0\n",
            },
          ],
        },
        hidden2: {
          description: "中大型隨機測資",
          weight: 60,
          cases: [
            {
              input:
                "500 300\nbbbab\naaabaaba\naaaba\nabbbbab\nbaa\nabbbbbbb\nb\nab\nbba\nb\naabaaaa\nbbbaaaaa\nabbab\nabb\nab\naaaa\nabaaabb\nab\nbaaaa\nbbabbbb\nbaab\nbabaaaab\nabab\nbbbba\naaaa\naabaa\nba\nbbbbabb\nbabab\nbab\nabaaabbb\nbabbbb\nab\naaba\naaa\nbaa\nbbabbaa\na\naba\nabbbaa\naaaabbb\nbab\nabbbaaa\nbab\nb\nbbbaa\nabba\nbbababab\nbbabbaba\nbab\na\nbbab\nbbbbaba\nbba\naaaa\nbaab\nbbabb\nab\nababb\na\nbbbba\nbbaabaa\nb\nb\nba\naabab\nbabbaa\nbbaaa\nbabbaaab\nbb\nabaaabbb\nbaabbb\nabbbbbbb\nbaab\nab\na\nbbbbb\nbbaababa\nb\nb\nabbbaabb\nbbaabbab\nbbbaa\na\nbab\naa\nbabbabba\naaab\nabb\nabbb\nbbbabaa\nab\nbaaa\nbbaa\nba\naaaaaaba\naa\nba\naba\naa\nbaaabba\nb\nbbabba\nbbbbb\nab\naaaabaab\nbaaaa\nabb\naabbabab\nb\nbabbaab\nbbabbbba\nabababb\nbaababa\naaaababa\nbbbaaa\naaa\naba\naaababaa\nbbaaabaa\nbb\nbaa\nbaaaaaaa\nbabba\nbaabaaa\nbba\nabb\nbba\naabbba\nbaabbb\nbbbbbb\nbbbbba\nbba\nbaba\nba\nab\nbaab\naa\naab\nabbbabb\nbbbbaaaa\na\na\nbbaabb\nbbabbab\nbbbaaba\nbb\nbbaaab\nb\naabababb\nbbba\naabbab\na\nb\naaaaba\nabaabbaa\nab\na\na\nabbbb\nabbbb\nbaaaaaaa\nbbbabbab\nabbbbbab\na\naabb\nba\nbabbba\nabaaaa\nabbaba\nababbb\nbbbaabba\nb\nbbaaabab\nabaababa\nababbbab\nabaa\nb\na\nba\nbaab\nbb\nbbabbab\nbabababb\nbbbbabab\naaaab\nb\nbbabaab\nbba\naa\nabab\nab\naabbb\nbbbbabb\nabb\nabbbabab\nbbbbaab\nbaabaa\nbab\naa\nabbba\nababb\nbbabb\nbaaabb\nbabbbbb\nbbbba\nb\naaabb\nbabba\nba\nababbaa\nab\nbaabbbbb\nbba\nb\na\nbabbbaba\na\nb\naaa\nbaaaabab\naabb\nb\nbbaa\naabb\nab\nbaab\nabab\nbbabaa\na\naaaaab\nbbaa\nababa\na\nba\nbb\nba\naabbbaab\nbbbbb\naba\naabba\naab\na\nbaaaaaaa\nabb\naaa\nabb\nbbaabbab\nb\nbbababa\nba\naba\nbbba\naaabbbab\naba\nbababa\nbbbabb\nbaaabba\nbbb\na\nbaabbabb\nb\nbabba\nbbbba\nabaab\nab\na\nababaaba\nbabbaaa\nab\naaaaaaa\nab\nbabb\naa\naabab\nba\nabab\nabbbaaaa\nbaabaaa\nbbbb\nbb\nbbab\nabab\nbbbaa\nbab\nabaabab\naab\nababbb\naabbb\nba\nbbbabb\nbbaaaa\naabb\nbbbabab\na\naabbabb\nbabbab\na\nbabaab\nabbaa\nbbb\nb\nbbaa\nbb\na\nbab\nbbb\nb\naabb\naabbaaa\nbbababba\na\naabbbbbb\nbaaab\nbbbaaaa\nbbbaaaa\nababbb\nababb\nbaaabbb\nabb\nbbbbbb\nab\nbab\na\nbba\naaabaabb\nbbaaaa\nbbbbbba\nb\naab\nbb\nbaa\nbaaba\nbbabab\nbbabaa\nbb\nbb\nbbaabaaa\nbba\nbbaaa\naabbabab\na\nbabaab\nbaabaa\nba\naabbabb\naaaaaa\naabb\nb\naa\nabab\nbbaaba\naa\nabbba\nb\nabaa\nabbb\nba\nbbbb\nbb\naaababb\nbbabab\nabbbbbb\nbbbbb\naaaabb\nbbbabbb\nabaab\nb\nababa\na\nb\na\naa\nbaabaab\nba\na\nbbaabaaa\naabbb\nb\nabbba\nba\nbabaa\na\naa\nbaaab\nbb\naaaaa\naababba\naba\nbbaabba\nbb\nababb\nabaaa\nb\nb\nabababba\nbaabbaa\naaababb\nba\nabaaaaa\nbbaa\naab\nbbaaaa\nabbbbaba\nbbbba\nbbaaa\nababaabb\na\naa\nbaab\nbabbab\na\nbaaaa\na\nabbaab\nabbbb\naba\nbbaaa\naaaaaba\nababa\nbabaaabb\nbab\nbbb\nababb\nbbba\nbbbbbbba\naaaab\nb\nababab\nbaab\naaabb\naaabbaba\na\naa\nab\na\naa\nbaabbbab\nabaaaa\nabaab\nbbbb\nbbbbaa\nbabab\nab\nabbbbbbb\naabababa\naaaa\nbbaba\nbaa\nabbb\nb\nbaabbabb\nb\nbbaaabb\naa\nab\na\naabbbba\nba\nbaa\nbaaaa\naaaab\nbaaaa\nb\nbbbaa\nbabbaa\nabaaa\nbbbabba\naaab\naab\nbaabbaab\nbbaba\nbbaabba\nabbbabba\nbabbbb\naaaaabba\na\naabbabbb\nbb\nabbaa\nabbaa\nbb\naaaa\nbb\na\nbbabaaa\naaaaaba\nbbb\naa\nbb\naaabbba\naabbbbab\nbbbaba\naabb\nbba\na\naaaba\naa\naa\nb\nbaaaa\na\nbbaba\nbaa\na\nbbaaaab\nbabbab\nb\nab\nabbbaba\nbabab\nbbaabaa\nba\nbb\naba\naaabbbb\nba\nbbbabb\nba\nbba\nb\nbbbabaaa\nba\nabbaba\nbbab\nbbaaaaa\naaabbab\na\nbaaab\naaaaaab\naba\na\na\naa\nba\naa\nbbba\naaabbb\na\nbbb\na\naaaba\nbb\nba\nbba\nb\na\nabb\naaab\naaaaabbb\naabaabab\nbab\naabbbab\nbbba\nabaabb\nbbbabab\nba\nbbabbaa\nabaa\nbbaba\nab\nabb\nbbabba\nababaaaa\nbbbb\naaabb\nbaaabb\naabbab\naabb\nbaaaa\nb\nbaaa\nbbaa\nbaaaabab\nbbbb\nbaaa\nbaab\naaba\nbaa\nbabaaa\nb\naaabbba\nbaaa\naabbbaa\naab\nbbbaaba\nabb\naab\nbbb\nabb\nbb\nabb\nbbb\nbababaaa\nbbabba\nb\nb\naaa\naaab\nbbaaba\nbaaab\nbbbb\nababbbbb\nabaaaab\nbbab\nbab\nabaabab\nabaaabaa\naaaaa\na\nbab\nbaabab\nbabb\na\naaabbabb\naabbbba\nbabb\nab\nb\na\nab\nbb\nabababba\naba\nbbb\nba\nb\naaabbba\nb\nb\nabb\nbbaa\nababba\nb\nabb\nbbbb\naba\nab\nb\nbaabab\naa\nbaabab\naabbbb\nb\nbaabaabb\na\nab\nabaaba\nbbbbbab\naa\nbababba\nbbababa\nbbb\naa\na\nababa\nba\naabaaaa\nba\nbabaa\nbbb\nbb\nb\nabb\naa\nbabbaa\naab\nababab\nab\nb\naaabbaa\nbbbbbbb\nabba\nbbb\nbaaaabaa\nba\nb\nbbabababb\nabbb\nbb\nb\nbbb\naaa\nbbb\na\nbbbb\nb\nbabbabb\nbababa\nb\nabaaa\nbbaaab\nababbaa\nbab\nbbaaabb\nbaba\nbaa\na\nabbb\nbbabb\nba\naabbabb\nbbaabaaa\nabb\nbb\nbaab\nabb\na\naa\nb\nabb\naabba\naa\nb\nba\nbabaab\nbb\nababaab\nbabaa\nababbbb\nb\nbbaabbba\nab\naaa\naa\nab\nba\nbbb\nbbbaa\nabbbaab\nbbbbaba\nbbaab\na\nbbaa\na\na\nababa\nbabbbaaa\nab\nab\nabb\nb\na\naa\nbbbab\nba\naaabb\nbaaabaa\nbaabab\nbabbab\nabaa\nab\nababbabb\naa\na\nbabaabb\na\nbbaaaab\nab\nb\nbab\nbabbaaa\nabbbbaba\nbbbbbbaa\nbbaab\naaaba\naabbabaa\nbbb\naa\naa\nbbabaaab\naaaa\nb\nbbabbbaa\nbbab\naabaabab\nb\nb\nbb\na\nbab\nbbababa\nbbabbba\nbaabaab\nab\nababbab\nbbaaaab\naa\naabb\nab\naa\naaaab\nbb\nbb\nbaaaaaa\nbabbaaa\nbbbbaba\nbab\nabab\nab\n",
              output:
                "9\n238\n11\n45\n238\n0\n3\n262\n106\n1\n4\n3\n101\n126\n48\n0\n101\n5\n101\n58\n262\n0\n101\n1\n22\n0\n1\n238\n6\n1\n48\n238\n238\n94\n101\n94\n22\n2\n238\n51\n238\n7\n126\n101\n58\n262\n238\n38\n14\n0\n0\n37\n0\n22\n1\n1\n101\n1\n16\n11\n106\n38\n5\n0\n24\n5\n4\n6\n23\n9\n262\n16\n26\n1\n24\n16\n23\n8\n45\n2\n262\n2\n16\n1\n37\n1\n38\n37\n51\n38\n126\n38\n51\n0\n5\n262\n262\n39\n14\n5\n6\n24\n0\n0\n22\n37\n2\n0\n8\n238\n37\n1\n17\n238\n0\n2\n17\n106\n262\n238\n106\n126\n1\n48\n51\n101\n262\n2\n262\n262\n38\n26\n1\n262\n38\n24\n48\n106\n262\n1\n94\n1\n3\n262\n0\n238\n106\n2\n0\n94\n0\n2\n51\n94\n238\n8\n101\n1\n101\n5\n51\n126\n262\n38\n94\n5\n37\n3\n106\n262\n0\n1\n7\n51\n0\n101\n262\n0\n23\n126\n262\n51\n39\n51\n238\n24\n262\n1\n2\n262\n8\n4\n1\n37\n1\n10\n45\n238\n23\n9\n101\n3\n2\n38\n126\n23\n38\n238\n94\n262\n38\n8\n94\n262\n101\n2\n126\n2\n5\n0\n262\n0\n106\n39\n94\n106\n101\n51\n10\n1\n2\n10\n238\n26\n238\n238\n8\n0\n106\n106\n38\n262\n238\n94\n9\n101\n5\n0\n1\n3\n16\n106\n0\n94\n238\n0\n238\n0\n106\n262\n37\n2\n1\n0\n10\n7\n0\n51\n94\n94\n0\n21\n262\n0\n22\n0\n262\n262\n126\n238\n37\n2\n0\n1\n106\n0\n0\n94\n23\n106\n94\n8\n126\n126\n3\n2\n2\n37\n24\n106\n",
            },
            {
              input:
                "300 200\nbbbbaab\nbaabbaabaa\nbbbaa\nbbbabaabab\nabaa\naaabba\naaaaabbb\naaa\nabababa\nbba\naaabaa\nbbbbbab\naaaaaaaba\nbaaba\nbbaaababb\nbba\nabab\nabababa\nbbbbaaaba\nbbbbaa\nab\nbb\nababbababb\nbbbabbbb\nbbabbabb\nababbb\nbaaaabb\nabbab\nbbbabbabb\nbaaab\nbaa\nabab\nbbaab\nabb\nbbbbabbaa\nabababa\na\nbba\nbbbabba\na\nbaaaaaabba\nbabba\nba\naaaab\naabbbaaaa\nab\nbbbb\nbbaabaaa\na\nbbbaaaaaa\naaaa\nbba\nabbbab\nabaabaa\nab\nbb\nabaabbba\nbbbb\nbababba\nbaabbb\naabbb\nbbaabbbaba\nb\nbaaabba\nbbbbaba\nabababb\nbbaa\naabbaa\naabbabaaab\nb\nb\nabbaababba\nab\nabbab\nabbbabba\nbabaaab\nbaab\nbbabbaaaa\naabbabba\nbb\naaaaba\naabaa\naaaab\nabbabb\nbba\nbababbbb\nbbabaabb\nababbabaab\nbba\nbbabbba\naababbaabb\naaab\nab\nbb\nbb\nbaaba\nab\nbaaabbbabb\nbaaaaba\nbaaab\nbaa\naaab\naaaababbab\nabbaba\na\nbaaabaa\nbbbaa\naa\nabbbaa\nbabaababb\nbbaa\nbabbbaaa\naa\naaabbaab\nb\nbbaabaabbb\nb\naabba\nba\naaaaaabba\nbbabb\nababaa\naabaaaa\na\nbbabba\nbbbbabaaa\naabba\naaaaaa\nababbaaa\nabaabaabb\nb\nbabab\nbbabbbaabb\naa\nababbbbbb\nabbaaa\nbbbbbaabb\nbbaa\nb\nbabbaab\nb\nbbbbabbbaa\nbabbaa\nbba\na\nabaabaab\nbaaaababba\nbbbaabab\nababaa\naaaabab\nabba\naaaaaa\naaba\nb\nbb\nbab\naabbaaaba\nb\nbbbbbbaba\naabbaa\nbbbbaaa\nbbabbabaab\nb\nbbabbba\nbbbbabaaba\nbaaabbaba\nb\nbbab\naaababab\naaabbbb\nabbbabab\nbbbabba\nbb\naabab\nbbaab\nbabbbbab\nb\nbbaababba\nabaa\nababbb\nabbbbbabba\naabbabbbb\nbabaaab\nbabbab\nbb\na\nbbababbba\nb\nbaabbbba\nbba\nababbbbab\nbabaaa\nbba\nbbaabbbab\nbaabb\nbbabbaa\nbaaaaaa\nabaaaaba\nbaaabaa\nbaabaaabab\naaab\nbbabba\nabb\naaa\naab\nbbba\nbbbabbaaab\naaba\naaabbbba\nabbaa\nabbbabba\nba\nbabbaabbaa\nababb\nbbbaa\nbbaaaabbaa\nababab\nab\na\nb\nbbba\nb\naaaaabb\nab\nbbab\naaabbb\naaabaabb\naaaababba\naaababbaba\naaba\nabaaa\nabaaaab\nbbbabb\nbaabaab\nbbabbbbaa\nabaa\nbbaabba\naaa\nbaa\nbbbbbbbb\nbbab\nabbbbbba\naab\naabaaba\naa\naaaaaaa\nbb\nbaabb\nabababaaaa\na\naabaa\nbbaabbabb\nbaa\nbbbbabbbbb\nbababa\naaaaabaaab\nabbbabaaa\nbbabab\nbbaabaaab\nbba\nababb\nabbbbabb\nbaaaa\nbbbbbbab\nbbaabb\nbb\nbbbbaa\naaaabaa\nbabbbaa\nababbbbb\nbabababba\nb\nabbaaaaaaa\nb\na\nabbbaba\nbbaaaa\nb\nbabbaa\nbaababbaba\naa\nabbbbaaab\na\nbbabaaaabb\nbbbabb\naab\nbaababa\nbb\naa\nabbabaab\nbab\naabb\nbaaabbabb\nbbbbaabba\naabbabaaba\naabaaaa\naabaabbb\nb\nabbabaabab\nabb\naab\na\na\na\na\nbaaabaa\nb\nabbbaaa\nbbbbb\nab\nbba\nabba\nbaabab\nbbab\naaaba\naabbbba\nb\naababbbab\nab\nbaabbbb\nbabaabbba\naababbaa\nabbaabbb\nbaabb\nbbba\nbbaababb\naaabbaa\nabbaababb\nbbbaa\nbb\nbbabbbba\nab\naa\nbaaab\nbbbbb\naaababbab\nba\nab\na\naaaaaaa\nbaba\nabbb\nbba\na\nab\nbb\naba\naa\naaababa\naabaab\nbaabbb\nbbaaaab\nababaaaa\na\na\naa\nbabb\nabbbbbab\naaaaabbb\nbba\nba\naaabab\naabba\nbbabaaa\naaaaa\nbb\nabbbb\nbaa\nbbbab\naab\naba\nb\nabbabaaaba\nbbbbababab\nb\nabb\nab\na\nbbab\nbaaaaabb\naabbb\naababbba\nba\nabbbbbba\nbbbaabbb\nbbbabbba\na\nbb\nbbaa\nbbabaabbb\nbb\nba\nbbab\nb\nbaaaaaba\nbabaaa\nbababbbb\naaaaab\nab\nbb\nbabbabba\nbaabb\nb\nabaaaab\nbaba\naaabab\nbaaaa\na\nba\nbab\nbbaabaaabb\nbabbbaaaa\nbbbb\nb\nab\naababaaaaa\nb\nabab\nbb\naabbabaab\nba\nbaba\naabbabbba\nbabb\nbbb\nb\na\nbab\nbaabaabbba\nbbbaa\nbbaabab\nbbabaaba\nab\nb\nbb\na\nbaaaaa\nbbbb\nbbbb\nbbaa\nbaabab\nbbb\na\nabbbbaaab\nbaba\naabbbbbbaa\nbabbbbab\nb\naabba\nb\nbb\na\nbbbbbbaa\naabaabb\naaa\na\nb\nababbbbb\naa\naaab\naba\nbababb\nabbba\naaaaab\nababb\nab\naaab\nabbbb\na\naa\naabbaba\na\naabaaaab\nbbabaa\naab\nbbabbab\nababbbbabb\na\nababaaa\nb\naba\nba\nabaab\nbabb\naaaaa\naaa\nbbabaaa\nb\nbbab\na\nbbbb\nbaaba\nababba\nbbbbabbbbb\naaaaba\naababb\nbabaabbab\nababbb\nbbbb\nbb\n",
              output:
                "26\n137\n137\n137\n137\n2\n163\n0\n5\n63\n45\n11\n2\n18\n4\n0\n163\n0\n63\n1\n0\n1\n0\n5\n15\n1\n1\n1\n5\n90\n1\n63\n63\n8\n5\n1\n53\n63\n137\n2\n9\n11\n45\n137\n63\n90\n30\n63\n1\n2\n2\n1\n0\n137\n137\n63\n9\n1\n1\n45\n53\n2\n9\n1\n8\n90\n4\n30\n8\n26\n30\n163\n0\n0\n163\n25\n63\n137\n18\n0\n2\n0\n53\n1\n0\n0\n137\n90\n17\n0\n90\n53\n18\n163\n0\n3\n1\n3\n63\n90\n0\n5\n163\n2\n9\n2\n6\n137\n53\n20\n0\n0\n19\n163\n63\n0\n163\n20\n90\n1\n53\n9\n0\n9\n34\n163\n137\n20\n0\n5\n1\n0\n63\n163\n90\n137\n2\n19\n19\n17\n2\n34\n137\n1\n9\n0\n1\n163\n9\n163\n90\n137\n0\n1\n31\n137\n163\n2\n63\n12\n30\n2\n7\n3\n10\n63\n12\n4\n137\n63\n2\n137\n0\n2\n26\n2\n0\n137\n0\n163\n30\n53\n4\n9\n8\n31\n1\n163\n18\n137\n19\n6\n3\n1\n5\n1\n0\n5\n19\n90\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_count-primes-sieve",
      title: "Prime Census",
      type: "full_source" as const,
      tags: ["easy", "Math", "Number Theory"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "質數是恰好有兩個相異正因數（$1$ 與自身）的正整數；特別地，$1$ 不是質數。\n\n人口普查要數人，質數普查要數質數。給定一個正整數 $N$，請計算不大於 $N$ 的質數共有多少個。",
        inputFormat: "輸入僅一行，包含一個整數 $N$（$1 \\le N \\le 10^6$）。",
        outputFormat: "輸出一行一個整數，代表不大於 $N$ 的質數個數。",
      },
      samples: [
        { input: "10\n", output: "4\n" },
        { input: "1\n", output: "0\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "10\n", output: "4\n" },
            { input: "1\n", output: "0\n" },
          ],
        },
        hidden: {
          description: "邊界與小型測資",
          weight: 40,
          cases: [
            { input: "2\n", output: "1\n" },
            { input: "3\n", output: "2\n" },
            { input: "4\n", output: "2\n" },
            { input: "49\n", output: "15\n" },
            { input: "50\n", output: "15\n" },
            { input: "100\n", output: "25\n" },
            { input: "7919\n", output: "1000\n" },
            { input: "999983\n", output: "78498\n" },
          ],
        },
        hidden2: {
          description: "大型測資",
          weight: 60,
          cases: [
            { input: "1000000\n", output: "78498\n" },
            { input: "524287\n", output: "43390\n" },
            { input: "123456\n", output: "11601\n" },
            { input: "999999\n", output: "78498\n" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_modular-exponentiation",
      title: "Power Mod",
      type: "full_source" as const,
      tags: ["easy", "Math"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "給定 $Q$ 筆詢問，每筆包含三個整數 $a$、$b$、$m$，請計算 $a^b \\bmod m$。\n\n注意 $b$ 可能大到 $10^{18}$，逐次連乘無法在時限內完成，你需要更快的演算法（例如快速冪）。\n\n本題定義 $0^0 = 1$；因此當 $a = 0$ 且 $b = 0$ 時，答案為 $1 \\bmod m$。",
        inputFormat:
          "第一行包含一個整數 $Q$（$1 \\le Q \\le 1000$）。\n\n接下來 $Q$ 行，每行包含三個整數 $a$、$b$、$m$（$0 \\le a \\le 10^9$，$0 \\le b \\le 10^{18}$，$1 \\le m \\le 10^9$）。",
        outputFormat: "輸出 $Q$ 行，第 $i$ 行為第 $i$ 筆詢問的 $a^b \\bmod m$。",
      },
      samples: [
        { input: "3\n2 10 1000\n3 0 7\n10 18 999999937\n", output: "24\n1\n3969\n" },
        { input: "2\n0 0 5\n0 5 7\n", output: "1\n0\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "3\n2 10 1000\n3 0 7\n10 18 999999937\n", output: "24\n1\n3969\n" },
            { input: "2\n0 0 5\n0 5 7\n", output: "1\n0\n" },
          ],
        },
        hidden: {
          description: "邊界與手工構造測資",
          weight: 40,
          cases: [
            {
              input:
                "7\n5 0 3\n1 0 1\n0 0 7\n0 12 7\n0 0 1\n7 3 1\n2 1000000000000000000 999999937\n",
              output: "1\n0\n1\n0\n0\n0\n338263664\n",
            },
            {
              input: "3\n123456789 987654321987654321 1\n0 0 2\n1000000000 0 1\n",
              output: "0\n1\n0\n",
            },
            {
              input:
                "6\n3 10 4\n2 20 10\n7 100 20\n0 6 6\n123456789 1000000000000000000 999999998\n999999999 999999999999999999 999999999\n",
              output: "1\n6\n1\n0\n501994519\n0\n",
            },
            {
              input:
                "4\n1000000000 1000000000000000000 1000000000\n1 1000000000000000000 2\n999999937 5 999999937\n2 999999999999999999 999999937\n",
              output: "0\n1\n0\n169131832\n",
            },
          ],
        },
        hidden2: {
          description: "隨機中大型測資",
          weight: 60,
          cases: [
            {
              input:
                "500\n694 53432 530\n117 62261 447\n759 78120 195\n382 95963 420\n202 82428 101\n994 74480 56\n711 24001 667\n993 95155 586\n904 6645 306\n374 14816 592\n66 55273 537\n720 81938 830\n986 42241 656\n682 15908 620\n4 22732 310\n997 12224 862\n835 7350 81\n421 39337 793\n344 36247 736\n191 52681 454\n623 57952 598\n121 78447 892\n206 69844 8\n656 49705 875\n662 3968 130\n266 96314 263\n665 57496 60\n126 31738 902\n585 82950 221\n749 52982 266\n958 55122 554\n211 40456 578\n508 36525 402\n540 88469 399\n301 71701 675\n480 39902 852\n519 3078 221\n404 45117 551\n85 32704 295\n373 88273 150\n400 68637 114\n838 69803 363\n888 8107 194\n434 69412 232\n555 73310 544\n836 30731 310\n659 76543 160\n895 31326 271\n995 29803 553\n343 54528 299\n526 7276 26\n368 364 52\n626 22276 354\n981 86860 344\n75 81475 32\n377 75551 834\n398 45728 87\n853 53768 962\n547 86480 537\n715 95544 99\n700 69288 315\n660 45980 567\n668 92654 403\n63 37301 704\n795 97668 759\n155 26996 966\n348 55346 368\n382 98075 295\n397 60217 978\n142 23346 699\n383 61905 217\n911 81020 23\n753 90161 890\n964 99981 293\n479 5375 27\n971 37476 527\n194 96511 566\n547 53350 740\n57 2110 650\n124 37992 556\n854 22184 577\n912 62604 50\n58 86206 610\n55 16348 445\n780 4620 343\n692 6066 464\n805 81110 605\n750 82261 903\n428 23610 611\n635 50057 389\n548 69781 174\n676 77277 554\n551 76708 176\n450 69961 181\n342 30754 491\n448 71344 958\n452 50689 530\n133 76676 5\n411 92821 745\n434 26956 145\n236 93741 343\n155 79255 237\n123 42461 878\n70 7806 86\n619 89181 944\n703 55667 948\n172 94534 813\n193 4574 443\n964 23426 156\n128 46227 720\n224 21655 940\n815 19895 726\n281 15780 159\n853 62702 644\n196 42491 59\n481 97462 426\n787 61529 696\n196 44386 854\n939 84674 558\n992 35632 694\n47 26585 110\n625 79605 723\n480 69050 273\n713 16219 837\n744 68653 614\n308 21165 884\n334 29461 608\n183 25596 78\n564 31184 751\n221 45603 920\n9 80594 693\n861 60146 159\n267 99563 952\n163 99929 342\n845 56678 119\n57 25225 738\n654 75297 805\n938 98234 327\n213 64250 993\n565 7816 138\n171 20246 811\n491 4357 385\n330 99155 461\n980 94476 172\n999 151 17\n661 74207 345\n212 41973 982\n188 20958 939\n708 5569 364\n770 44047 19\n614 86344 820\n3 11247 239\n102 99543 36\n546 21535 119\n478 86743 182\n596 43347 461\n343 21056 629\n175 75634 167\n254 26355 665\n689 4568 540\n201 21264 911\n217 54297 928\n438 76396 312\n990 84766 293\n127 11646 773\n963 11729 521\n492 24333 292\n398 14013 876\n909 66639 769\n43 96716 850\n13 37955 244\n932 70398 572\n206 41036 600\n358 87598 831\n52 79750 285\n878 83005 285\n0 18874 133\n828 17362 74\n112 46493 279\n389 44116 455\n581 84769 790\n147 49905 982\n116 80990 203\n714 39628 804\n249 65905 303\n100 4019 890\n398 68113 482\n107 85425 9\n546 89080 798\n691 38373 353\n616 96397 591\n970 88391 302\n634 14653 104\n754 84940 848\n201 37278 231\n455 65236 408\n280 50421 506\n527 92778 75\n332 15715 655\n261 62798 405\n481 46956 201\n81 61587 381\n194 62464 842\n822 98381 933\n505 80219 162\n343 39000 106\n473 63437 83\n279 49735 299\n826 41242 356\n228 61641 87\n375 17344 794\n832 8397 368\n986 10453 56\n19 2367 605\n831 62178 657\n521 25784 973\n139 26822 303\n178 85401 529\n997 14717 627\n63 18362 336\n479 51701 765\n233 40579 943\n675 83453 832\n933 64382 214\n136 8209 527\n405 9791 592\n582 15533 932\n593 20224 281\n297 58161 392\n33 5453 51\n897 17815 166\n922 62456 10\n898 8678 428\n145 44166 857\n340 7842 12\n147 60140 955\n128 66304 220\n73 45466 922\n191 60728 830\n211 69302 790\n82 99243 187\n780 35164 177\n317 33119 494\n936 97874 43\n51 35658 716\n951 1210 179\n982 28373 589\n471 46701 384\n679 31886 498\n606 23677 696\n140 38121 193\n741 92560 142\n305 7371 546\n381 25526 918\n561 31768 99\n416 15072 610\n242 42967 719\n812 79396 674\n142 98178 930\n682 36586 690\n481 2439 161\n968 53404 896\n193 96343 198\n213 37238 65\n670 94302 783\n402 94680 711\n579 84647 934\n781 56624 460\n759 23635 94\n184 98378 568\n157 49323 153\n937 62399 434\n64 23764 488\n496 88285 506\n66 87396 301\n575 39123 6\n233 65916 750\n546 7225 282\n417 73239 921\n329 96482 537\n523 16072 124\n47 87768 360\n703 7468 299\n915 21648 281\n648 16769 363\n256 1388 71\n26 75310 284\n505 87764 708\n717 96367 634\n134 75206 894\n326 63476 461\n701 27767 536\n717 36466 139\n215 96463 408\n899 68380 928\n701 4535 452\n671 92406 915\n507 73474 568\n414 7472 964\n208 18062 362\n6 72978 194\n34 68851 512\n333 41604 133\n731 89731 85\n420 32662 215\n110 22021 266\n577 46651 861\n763 36097 534\n837 53715 724\n632 31624 436\n481 37611 703\n465 17588 670\n275 86966 695\n623 59859 993\n970 57551 897\n787 57787 663\n695 37887 712\n139 49062 524\n714 5182 78\n213 99930 75\n530 38290 591\n785 68921 71\n469 46932 222\n752 33702 484\n863 43763 780\n115 51738 192\n817 57527 664\n642 62230 852\n780 10333 732\n671 42899 424\n450 94577 810\n206 56327 235\n213 58769 263\n140 13060 306\n138 51495 794\n225 32541 383\n73 91661 844\n299 2053 948\n93 80360 780\n102 97283 152\n14 12522 865\n33 30776 811\n157 84434 411\n985 60004 490\n656 40482 709\n207 38023 191\n320 69228 401\n146 77351 936\n924 49455 574\n474 65855 694\n300 18388 110\n691 66605 456\n548 14134 736\n775 67372 29\n976 14401 257\n804 59285 311\n460 46102 246\n750 50004 409\n313 64216 694\n379 75804 651\n624 59555 909\n49 19478 368\n605 99982 513\n557 9864 423\n496 58961 976\n809 30911 358\n955 33190 564\n469 49491 74\n43 740 677\n477 58427 940\n741 2949 616\n18 68831 28\n105 72313 799\n74 93020 132\n806 74878 800\n770 58914 341\n922 17946 892\n369 63506 50\n544 24610 402\n904 77081 275\n160 91606 364\n634 67632 1\n258 27533 683\n72 22532 72\n42 34980 636\n561 48821 994\n132 96797 348\n752 8312 220\n949 97569 62\n310 36666 170\n480 90124 291\n235 82670 372\n659 63679 586\n876 83506 21\n40 7340 468\n405 23694 807\n758 8201 68\n748 67068 588\n267 85976 16\n774 74789 251\n130 47570 813\n90 45149 557\n123 15013 414\n24 68706 539\n67 37263 582\n591 60003 404\n408 86674 99\n935 58153 686\n994 8714 336\n932 91887 367\n38 53271 413\n427 16992 373\n48 54829 557\n491 83264 283\n916 11348 717\n141 97007 994\n363 59683 871\n451 64945 725\n629 48648 934\n160 92558 788\n446 25754 109\n187 42305 455\n19 26762 6\n471 88605 3\n540 88181 974\n467 28506 396\n321 87640 244\n976 22528 993\n443 51569 511\n475 74109 694\n592 15786 654\n400 20007 351\n249 4094 689\n43 52917 769\n817 36986 107\n814 31678 850\n400 69679 334\n395 9098 348\n836 49289 108\n938 80569 288\n275 84146 418\n132 68327 930\n382 35417 240\n657 41035 294\n142 29091 471\n683 50716 567\n747 26553 607\n442 37317 943\n527 10797 842\n224 64166 324\n585 55223 889\n226 96315 727\n884 30273 116\n636 36921 371\n103 86796 4\n346 77897 64\n83 16581 563\n624 25988 242\n963 36739 862\n881 58886 782\n634 95456 185\n314 55574 283\n835 74165 700\n262 44360 780\n994 95322 46\n716 18201 221\n646 36425 942\n898 60236 934\n104 19548 100\n129 7715 20\n203 25629 945\n487 89334 237\n887 51200 850\n938 99779 945\n713 16705 285\n684 95958 560\n145 37095 201\n987 593 784\n587 87175 771\n374 851 393\n727 21049 858\n174 36356 186\n263 35567 356\n20 11657 465\n362 49424 2\n109 4218 403\n110 27030 923\n233 65343 995\n458 40020 328\n524 70818 552\n968 96743 88\n599 23079 205\n98 1744 530\n70 41772 674\n72 46223 665\n788 94082 690\n842 20472 23\n325 42311 455\n666 15420 643\n148 94164 844\n",
              output:
                "346\n99\n66\n268\n0\n0\n126\n175\n226\n16\n378\n100\n576\n496\n16\n629\n64\n434\n160\n307\n131\n805\n0\n26\n66\n176\n25\n378\n26\n7\n298\n407\n196\n183\n76\n360\n157\n39\n255\n133\n58\n118\n120\n88\n9\n216\n59\n139\n232\n209\n22\n48\n4\n97\n19\n263\n7\n625\n262\n55\n280\n81\n51\n63\n522\n841\n128\n133\n577\n142\n216\n8\n83\n99\n5\n33\n118\n529\n649\n80\n541\n36\n424\n90\n295\n256\n430\n141\n300\n232\n134\n76\n1\n61\n39\n46\n42\n1\n516\n1\n41\n104\n113\n16\n779\n703\n289\n42\n4\n512\n664\n617\n100\n533\n48\n367\n283\n196\n441\n408\n67\n481\n261\n713\n492\n508\n448\n27\n151\n861\n522\n36\n771\n235\n53\n657\n314\n256\n624\n121\n324\n281\n37\n64\n4\n316\n74\n25\n344\n10\n616\n160\n0\n77\n114\n206\n137\n108\n134\n421\n726\n889\n48\n10\n38\n96\n268\n740\n586\n101\n169\n456\n256\n325\n214\n158\n0\n64\n133\n326\n221\n669\n58\n240\n267\n400\n404\n8\n168\n281\n280\n64\n88\n576\n225\n1\n170\n19\n523\n81\n91\n258\n502\n834\n37\n1\n45\n150\n128\n36\n295\n256\n48\n244\n216\n163\n70\n189\n556\n273\n464\n921\n51\n99\n34\n573\n748\n236\n209\n33\n79\n6\n316\n429\n4\n816\n36\n227\n401\n471\n180\n153\n307\n36\n169\n141\n451\n375\n247\n288\n117\n45\n281\n621\n0\n306\n180\n602\n4\n484\n20\n128\n139\n64\n622\n405\n567\n1\n81\n480\n64\n195\n264\n430\n183\n5\n481\n90\n486\n235\n109\n1\n131\n238\n219\n15\n20\n697\n453\n118\n402\n117\n113\n167\n145\n393\n61\n145\n360\n186\n96\n0\n106\n51\n135\n222\n724\n31\n705\n144\n666\n285\n605\n821\n811\n487\n71\n53\n66\n24\n430\n49\n121\n104\n47\n73\n9\n72\n48\n103\n0\n1\n241\n256\n326\n38\n161\n539\n321\n144\n16\n509\n304\n275\n309\n24\n315\n464\n448\n382\n60\n163\n512\n7\n52\n89\n40\n25\n441\n442\n243\n305\n16\n37\n496\n249\n361\n73\n598\n573\n69\n16\n575\n100\n416\n187\n476\n31\n292\n79\n204\n0\n201\n0\n468\n841\n132\n16\n47\n50\n24\n25\n189\n15\n196\n663\n24\n232\n1\n189\n790\n203\n9\n64\n55\n59\n45\n403\n112\n86\n335\n342\n77\n99\n163\n141\n688\n426\n159\n156\n74\n122\n1\n0\n270\n181\n13\n865\n312\n187\n46\n298\n381\n518\n3\n506\n314\n325\n80\n128\n187\n498\n112\n69\n469\n46\n124\n319\n113\n172\n401\n314\n48\n265\n1\n0\n430\n170\n413\n117\n86\n215\n375\n256\n6\n53\n532\n300\n36\n9\n413\n196\n1\n392\n143\n176\n58\n539\n419\n113\n727\n72\n11\n245\n0\n376\n818\n897\n40\n208\n0\n64\n466\n524\n508\n4\n9\n390\n40\n212\n",
            },
            {
              input:
                "100\n78785423 309630815297326701 139231303\n746503354 842435059059581411 22373609\n970353598 872100520646099733 840260130\n918561600 220706584298637605 640622158\n332948801 239051200422260998 644738433\n22018162 878604499540862566 693704719\n420708150 118786541540810581 629957293\n984035761 701660896004432263 591641946\n146010676 771518159313637173 533184606\n6361703 74826687853679125 624767773\n554993991 986308952812967322 776796746\n929641073 524265054319474035 267435748\n335096244 353867228449988920 139277794\n789391442 81856548119252179 790425870\n705595463 620022126953842960 503655845\n413189574 100751983899052172 679747379\n353201499 961592658845818206 4446277\n895125153 911049249638990644 138447470\n646427404 134278385196053313 998260024\n310711648 393013932312495294 645606061\n239091187 525194170518884684 548432240\n93304041 861821860003428140 553867670\n227068164 800712879271022729 245476229\n467475266 253086464186039711 644671946\n494465115 635192180568758492 521204397\n661949671 507454732101941259 332014546\n380451488 940229310469663845 958530671\n397027923 619740341946115290 80303083\n116286383 798015922219135285 603357300\n128962833 66670584881445257 986023914\n44666748 151207453537864786 293203968\n4652036 324943093691357439 377686905\n724799178 277522724054143003 734503967\n47444498 734856200578559772 644023106\n300734333 668898573361608502 230402847\n679403815 672258374300588194 731974189\n115690491 454268364429011355 893355544\n354654361 456364439956539405 432251924\n173885006 398025097805085716 919869155\n660082004 982456597920752412 843446387\n742597953 42279965595731910 340255906\n342925145 262456572878980114 461018170\n426036686 175003675565943726 623932931\n757833372 356244775832633584 953895805\n189982280 150838334989340260 124553036\n243609221 968128731258928348 596262227\n682639024 1183920070718738 817136936\n435352899 148549109081869942 507259235\n856797246 287916922071184443 477754954\n20290881 850400719490833412 411461480\n955060719 308728106864377883 842282452\n448780645 658271190407617959 18173295\n611283072 636071656194959311 981830140\n575093897 318623447409897946 862110362\n382628953 86037183994407740 873286865\n480321276 158497095191367900 341554175\n618555759 122090939879983395 789682698\n127989105 630591905230024575 792236361\n505973852 877996761561176054 730226739\n509909983 415311064594324380 284418405\n56600430 798974053532798569 400991398\n989413688 738157143773864803 501450535\n96186235 363617509747016940 131967602\n18336330 414843737958663630 582983904\n524162037 640668101552712020 832375638\n909052703 70955331199146783 590886228\n151526132 451998186845810785 35184961\n136049145 389066350624319833 735183758\n207958841 465725572041464356 230482982\n699552765 506741373013720532 289730142\n125436314 548266154233982055 198417825\n573130620 47117154939475035 443436137\n881165802 265821714007741804 406942338\n905965121 398582330558588316 838681197\n763200896 652894290490146326 885611578\n613090382 188197597686863564 700713252\n707776726 704811940302581560 250397310\n16305267 730634280457010584 627424831\n466034757 647565916230381741 284812177\n992378836 852878559476578122 756782821\n737016271 294591407917112503 121736034\n95689441 386953349635154599 842002697\n450453125 725551005792813865 22605245\n568909297 155064988711886023 714657275\n394809691 792827993006126027 137593788\n494246192 839919119461718679 185032471\n30437020 518131081208039563 596107025\n428195910 701822148415907404 461098510\n24069598 59520674862802783 191470006\n638026694 401905090679264044 986435831\n261270208 500151464490273530 73907147\n942374495 9131520858710100 870058601\n668051087 577576347271831567 46870516\n135617705 353356120423434524 162937995\n272891002 114785308775225658 651465671\n346392507 626088017787361773 852983235\n472994759 197886450873750945 67884667\n812288266 464055712780463217 558961929\n391092795 254185238716994912 53712131\n829957446 820142765287251933 45781773\n",
              output:
                "117348897\n6180228\n491150158\n375567786\n343667485\n405796943\n42356932\n26185147\n138643642\n116574316\n774182589\n132495041\n48837116\n82045358\n361395266\n80691722\n2455924\n14832091\n862873592\n287549048\n31690481\n450048231\n159502684\n367135474\n379994274\n174690505\n539627740\n45006186\n340561343\n309847359\n156512256\n156713036\n206236118\n625156672\n54528025\n85321324\n299997643\n2752465\n435508666\n558381811\n34510365\n128923245\n357389536\n616488556\n29305648\n461663150\n228210544\n483381376\n350411944\n251210361\n336241835\n12861505\n537397548\n130777405\n357304751\n289187551\n553848147\n590503353\n543051631\n34408126\n356252988\n66777182\n120742129\n195368160\n118137879\n211973351\n4215640\n211023\n49438281\n107690553\n55890674\n135660731\n24474846\n829935244\n467856362\n566628172\n64463056\n431530209\n69820756\n374793181\n37380481\n747341164\n13339500\n271664998\n35318227\n150670213\n311804750\n447330710\n57639848\n574276746\n18027066\n533955493\n41604035\n133096330\n408339644\n232380972\n16704831\n301464550\n51848382\n13789698\n",
            },
            {
              input:
                "15\n969882923 406082484850301123 348\n463572070 160235712981418745 222\n440322141 146201402820692273 1110\n198969544 111779702106390726 1932\n66799816 935881162468164801 1968\n510854201 481915919418406596 1608\n282156764 447158104108186713 96\n854507361 660832654416210625 1868\n624565271 602360982697070857 1242\n851128761 953298795970209377 1718\n843222 51683524 29323\n90366 790647700 90496\n686226 307638657 100561\n308332 868442685 78842\n1470572 590459699 150288\n",
              output:
                "287\n76\n801\n1156\n976\n1\n32\n1045\n443\n361\n12161\n66560\n73639\n18740\n100352\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_binomial-mod",
      title: "Binomial Coefficients",
      type: "full_source" as const,
      tags: ["medium", "Math", "Number Theory"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "二項式係數 $\\binom{n}{r}$ 表示從 $n$ 個相異物品中取出 $r$ 個的方法數。\n\n給定 $Q$ 筆詢問，每筆包含兩個整數 $n$、$r$，請輸出 $\\binom{n}{r} \\bmod (10^9 + 7)$。當 $r > n$ 時，規定 $\\binom{n}{r} = 0$。\n\n由於詢問數量與 $n$ 都很大，建議先預處理階乘與模逆元，再以 $O(1)$ 回答每筆詢問。",
        inputFormat:
          "第一行包含一個整數 $Q$（$1 \\le Q \\le 10^5$）。\n\n接下來 $Q$ 行，每行包含兩個整數 $n$、$r$（$0 \\le n \\le 10^6$，$0 \\le r \\le 10^6$）。",
        outputFormat:
          "輸出 $Q$ 行，第 $i$ 行為第 $i$ 筆詢問的 $\\binom{n}{r} \\bmod (10^9 + 7)$。",
      },
      samples: [
        { input: "5\n5 2\n4 4\n3 5\n0 0\n10 3\n", output: "10\n1\n0\n1\n120\n" },
        { input: "2\n6 0\n100 50\n", output: "1\n538992043\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "5\n5 2\n4 4\n3 5\n0 0\n10 3\n", output: "10\n1\n0\n1\n120\n" },
            { input: "2\n6 0\n100 50\n", output: "1\n538992043\n" },
          ],
        },
        hidden: {
          description: "邊界與小型測資",
          weight: 40,
          cases: [
            {
              input: "8\n0 0\n0 1\n1 0\n1 1\n5 5\n5 0\n3 5\n2 1\n",
              output: "1\n0\n1\n1\n1\n1\n0\n2\n",
            },
            {
              input: "6\n10 5\n20 10\n30 15\n52 5\n66 33\n40 20\n",
              output: "252\n184756\n155117520\n2598960\n480267059\n846527861\n",
            },
            { input: "1\n1 2\n", output: "0\n" },
          ],
        },
        hidden2: {
          description: "大型與隨機測資",
          weight: 60,
          cases: [
            {
              input:
                "8\n1000000 500000\n1000000 0\n1000000 1000000\n1000000 1\n1000000 999999\n999999 123456\n1000000 3\n876543 111111\n",
              output: "996692777\n1\n1\n1000000\n1000000\n984332785\n500336845\n211454007\n",
            },
            {
              input:
                "500\n541726 120417\n777452 624960\n767704 429996\n102902 74480\n192009 682773\n599911 53166\n881873 118534\n442191 274683\n849781 337928\n127264 79351\n317185 97795\n58805 5180\n946630 314701\n979246 289977\n421452 232148\n612109 124203\n211114 139688\n397641 895201\n132497 68114\n681686 459973\n253910 923536\n663605 225470\n423856 135728\n566633 216324\n520583 465490\n553192 407950\n690399 491695\n532033 24629\n360942 281997\n301663 382610\n409849 274551\n828511 558429\n64863 12358\n237545 142312\n856424 245851\n919786 612344\n250611 69167\n565287 351819\n539449 58212\n2918 52254\n178214 90373\n905785 694884\n651804 32289\n853787 407767\n873888 430146\n946953 691847\n764358 100829\n554311 322237\n367841 290070\n412124 32536\n298408 79801\n357183 221386\n784603 301187\n145940 46692\n392522 247621\n947231 648166\n995203 721289\n799852 299379\n26909 9369\n772091 579505\n757525 59122\n127270 303939\n887865 835439\n934514 500837\n689654 624568\n130784 454988\n350871 24264\n648882 618768\n923689 439128\n624947 400461\n946707 558253\n618219 566274\n179972 115288\n350649 123019\n570757 463647\n136689 1215\n852488 742571\n215650 37041\n350580 79619\n126854 42461\n62454 5501\n966332 720843\n970161 176286\n832304 198003\n987170 187408\n369822 368470\n961848 835050\n288389 63123\n877168 501621\n201272 84983\n779703 435489\n712253 201176\n962454 677398\n285059 24273\n640828 636845\n552405 279539\n856807 762011\n628155 316377\n342138 117844\n204774 19787\n768537 227284\n9893 7518\n796510 166983\n865674 453430\n201803 755534\n824162 785874\n514001 507987\n140912 43983\n830363 503315\n338440 793246\n755812 175168\n17382 11022\n193397 41916\n44552 23234\n19260 121\n105102 796350\n172286 120866\n185443 152620\n919169 346783\n168450 160853\n605074 171006\n210845 170102\n36550 34506\n170113 55604\n949702 448744\n611173 319382\n678135 300001\n790951 986459\n504134 194669\n112110 112026\n787061 44394\n869837 13472\n249810 238721\n210949 82073\n700791 53472\n291427 145531\n135229 848593\n115096 371947\n352935 232515\n678155 151538\n118790 80990\n317024 127699\n527244 309395\n911190 408310\n110081 85425\n712647 816133\n360933 315532\n604329 309157\n105741 96588\n206166 74556\n521892 208588\n517583 270039\n340640 62861\n502387 206920\n375654 102482\n389786 199431\n842310 787055\n641755 165561\n107738 60647\n84235 35773\n846606 329936\n881204 493131\n943531 963136\n812326 67180\n987066 868906\n19522 18939\n497428 336016\n995977 142615\n309398 91467\n541532 117738\n146900 85844\n782810 239217\n691244 667625\n515061 109391\n65674 538625\n605733 596965\n608186 161799\n927303 465291\n43627 3205\n169504 124913\n69426 437461\n876987 348925\n12242 2354\n977862 131200\n75567 45466\n195859 121457\n554421 84548\n799496 281312\n815954 264958\n782994 43196\n285271 733067\n9681 2861\n226984 150657\n392573 347710\n509476 310369\n144337 76242\n759688 740480\n58968 559052\n939138 575351\n426156 60289\n343739 317587\n785431 698517\n492911 431441\n991921 427237\n902951 770748\n297906 32890\n800768 411936\n593100 452996\n189086 23940\n580890 161544\n959643 499197\n190113 124678\n517853 34189\n307829 294812\n239414 131832\n57804 18030\n942349 337174\n535772 128577\n702149 368434\n305279 86594\n134152 92745\n827265 11105\n602481 289832\n724055 648796\n601648 915119\n471335 359365\n735230 291735\n771709 417621\n949932 717835\n687354 739250\n587794 581406\n59782 13347\n6717 583830\n829238 550813\n952971 332833\n717848 86433\n219481 28265\n590975 373211\n864863 288778\n429724 370550\n252999 111518\n719143 476589\n281924 695732\n877097 478876\n460408 458881\n678735 303096\n392502 267840\n41459 4976\n799443 76502\n604190 551371\n375460 226613\n494732 442069\n118625 105368\n836638 460221\n497847 435733\n749171 687730\n461243 378310\n450622 120091\n268704 71836\n104484 39156\n812038 231027\n75156 38389\n95335 999503\n798515 105465\n14623 1565\n246208 207397\n420116 240016\n323858 106413\n194884 82034\n150494 98910\n903834 526841\n307525 73555\n532841 466727\n113079 94081\n863996 538983\n115211 263090\n317942 235796\n768815 400036\n513735 355181\n665849 639915\n51006 9739\n620128 525047\n432669 254152\n829167 247288\n265526 240222\n44637 370\n489301 410330\n758897 23596\n550654 28271\n578508 817320\n134375 825528\n788884 471317\n143571 94624\n557548 196882\n616649 281383\n372155 325082\n47 16\n74456 22532\n279843 650316\n390571 68000\n770876 66503\n780556 63393\n173682 122909\n241237 165341\n988164 509432\n897671 668049\n58720 478643\n826161 776874\n766386 536544\n687811 15878\n598312 256987\n832480 92555\n126007 15013\n549655 68995\n595411 480030\n693399 100738\n465224 351090\n343764 187897\n422680 437709\n49864 438637\n666117 289135\n90786 18119\n372602 238734\n519562 370756\n955644 163929\n457701 103019\n338443 465514\n6111 482356\n553071 479131\n329624 124496\n454609 206278\n851302 592876\n126292 83602\n160061 89712\n704786 44285\n836670 295893\n956155 851596\n846708 253429\n557433 341561\n355398 197159\n644557 293920\n427744 67774\n391590 141669\n328285 150111\n481733 699664\n765399 212427\n958119 298541\n86383 28684\n599139 441785\n231936 192630\n242191 29686\n379146 52936\n3561 1386\n85572 16581\n207910 61786\n293915 235545\n763653 188933\n288792 134605\n976624 762577\n854222 899559\n225761 165440\n919739 481888\n156390 25415\n20475 208693\n498823 451213\n908891 409607\n798233 730858\n701276 767664\n296761 102422\n801969 601838\n383461 3406\n880167 168395\n290848 94782\n284538 182163\n475789 371492\n111616 103281\n113099 216246\n522746 509328\n335220 268491\n991304 878121\n613412 184633\n13955 8475\n689851 74086\n807462 752657\n901015 163780\n338489 465278\n657609 151631\n76938 16398\n281607 67984\n766190 21849\n793170 260860\n200731 156401\n902347 217415\n152342 102711\n615192 45574\n142588 130172\n68054 610124\n897042 758590\n191862 11123\n327242 297807\n770890 74448\n941940 563906\n273280 45816\n725517 4342\n828594 135202\n895483 122125\n865344 357444\n802341 477661\n91117 49751\n221746 16414\n456518 186917\n482876 128832\n646435 461527\n565062 387722\n78420 14195\n589216 125940\n962913 43619\n286331 2271\n368834 353905\n492937 126202\n182182 167086\n393151 304179\n611415 112978\n872417 346342\n422121 84904\n898309 644611\n823678 725193\n332281 167443\n450213 208025\n609309 477564\n931538 185529\n121633 29737\n669851 582287\n1076 830\n714856 135104\n298503 130929\n19815 612\n773434 401817\n280786 219131\n17747 3992\n958818 561615\n841904 373661\n972642 78250\n59685 57801\n333548 302029\n122224 111041\n310018 93127\n494115 63072\n497958 254840\n55273 9619\n391593 335675\n93931 41338\n550180 377298\n475026 291342\n454841 32266\n811275 411089\n880722 353853\n738701 423574\n47007 28804\n612294 498645\n360826 268276\n860513 687599\n241763 99351\n362508 296901\n793357 171164\n750342 641022\n832975 664508\n88319 73619\n775688 739045\n267929 59441\n351932 822268\n659884 22075\n862415 136281\n996659 385556\n134368 120665\n180695 7430\n582135 418160\n989554 450291\n40914 54133\n996797 365530\n421208 227442\n921774 8305\n628307 525302\n321375 159119\n918584 339889\n338273 173441\n979451 461908\n66293 39050\n381926 115590\n810505 975065\n947151 340009\n452707 99510\n430002 756904\n194306 101663\n462416 425589\n739491 438299\n204003 101671\n691821 952718\n955243 609927\n634717 272842\n",
              output:
                "9846941\n589626744\n500340236\n489387960\n0\n538113932\n161018612\n185488487\n60880226\n732712979\n604670739\n397451820\n850358866\n845101641\n134320705\n22752152\n831866107\n0\n919108042\n964645844\n0\n619559987\n352724323\n859702928\n838893152\n383182488\n207993650\n254764348\n199651620\n0\n814364287\n224688575\n29444756\n950039921\n57155584\n810890075\n838719584\n352591636\n105656744\n0\n525801151\n771438886\n932009659\n868826138\n362175051\n107147626\n407323287\n344978423\n894243636\n104877893\n926732005\n517666322\n204360259\n233202287\n388085253\n211370705\n164639645\n596286647\n828066560\n726129605\n932019710\n0\n679888380\n307172230\n891210027\n0\n8245948\n271613263\n535751008\n931366904\n712084538\n386492800\n730158333\n10860651\n354521682\n780570262\n177973198\n962878034\n352930869\n544196139\n969021604\n155206755\n789894001\n468294745\n214379986\n40307893\n698755929\n846909893\n541062294\n95911116\n506215434\n480008562\n947311413\n536467196\n380966743\n306276357\n376143774\n394729343\n429782868\n556015949\n80056222\n262921070\n136367311\n123678096\n0\n909067481\n317486239\n71671379\n966183703\n0\n876593880\n854954476\n414011235\n194288529\n451900266\n0\n972624927\n955453473\n386754217\n771239707\n225251723\n996798604\n195360148\n481359747\n764223672\n285375122\n645384401\n0\n521242819\n908634751\n566060574\n532749302\n633668069\n744127293\n229439277\n541813878\n0\n0\n277850786\n613885580\n214259963\n49967082\n187175692\n928979096\n489942513\n0\n181968490\n989765247\n467845601\n825481448\n980493372\n291361005\n749251453\n66244375\n142358352\n437710804\n121664212\n715148926\n159084450\n506416242\n187853729\n545361630\n0\n59498663\n118773848\n996814664\n621481980\n631780449\n762240892\n790262587\n626207220\n832485603\n610425387\n314467545\n0\n159124002\n870823374\n239169750\n213820817\n647865166\n0\n983666519\n383361752\n121505274\n846163142\n690204999\n238987089\n474019500\n170758498\n563983253\n0\n243610209\n273205072\n473653396\n156222571\n688812093\n864054735\n0\n5413075\n944736079\n818074845\n855661663\n122670030\n719129230\n448340841\n338983285\n634876948\n715306768\n808169254\n943633188\n980813618\n341408990\n83206919\n615124953\n820939224\n785718482\n707543903\n898002397\n553220737\n765388899\n623257497\n593647342\n586990064\n753709337\n0\n823905939\n876426786\n310217253\n49196391\n0\n910028329\n121052639\n0\n84549843\n1935265\n566250172\n545801199\n735454806\n62351710\n940907194\n161188011\n232346704\n0\n945481656\n312714795\n570322713\n439079881\n401038738\n193207446\n978268701\n608487596\n855090113\n937703505\n137126593\n182819745\n829336295\n226064362\n319702051\n160579035\n534749499\n945888185\n329107889\n0\n689631960\n665581136\n873599470\n293484146\n784569885\n265800334\n135304681\n328606489\n579951686\n828791344\n90018523\n76506726\n0\n578828151\n13872506\n481702051\n793699141\n679627563\n728409784\n649345570\n963235321\n111552451\n605710374\n929907462\n79465580\n434732940\n0\n0\n390048432\n630856941\n605988341\n271243541\n666839056\n232598577\n997805928\n0\n551894609\n425391283\n654797567\n436372851\n505798537\n762740624\n522501839\n0\n681182324\n795293402\n501217182\n213867905\n815877780\n82726016\n167436738\n937761510\n546317879\n391247003\n239270\n0\n0\n372835525\n482428570\n900713502\n426210404\n657467914\n741337228\n0\n0\n812935677\n688060569\n470415136\n762821223\n705683506\n981488950\n927792042\n13582975\n493063117\n174417300\n98568492\n554673289\n904854953\n467568638\n556433640\n659071978\n0\n438862303\n55573579\n166878338\n458110137\n742393877\n881017975\n438302223\n355246087\n749417542\n81498566\n34138099\n184630080\n679157627\n55452161\n0\n392603096\n168825843\n773188539\n0\n882409360\n59931081\n293870993\n0\n799356792\n883763954\n822751257\n61959089\n963599606\n108211694\n608783302\n528147133\n0\n407207328\n933864839\n674201321\n548302641\n377624774\n579228505\n278947727\n527723080\n0\n570925958\n830204561\n191498385\n465794410\n204995142\n288420352\n991535954\n944781999\n739315971\n987847104\n0\n500164671\n572827375\n913149091\n692705424\n954865670\n473288574\n691559463\n268407738\n697160847\n853957146\n169242006\n675021598\n773752668\n725436240\n238170956\n857721758\n41738069\n263441963\n902040247\n664933886\n983773323\n450182644\n888177837\n967035692\n893960502\n738467797\n512183095\n674630592\n226017528\n53066205\n976432517\n431568877\n592218877\n422464684\n564152426\n515020601\n832180663\n747298143\n540644282\n800994691\n893948199\n884118504\n753228505\n922299663\n888250251\n816607909\n679142243\n106534285\n580209178\n912379923\n237945213\n349436180\n696029405\n455990204\n607749232\n890891022\n747725934\n291789865\n420348500\n892301484\n229808054\n748935960\n258247219\n162637324\n240380862\n71133064\n184132380\n866724079\n336150896\n211459123\n149553904\n61564159\n804476149\n0\n397419934\n967696239\n283055087\n712960025\n432097834\n622708840\n932167917\n0\n629951751\n969044134\n444475862\n459618662\n471581181\n521292004\n778392366\n389797968\n932317550\n534647291\n0\n503742580\n90082302\n0\n925610338\n888387966\n377222436\n592476846\n0\n852024203\n463863169\n",
            },
            {
              input:
                "40\n3293 394\n917 352\n3578 2680\n2347 3628\n1204 2522\n4504 4817\n4517 598\n4066 176\n4838 2618\n2766 1721\n4619 1167\n4303 1732\n3458 990\n243 1290\n1536 3086\n603 3132\n4273 3693\n1134 1354\n1623 2642\n2386 1554\n4037 3684\n3409 2364\n1458 3361\n2487 1960\n1850 2732\n200 622\n934 2849\n1589 3226\n499 4955\n835 1525\n3185 4624\n1808 44\n598 2855\n3326 3112\n851 3127\n2604 2988\n4671 3105\n523 479\n3464 3725\n4060 188\n",
              output:
                "26253711\n460454983\n232144949\n0\n0\n0\n320226917\n838838912\n105687942\n755474654\n32108902\n375284239\n483764644\n0\n0\n0\n516894636\n0\n0\n682993387\n108121307\n981526212\n0\n486581528\n0\n0\n0\n0\n0\n0\n0\n459570616\n0\n95844023\n0\n0\n998751071\n139463343\n0\n473453965\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_matrix-fibonacci",
      title: "Huge Fibonacci",
      type: "full_source" as const,
      tags: ["hard", "Math", "Divide and Conquer"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "費氏數列定義為 $F(0) = 0$、$F(1) = 1$，且對所有 $n \\ge 2$ 有 $F(n) = F(n-1) + F(n-2)$。\n\n給定 $Q$ 筆詢問，每筆包含一個整數 $n$，請輸出 $F(n) \\bmod (10^9 + 7)$。\n\n注意 $n$ 最大可達 $10^{18}$，逐項遞推無法在時限內完成；你需要對數時間的演算法，例如 $2 \\times 2$ 矩陣快速冪或 fast doubling。",
        inputFormat:
          "第一行包含一個整數 $Q$（$1 \\le Q \\le 100$）。\n\n接下來 $Q$ 行，每行包含一個整數 $n$（$0 \\le n \\le 10^{18}$）。",
        outputFormat: "輸出 $Q$ 行，第 $i$ 行為第 $i$ 筆詢問的 $F(n) \\bmod (10^9 + 7)$。",
      },
      samples: [
        { input: "5\n0\n1\n2\n10\n90\n", output: "0\n1\n1\n55\n210345902\n" },
        { input: "1\n1000000000000000000\n", output: "209783453\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "5\n0\n1\n2\n10\n90\n", output: "0\n1\n1\n55\n210345902\n" },
            { input: "1\n1000000000000000000\n", output: "209783453\n" },
          ],
        },
        hidden: {
          description: "邊界與小型測資",
          weight: 40,
          cases: [
            {
              input: "8\n0\n1\n2\n3\n4\n5\n90\n100\n",
              output: "0\n1\n1\n2\n3\n5\n210345902\n687995182\n",
            },
            {
              input: "6\n10\n20\n30\n45\n72\n91\n",
              output: "55\n6765\n832040\n134903163\n8390086\n755204270\n",
            },
            { input: "1\n0\n", output: "0\n" },
          ],
        },
        hidden2: {
          description: "大型與隨機測資",
          weight: 60,
          cases: [
            {
              input:
                "10\n1000000000000000000\n999999999999999999\n987654321987654321\n576460752303423488\n100000000000000000\n2147483647\n4294967296\n1000000007\n99194853094755497\n308061521170129\n",
              output:
                "209783453\n470273943\n480042305\n323763477\n469857088\n822963728\n356980845\n1000000006\n157688361\n473267194\n",
            },
            {
              input:
                "100\n469993566831985585\n132400508081139590\n502653721341778490\n687151009122664544\n430861477750770144\n472785819790050654\n725052293582136781\n62536525861618417\n211117015883143812\n659609647234808134\n58456690537477291\n421598917382179983\n666390650638328317\n486194271029765593\n811247504021483787\n934345003781157916\n371556748742620668\n768516110390049589\n697986380018617981\n199957837481923953\n970178403273553683\n64657025294988673\n474025396086290641\n892552011362655099\n828074897061943028\n463392324540847498\n701801128401734328\n673021918348081592\n690029811356316129\n232123160519919913\n8706012666803983\n437211155043491132\n745921572556903492\n145682473311816407\n847189816444754883\n749522066845473336\n67531327457219908\n279177745263033309\n658952882975474691\n729642276925198287\n844153746820425119\n466034815147942630\n623019775851326208\n355862707356846786\n572387459281882041\n321281317243870649\n608241991561268279\n448546325500961297\n630694074414253359\n540624381237131731\n959220967650834734\n247787744422745898\n396860176758681401\n95992864973108069\n331682179104900241\n776459213133652713\n450634656585736147\n127814655565296066\n910958353633695934\n408689311850289512\n71318210552831366\n489284586430667744\n261183942866139579\n644844416468139165\n941649200854451793\n347988271487627830\n179717407156178221\n275550584184531139\n621540566810067428\n479636986708407338\n593131252501442847\n29092820211351817\n3209136685247468\n705345831942873676\n195948944699810730\n397466087548987500\n764033715975462810\n85473359618951484\n35503108576628217\n664561450933846601\n448345626572338663\n97413209846188663\n472950819983593390\n616725108369133469\n760694353301641633\n805684619431044257\n110862935925745905\n354303631317825780\n637871613547519808\n814995258679685531\n71549264871670503\n791713454860438359\n940678852834506980\n854473816775200576\n175484774437115115\n486833732715804153\n431046458421705987\n447361204919743780\n205353828812410581\n785894438612054762\n",
              output:
                "857087309\n708783554\n364447046\n596658073\n62064391\n394975529\n448814230\n195518569\n64262354\n51327616\n430590176\n485569354\n724616547\n652989456\n429436141\n701318882\n128860665\n369556642\n87953609\n418660168\n927502518\n135547452\n918737628\n750109980\n75806358\n153242560\n741840416\n465260821\n791387257\n280806711\n352171899\n235111996\n49878630\n311474212\n594302528\n586485094\n525408934\n187827482\n353060709\n160927495\n269411669\n702115777\n690123835\n420981274\n114571785\n904934510\n635073782\n93843545\n876801744\n781597163\n85192921\n149769396\n714809327\n874981357\n320967593\n504651336\n172502013\n668253596\n587238716\n151095146\n8955879\n310098576\n443263578\n103809936\n234158952\n973995649\n51811279\n527381665\n400098470\n472687431\n828446398\n320076139\n229282144\n294441744\n779221156\n153251307\n187324935\n235109433\n132940255\n35766277\n837200339\n231454962\n517222671\n489615447\n592289289\n291735689\n605932463\n326672522\n886065051\n236707512\n765460898\n279178477\n900215038\n237396582\n331216579\n584252506\n271635177\n501613565\n63140352\n958021904\n",
            },
            {
              input:
                "60\n49065\n61905\n27739\n81020\n2860\n96473\n90161\n99981\n37422\n61436\n5375\n3363\n37476\n67450\n24920\n96511\n72438\n70021\n53350\n94690\n7390\n2110\n83172\n15908\n37992\n71123\n22184\n73847\n62604\n6320\n7535\n86206\n78071\n7073\n16348\n56873\n99907\n4620\n43858\n88672\n6066\n59391\n81110\n77346\n96100\n82261\n54891\n23610\n78118\n81373\n50057\n49676\n70196\n69781\n22236\n86609\n77277\n70784\n70528\n76708\n",
              output:
                "792355057\n300152075\n296787541\n155754437\n614645275\n736095474\n235722249\n750671809\n122220973\n52789111\n423960688\n902053004\n219954485\n286559358\n541068495\n777638036\n191808046\n872740478\n644774556\n509074518\n153060720\n866689596\n940754846\n390917173\n691849438\n88218436\n891140354\n789184894\n728291323\n1504037\n785329476\n870086544\n177140180\n685266407\n512771684\n272737273\n971700449\n556371839\n776157825\n447398104\n166623492\n190785957\n522130817\n630375914\n906525957\n49567826\n159561141\n1778418\n191053231\n947975558\n793203745\n399316115\n617006431\n966442914\n887743444\n896012942\n240011168\n869547392\n587493101\n817162254\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_polygon-area",
      title: "Polygon Area",
      type: "full_source" as const,
      tags: ["medium", "Math"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "在平面上給定一個簡單多邊形的 $N$ 個頂點。頂點依照多邊形邊界的順序給出，可能是順時針或逆時針方向，座標皆為整數。保證多邊形是簡單多邊形：相鄰的邊只在共同頂點相交、不相鄰的邊完全不相交，但頂點可能出現共線（多個頂點落在同一條邊的延伸線上）。\n\n由於頂點都是整數座標，多邊形面積的兩倍必為非負整數。為了避免浮點數誤差，請直接輸出面積的兩倍。",
        inputFormat:
          "第一行包含一個整數 $N$（$3 \\le N \\le 10^5$），代表頂點數。\n\n接下來 $N$ 行，第 $i$ 行包含兩個整數 $x_i$、$y_i$（$-10^6 \\le x_i, y_i \\le 10^6$），代表第 $i$ 個頂點的座標。頂點依邊界順序給出，保證構成一個簡單多邊形。",
        outputFormat: "輸出一行一個整數，代表多邊形面積的兩倍。",
      },
      samples: [
        { input: "4\n0 0\n2 0\n2 2\n0 2\n", output: "8\n" },
        { input: "3\n0 0\n3 0\n0 3\n", output: "9\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "4\n0 0\n2 0\n2 2\n0 2\n", output: "8\n" },
            { input: "3\n0 0\n3 0\n0 3\n", output: "9\n" },
          ],
        },
        hidden: {
          description:
            "邊界與手工構造測資：最小三角形、順/逆時針、共線頂點、細長與凹多邊形、座標極值",
          weight: 40,
          cases: [
            { input: "3\n0 0\n1 0\n0 1\n", output: "1\n" },
            { input: "4\n0 0\n0 2\n2 2\n2 0\n", output: "8\n" },
            { input: "5\n0 0\n2 0\n4 0\n4 4\n0 4\n", output: "32\n" },
            { input: "3\n-1000000 0\n1000000 1\n1000000 0\n", output: "2000000\n" },
            { input: "6\n0 0\n4 0\n4 2\n2 2\n2 4\n0 4\n", output: "24\n" },
            {
              input: "3\n-1000000 -1000000\n1000000 -1000000\n0 1000000\n",
              output: "4000000000000\n",
            },
            { input: "7\n-7 -9\n-12 2\n10 11\n8 4\n11 -1\n12 -5\n8 -11\n", output: "658\n" },
          ],
        },
        hidden2: {
          description: "隨機中大型星形多邊形（含凹角）",
          weight: 60,
          cases: [
            {
              input:
                "500\n6068 0\n3363 42\n8754 220\n8462 319\n5263 265\n6631 417\n3492 264\n3538 312\n3999 403\n6803 773\n3459 437\n8714 1212\n2464 374\n3308 545\n2582 459\n7258 1385\n4474 912\n5181 1124\n4173 960\n6279 1528\n4676 1200\n3338 902\n4821 1368\n3959 1177\n2650 824\n7384 2399\n6403 2170\n6274 2214\n7676 2818\n4450 1697\n4328 1714\n4589 1884\n4446 1891\n6116 2692\n1862 848\n4749 2235\n5168 2511\n3950 1981\n1912 990\n6116 3263\n1811 995\n5178 2932\n2655 1548\n1923 1153\n2779 1715\n2077 1318\n2559 1669\n5643 3783\n5845 4026\n3706 2622\n5313 3860\n4269 3184\n4358 3337\n6394 5024\n3253 2623\n6233 5157\n5213 4424\n5117 4454\n1523 1360\n1909 1748\n1621 1522\n3184 3066\n6135 6059\n5713 5785\n5459 5669\n1939 2065\n4687 5118\n4943 5536\n5033 5781\n4882 5753\n1901 2298\n2041 2531\n4664 5935\n4357 5691\n4931 6611\n3013 4146\n4752 6716\n1688 2451\n4845 7226\n4476 6860\n2338 3684\n1299 2104\n3004 5008\n3437 5896\n2194 3875\n1157 2105\n1860 3486\n3572 6902\n1181 2355\n3742 7700\n1597 3393\n1422 3123\n1122 2549\n3470 8160\n3155 7685\n1559 3937\n951 2494\n2265 6170\n2733 7745\n669 1974\n1987 6117\n2375 7636\n1485 4996\n1634 5758\n1990 7366\n913 3554\n925 3802\n1485 6454\n1244 5733\n1148 5632\n813 4264\n1498 8427\n653 3964\n1014 6676\n1138 8180\n602 4768\n269 2365\n356 3525\n216 2455\n229 3028\n179 2838\n221 4392\n173 4586\n129 5130\n84 6655\n0 6737\n-86 6810\n-114 4549\n-250 6635\n-294 5841\n-182 2887\n-438 5804\n-371 4212\n-676 6697\n-806 7098\n-462 3656\n-695 4998\n-779 5125\n-663 4024\n-400 2248\n-440 2306\n-1787 8769\n-1522 7016\n-1137 4942\n-1577 6478\n-966 3761\n-1819 6731\n-2363 8327\n-2113 7105\n-1561 5019\n-2746 8450\n-2713 8007\n-801 2270\n-1683 4584\n-1841 4825\n-1443 3644\n-2398 5842\n-1176 2765\n-2913 6617\n-3317 7284\n-1035 2200\n-2992 6156\n-1732 3452\n-2973 5744\n-3219 6034\n-4257 7744\n-3738 6602\n-2202 3778\n-3658 6097\n-1590 2576\n-3748 5906\n-2688 4121\n-2147 3203\n-2082 3022\n-2032 2871\n-4452 6128\n-1598 2142\n-2205 2879\n-2067 2631\n-1950 2418\n-4532 5478\n-3954 4660\n-4369 5018\n-5529 6193\n-3472 3792\n-1550 1651\n-2306 2395\n-3946 3996\n-4986 4924\n-6072 5847\n-4066 3819\n-2646 2423\n-4587 4095\n-6444 5609\n-3302 2802\n-6563 5429\n-6482 5227\n-4748 3731\n-4261 3263\n-2326 1735\n-2244 1630\n-1867 1321\n-5172 3562\n-5805 3892\n-7499 4892\n-5250 3331\n-7622 4704\n-4134 2480\n-2538 1479\n-2103 1191\n-3521 1936\n-5043 2690\n-7907 4092\n-3647 1830\n-3280 1594\n-6390 3007\n-4295 1955\n-5408 2381\n-2816 1198\n-7375 3028\n-7843 3105\n-6807 2597\n-8026 2947\n-4081 1440\n-2109 715\n-3932 1278\n-7911 2461\n-5067 1507\n-3274 929\n-2952 798\n-3051 783\n-4929 1200\n-8264 1902\n-8001 1736\n-7157 1459\n-7164 1367\n-3285 584\n-7344 1210\n-3528 536\n-5626 783\n-2217 280\n-8194 931\n-2885 291\n-6125 540\n-6617 500\n-6495 409\n-6768 340\n-4582 173\n-7543 190\n-8569 108\n-6320 0\n-8857 -111\n-7946 -200\n-2387 -90\n-6693 -337\n-2635 -166\n-6610 -499\n-4581 -404\n-7941 -801\n-2298 -261\n-8557 -1081\n-2282 -318\n-2370 -360\n-1991 -328\n-2834 -504\n-8745 -1668\n-7688 -1567\n-8226 -1785\n-3220 -741\n-6620 -1611\n-7329 -1882\n-6843 -1849\n-3740 -1061\n-8431 -2507\n-6778 -2108\n-6458 -2098\n-3781 -1281\n-4509 -1591\n-6858 -2518\n-5246 -2001\n-5035 -1994\n-7806 -3205\n-4549 -1935\n-7333 -3228\n-2118 -964\n-5169 -2433\n-6288 -3056\n-1855 -930\n-6105 -3159\n-3531 -1884\n-5591 -3073\n-5537 -3135\n-2553 -1488\n-7380 -4427\n-3147 -1942\n-2495 -1583\n-4270 -2786\n-2033 -1363\n-2231 -1537\n-5984 -4234\n-2170 -1577\n-4640 -3461\n-6509 -4984\n-4070 -3198\n-5995 -4834\n-6019 -4980\n-2403 -2039\n-1912 -1665\n-5587 -4988\n-5948 -5446\n-5810 -5456\n-5042 -4855\n-3963 -3913\n-6117 -6194\n-4980 -5171\n-5025 -5351\n-5660 -6181\n-1586 -1776\n-4720 -5422\n-3940 -4643\n-1332 -1610\n-2377 -2948\n-4333 -5514\n-3467 -4529\n-3550 -4759\n-2358 -3245\n-3447 -4872\n-4624 -6714\n-4934 -7359\n-3205 -4913\n-3815 -6011\n-1371 -2222\n-1534 -2558\n-2979 -5111\n-3836 -6775\n-1366 -2485\n-1427 -2675\n-2527 -4884\n-1854 -3696\n-1304 -2683\n-1324 -2814\n-2060 -4525\n-3041 -6909\n-1252 -2944\n-2902 -7069\n-929 -2345\n-1339 -3509\n-2302 -6271\n-682 -1933\n-1365 -4030\n-952 -2930\n-1073 -3449\n-2339 -7867\n-850 -2997\n-1836 -6796\n-2082 -8109\n-880 -3617\n-1803 -7833\n-900 -4147\n-1480 -7260\n-1137 -5959\n-779 -4384\n-1334 -8094\n-1032 -6793\n-583 -4194\n-754 -5966\n-458 -4035\n-401 -3980\n-753 -8535\n-665 -8803\n-195 -3099\n-423 -8405\n-264 -6992\n-52 -2077\n-35 -2757\n0 -5050\n103 -8211\n204 -8112\n142 -3753\n257 -5112\n532 -8460\n261 -3458\n240 -2722\n492 -4880\n763 -6722\n1016 -8045\n1121 -8060\n313 -2058\n525 -3185\n507 -2854\n1156 -6061\n967 -4743\n1793 -8265\n1415 -6147\n1491 -6125\n1693 -6595\n896 -3315\n2256 -7950\n2288 -7695\n2304 -7408\n2311 -7111\n1029 -3038\n790 -2238\n1570 -4276\n2501 -6558\n1254 -3166\n3070 -7477\n3132 -7363\n2771 -6294\n2233 -4904\n1300 -2763\n3351 -6895\n1439 -2868\n2515 -4860\n3440 -6449\n3107 -5651\n1799 -3177\n4106 -7044\n2183 -3640\n2595 -4205\n2716 -4280\n3775 -5787\n1265 -1887\n3669 -5327\n3127 -4420\n4471 -6153\n2727 -3656\n3647 -4763\n5421 -6898\n1512 -1875\n4809 -5813\n3415 -4024\n2691 -3092\n2612 -2926\n2379 -2598\n5410 -5761\n2371 -2462\n6138 -6216\n3996 -3946\n2878 -2772\n5454 -5122\n4476 -4098\n6110 -5455\n2270 -1976\n5218 -4428\n1691 -1399\n2557 -2062\n3855 -3029\n3328 -2549\n3189 -2379\n4842 -3518\n5901 -4175\n4045 -2786\n4618 -3096\n6259 -4083\n3025 -1920\n7646 -4719\n1857 -1114\n3971 -2315\n6767 -3832\n3196 -1757\n3807 -2031\n2838 -1469\n7884 -3955\n7314 -3555\n2325 -1094\n5252 -2391\n2805 -1235\n1957 -832\n3282 -1347\n6433 -2547\n5326 -2032\n3766 -1383\n5714 -2017\n2441 -827\n4182 -1359\n2566 -798\n7448 -2215\n4501 -1277\n6766 -1828\n4212 -1081\n4768 -1161\n5873 -1352\n3728 -809\n5713 -1164\n7275 -1388\n2479 -441\n3346 -552\n2118 -322\n5369 -747\n2749 -347\n5609 -637\n3112 -314\n5659 -499\n3962 -299\n7230 -455\n7698 -387\n8710 -329\n5241 -132\n8226 -103\n",
              output: "187823899\n",
            },
            {
              input:
                "300\n415 -9\n891 -37\n342 -22\n570 -48\n353 -37\n326 -41\n849 -125\n796 -135\n780 -149\n854 -181\n376 -88\n775 -199\n369 -103\n832 -251\n672 -218\n575 -200\n883 -328\n596 -236\n631 -265\n581 -259\n307 -145\n303 -151\n547 -286\n382 -210\n798 -461\n460 -279\n435 -276\n323 -215\n505 -351\n400 -290\n582 -442\n551 -436\n506 -418\n640 -552\n649 -584\n625 -587\n501 -490\n264 -269\n273 -291\n208 -231\n471 -546\n457 -552\n266 -335\n511 -673\n371 -511\n365 -525\n323 -486\n280 -441\n176 -291\n384 -665\n427 -776\n249 -476\n140 -282\n200 -426\n176 -395\n247 -587\n201 -507\n262 -705\n272 -780\n253 -779\n180 -596\n227 -814\n85 -332\n209 -892\n63 -296\n115 -604\n113 -670\n67 -456\n41 -326\n43 -412\n61 -730\n57 -902\n19 -443\n18 -840\n0 -920\n-16 -765\n-23 -539\n-49 -785\n-36 -424\n-68 -648\n-86 -678\n-136 -918\n-97 -573\n-103 -538\n-167 -786\n-135 -575\n-102 -396\n-190 -679\n-124 -412\n-160 -491\n-228 -655\n-267 -717\n-236 -596\n-350 -832\n-316 -711\n-223 -474\n-291 -585\n-414 -792\n-367 -667\n-431 -746\n-367 -606\n-457 -720\n-269 -405\n-446 -642\n-528 -727\n-318 -418\n-471 -594\n-362 -438\n-478 -554\n-527 -586\n-321 -342\n-526 -537\n-366 -358\n-481 -452\n-360 -324\n-289 -249\n-571 -472\n-422 -334\n-535 -406\n-269 -195\n-288 -200\n-325 -216\n-476 -302\n-683 -413\n-429 -248\n-275 -151\n-494 -258\n-851 -422\n-354 -167\n-846 -377\n-398 -167\n-454 -180\n-776 -289\n-708 -247\n-719 -234\n-563 -170\n-864 -241\n-414 -106\n-417 -98\n-417 -89\n-699 -133\n-734 -124\n-897 -133\n-444 -56\n-673 -71\n-777 -65\n-933 -59\n-520 -22\n-811 -17\n-659 0\n-684 14\n-334 14\n-601 38\n-570 48\n-536 56\n-818 103\n-861 127\n-744 126\n-902 172\n-828 176\n-603 141\n-480 123\n-687 192\n-886 267\n-441 143\n-624 217\n-515 192\n-550 218\n-741 311\n-593 264\n-626 294\n-380 188\n-354 185\n-474 261\n-534 308\n-570 345\n-733 465\n-453 301\n-518 360\n-607 441\n-690 524\n-493 391\n-555 459\n-690 596\n-425 383\n-228 214\n-472 462\n-316 323\n-481 512\n-398 442\n-227 263\n-441 533\n-376 475\n-443 584\n-266 366\n-463 665\n-346 520\n-424 668\n-337 557\n-162 280\n-291 529\n-201 385\n-362 730\n-316 672\n-174 390\n-118 280\n-229 579\n-322 866\n-238 683\n-105 323\n-89 295\n-108 387\n-166 647\n-84 356\n-66 310\n-130 680\n-101 594\n-106 715\n-66 521\n-32 308\n-28 334\n-24 386\n-28 662\n-9 420\n0 384\n19 911\n30 724\n31 496\n77 920\n77 736\n108 855\n60 405\n150 885\n69 362\n195 916\n126 539\n231 901\n248 888\n90 297\n211 648\n307 881\n183 491\n194 490\n256 610\n164 368\n224 477\n299 602\n296 566\n265 482\n213 369\n175 289\n282 445\n253 381\n541 779\n507 698\n296 390\n264 333\n461 557\n327 379\n628 698\n293 313\n570 582\n317 310\n279 262\n283 255\n677 585\n320 264\n368 292\n259 197\n648 471\n710 494\n736 489\n278 177\n407 247\n745 430\n532 292\n412 216\n413 205\n293 138\n694 309\n705 296\n560 222\n359 134\n484 169\n822 267\n613 185\n825 230\n675 173\n605 142\n422 90\n632 120\n319 54\n844 125\n573 72\n925 97\n737 62\n428 27\n566 24\n719 15\n797 0\n",
              output: "2441677\n",
            },
            {
              input:
                "300\n579 -12\n320 -13\n351 -22\n461 -39\n785 -82\n866 -109\n374 -55\n344 -58\n302 -58\n305 -65\n557 -131\n314 -81\n561 -157\n818 -247\n737 -239\n627 -218\n773 -288\n445 -176\n818 -344\n428 -191\n544 -256\n491 -244\n448 -234\n297 -163\n806 -465\n409 -247\n506 -321\n561 -373\n638 -443\n393 -286\n547 -415\n480 -380\n316 -262\n427 -369\n587 -528\n385 -362\n319 -312\n630 -643\n624 -665\n464 -516\n225 -261\n229 -276\n549 -692\n446 -587\n338 -465\n433 -624\n509 -766\n437 -688\n267 -441\n217 -376\n359 -654\n292 -559\n172 -346\n353 -750\n355 -798\n236 -562\n211 -534\n253 -680\n126 -362\n173 -531\n202 -668\n128 -458\n131 -508\n74 -315\n140 -659\n161 -845\n152 -896\n108 -731\n90 -712\n95 -907\n73 -868\n38 -598\n20 -489\n11 -510\n0 -423\n-15 -699\n-24 -561\n-24 -389\n-60 -711\n-83 -792\n-77 -609\n-119 -808\n-70 -415\n-155 -813\n-143 -671\n-214 -913\n-166 -647\n-190 -680\n-137 -455\n-278 -857\n-119 -343\n-153 -412\n-347 -876\n-286 -679\n-278 -625\n-159 -338\n-227 -458\n-385 -736\n-166 -302\n-384 -666\n-180 -298\n-280 -441\n-391 -589\n-264 -380\n-431 -593\n-193 -254\n-494 -624\n-353 -427\n-368 -426\n-256 -284\n-325 -346\n-244 -249\n-217 -212\n-417 -392\n-498 -448\n-450 -389\n-700 -579\n-326 -258\n-291 -221\n-636 -462\n-757 -526\n-256 -170\n-540 -342\n-681 -413\n-340 -196\n-758 -417\n-344 -180\n-564 -280\n-545 -256\n-719 -320\n-358 -150\n-742 -294\n-564 -210\n-786 -274\n-563 -183\n-628 -190\n-637 -178\n-528 -136\n-500 -117\n-880 -187\n-445 -85\n-326 -55\n-342 -51\n-887 -112\n-802 -84\n-655 -55\n-855 -54\n-575 -24\n-764 -16\n-773 0\n-924 19\n-479 20\n-765 48\n-777 65\n-402 42\n-502 63\n-411 61\n-846 143\n-871 166\n-922 196\n-319 75\n-832 214\n-898 251\n-530 160\n-301 98\n-450 157\n-437 163\n-329 130\n-662 278\n-286 127\n-287 135\n-804 399\n-492 257\n-445 245\n-570 329\n-539 327\n-621 394\n-431 286\n-383 266\n-670 487\n-262 199\n-644 511\n-464 384\n-715 617\n-679 611\n-547 514\n-654 640\n-363 370\n-325 347\n-349 387\n-587 679\n-253 306\n-517 653\n-282 371\n-417 575\n-352 506\n-366 551\n-271 427\n-209 345\n-314 544\n-288 524\n-162 311\n-248 500\n-210 446\n-262 588\n-222 528\n-268 676\n-213 574\n-171 492\n-177 546\n-152 505\n-159 571\n-109 424\n-130 552\n-72 338\n-127 664\n-70 414\n-58 396\n-116 916\n-34 324\n-62 736\n-54 854\n-26 627\n-10 465\n0 341\n16 764\n20 468\n45 708\n72 852\n33 316\n91 719\n68 458\n65 382\n69 363\n121 568\n79 338\n190 742\n110 393\n131 434\n221 680\n301 865\n113 305\n334 843\n162 386\n250 562\n350 745\n396 797\n438 838\n408 742\n435 753\n342 564\n255 402\n343 517\n505 726\n422 581\n320 421\n524 662\n244 295\n490 567\n554 615\n542 577\n609 622\n625 612\n691 649\n577 519\n714 617\n711 588\n363 288\n577 438\n612 445\n688 478\n630 418\n690 438\n584 354\n348 201\n455 250\n398 208\n815 405\n436 205\n675 300\n769 323\n837 332\n581 216\n523 182\n360 117\n657 198\n718 201\n633 163\n454 107\n820 174\n799 152\n558 94\n553 82\n631 80\n466 49\n912 77\n944 59\n426 18\n930 19\n321 0\n",
              output: "2471673\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_convex-hull-area",
      title: "Convex Hull Fence",
      type: "full_source" as const,
      tags: ["hard", "Math", "Sorting"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "牧場上有 $N$ 根木樁，第 $i$ 根位於整數座標 $(x_i, y_i)$。牧場主人想用一圈總長度最短的圍籬把所有木樁圍起來，木樁允許恰好落在圍籬上。可以證明，最短圍籬圍出的區域就是這些點的凸包（convex hull）。\n\n請輸出凸包面積的兩倍。由於所有座標都是整數，凸包面積的兩倍必為非負整數，這樣可以避免浮點數誤差。\n\n注意：木樁位置可能重複；若所有點共線或只有一個相異位置，凸包退化成線段或單點，面積為 $0$。",
        inputFormat:
          "第一行包含一個整數 $N$（$1 \\le N \\le 10^5$），代表木樁數量。\n\n接下來 $N$ 行，第 $i$ 行包含兩個整數 $x_i$、$y_i$（$-10^6 \\le x_i, y_i \\le 10^6$）。點可能重複，也可能全部共線。",
        outputFormat:
          "輸出一行一個整數，代表凸包面積的兩倍；若凸包退化（單點、兩點或全部共線），輸出 `0`。",
      },
      samples: [
        { input: "5\n0 0\n4 0\n4 4\n0 4\n2 2\n", output: "32\n" },
        { input: "3\n0 0\n1 1\n2 2\n", output: "0\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "5\n0 0\n4 0\n4 4\n0 4\n2 2\n", output: "32\n" },
            { input: "3\n0 0\n1 1\n2 2\n", output: "0\n" },
          ],
        },
        hidden: {
          description:
            "退化與手工構造測資：單點、兩點、全共線、重複點、凸包上共線點、亂序輸入、座標極值",
          weight: 40,
          cases: [
            { input: "1\n5 -7\n", output: "0\n" },
            { input: "2\n-1000000 -1000000\n1000000 1000000\n", output: "0\n" },
            { input: "5\n0 0\n1 2\n2 4\n3 6\n4 8\n", output: "0\n" },
            { input: "5\n0 0\n0 0\n3 0\n3 0\n0 3\n", output: "9\n" },
            { input: "6\n0 0\n2 0\n4 0\n4 4\n0 4\n2 4\n", output: "32\n" },
            { input: "4\n0 0\n2 2\n2 0\n0 2\n", output: "8\n" },
            {
              input:
                "4\n-1000000 -1000000\n1000000 -1000000\n1000000 1000000\n-1000000 1000000\n",
              output: "8000000000000\n",
            },
            { input: "6\n0 0\n0 0\n0 0\n0 0\n0 0\n0 0\n", output: "0\n" },
          ],
        },
        hidden2: {
          description: "隨機中大型點集（一般位置、粗網格含大量重複與共線）",
          weight: 60,
          cases: [
            {
              input:
                "600\n2486 887\n-2439 -4559\n2637 8938\n-711 8123\n-930 2568\n8889 -9694\n-1838 -9399\n4399 -4919\n-5090 450\n-4511 -1561\n9130 -8050\n-6073 9260\n-8918 4176\n-764 -2926\n-7617 1804\n5571 -5903\n8195 -9392\n-5944 -6766\n-5294 -4175\n-8245 -1265\n414 -2616\n-9145 9930\n8933 -4033\n4251 -8119\n-123 3090\n-5218 -6503\n-6935 3343\n-9295 6164\n2938 -2450\n-9290 -7185\n-5577 -7448\n5022 3168\n3949 7443\n-833 7688\n-9079 -9533\n5197 548\n-4222 -5451\n-7846 -8702\n-6417 -5816\n3542 -7204\n9958 7334\n3710 9701\n-6740 -2078\n-2771 4333\n1902 5062\n3455 4747\n-7280 -957\n7765 -3068\n-1845 -924\n2362 674\n2446 -341\n4453 -7359\n-2977 8094\n-4617 -2992\n-8983 -2609\n-4081 5362\n-2109 -7890\n-2227 7946\n8581 -4916\n6148 783\n-6003 -2516\n2590 -6116\n4656 9620\n-3674 8107\n6313 2870\n1685 -1120\n1594 -9022\n-4148 9318\n-4945 -4984\n6810 6983\n-4199 3476\n-7649 -8626\n6705 9505\n1535 -2983\n3085 85\n-695 -5027\n-1513 2443\n-2443 -5968\n-843 9248\n3652 -63\n3212 6106\n-2166 -6802\n6389 5397\n9469 4458\n-2363 5854\n-4020 5540\n-450 -7637\n-1905 6226\n5453 8653\n2294 -8220\n7535 -9121\n-3596 3519\n6338 567\n2015 8997\n-4355 4015\n-9464 -2731\n-4569 6837\n3127 -5134\n-9129 9338\n7395 2291\n-9114 -2351\n-1122 -9217\n8250 7221\n-1930 2642\n-3898 -8549\n7267 727\n9217 6722\n-3962 6043\n-7908 8607\n7628 -8687\n-3784 2107\n-4082 -936\n5875 -7138\n4384 -9450\n171 -6521\n-23 2737\n-7811 7844\n446 4373\n2198 6778\n-4131 -7214\n-7646 2145\n2752 1496\n-4744 4984\n-4331 -1340\n-4785 -7070\n-7861 -9526\n336 97\n257 596\n-9485 -3612\n-8278 3888\n-6121 -9485\n-5109 -975\n7241 -1029\n1334 -4488\n5479 7371\n3244 5855\n-1726 7444\n-1074 8763\n-4713 -1940\n-9164 -960\n7121 -8262\n-3666 534\n-778 -707\n-1782 -423\n-1133 -631\n-6969 -7792\n-1338 8767\n7 -4884\n3271 7844\n7934 -9599\n2248 -2343\n2244 3588\n9660 4751\n3760 -2752\n-8758 -3358\n-7989 -292\n2102 -9304\n-4328 6224\n3798 -7112\n6709 8556\n8392 5475\n-8434 -6078\n3262 4986\n-7301 8027\n-6994 -9466\n-7153 8604\n-1010 4816\n4123 2714\n-1138 -8884\n-4984 -7168\n7610 3266\n2613 1616\n5417 -3454\n2144 9243\n-7150 7033\n6745 -4789\n-521 -3228\n-3966 -1165\n-1147 5905\n6133 -7107\n-1982 7162\n-2672 -4749\n-9146 -7317\n-7127 -1194\n685 -1920\n-4279 -5779\n-1727 -5150\n-4388 1508\n9125 -9759\n6188 -7341\n-7314 -7610\n8205 -6336\n1554 -5164\n-7027 -3435\n-822 1953\n-2040 -7516\n-5223 -201\n-7268 -4719\n-7766 -3893\n4995 -2067\n7773 -3034\n-1747 5662\n-2838 -449\n-7251 1400\n6694 3627\n6292 1467\n4601 5716\n1357 2659\n-39 -5144\n-6872 -9252\n4646 -5033\n-508 4206\n5569 4997\n-4972 5823\n450 -2442\n-7088 1347\n-7298 -6341\n7713 -507\n-561 -1460\n-2141 927\n-2998 -9806\n6884 7279\n5107 9418\n3944 -7731\n9465 6500\n5261 -2482\n-6755 4053\n-4931 3311\n-5722 8039\n-6925 -9421\n4464 9461\n-1917 -3621\n3380 1191\n3059 -2283\n3617 5105\n-490 -920\n3000 -8893\n4203 -63\n-3425 1312\n-3926 9733\n-4393 -8887\n724 8857\n3169 -8125\n5404 -8372\n7723 9616\n5385 3797\n-856 -4496\n7512 4554\n-5448 4643\n4128 -6247\n-2192 5796\n6546 -9309\n-7039 -3669\n-5151 88\n-8335 -8101\n1696 7069\n-8960 9460\n1924 5153\n1036 -1797\n597 2172\n-2549 -7705\n8716 -3282\n-9200 -9675\n4202 7883\n3161 -9503\n-7245 5024\n-5837 -9800\n7449 9907\n6712 -4819\n6117 2971\n-8372 7508\n-6567 -6978\n-5674 5296\n-3756 -3160\n-3953 -6507\n2716 -5571\n-4842 -8446\n-6975 -4191\n-8945 7610\n-9451 -6052\n3169 903\n-7444 8095\n-1298 -1491\n-8205 -3906\n1467 -946\n4750 -5917\n5243 4599\n1357 -2267\n-397 4581\n-9958 -7777\n-8781 4321\n5557 9536\n6693 7079\n3648 1010\n-3590 -1433\n-9307 7782\n-1335 -9704\n9424 4814\n-5151 -1501\n-3916 -2818\n4657 -4561\n6553 -4399\n5797 -3583\n-7770 -7890\n-5124 -1200\n-4983 -2968\n4703 -6648\n-1499 -600\n7108 -2760\n-8974 5222\n-4353 891\n9781 4549\n-67 9627\n3582 -8335\n-6422 3946\n6927 -2643\n7929 -1096\n-9682 9209\n9044 -9563\n7718 1505\n-9405 -1534\n5207 981\n6857 607\n-3767 9716\n-3800 974\n-7344 1626\n-2128 -3712\n-8138 -5792\n8480 -3829\n2812 -1272\n556 -2951\n1944 8861\n-4454 3023\n6941 9796\n-7255 -465\n4532 6074\n7070 -851\n-9421 2358\n-8494 2130\n7280 -6397\n4443 3610\n7378 -9937\n9509 8372\n-7341 8178\n3127 7940\n-8398 -6569\n-386 -7836\n-5680 -7394\n-1802 -3684\n-2848 -3135\n4142 5526\n4624 -6470\n-1385 8920\n-6382 -811\n-2540 -5326\n-1952 3719\n1463 6172\n-3818 8006\n2433 -5267\n7493 -5013\n-6546 8959\n-2833 9210\n-1773 -7771\n3060 2020\n-9068 2833\n-2987 2046\n-7071 -9989\n-7370 -8731\n9285 3646\n-3117 5160\n1298 9155\n-2657 -956\n8319 -4006\n5362 8473\n2858 2440\n-3649 3852\n-6995 -190\n4075 -1096\n-9643 -2634\n-3207 4177\n1494 2548\n-6873 6668\n2306 -2630\n4451 -2452\n8835 -8089\n2448 5078\n6866 9038\n1338 -7452\n-4960 -4287\n9849 9395\n-5665 -6943\n-2222 683\n998 4397\n7368 7600\n3452 -2181\n1581 -4718\n-5841 4820\n-9290 3721\n7718 7583\n-1305 -2911\n-381 2349\n-9251 168\n3449 -2350\n4183 3439\n-664 -9547\n-2673 -7415\n-3399 -5749\n-3124 2805\n3351 -4197\n4355 -4265\n-66 -4390\n-6218 2232\n2405 7193\n-3030 5523\n5101 9644\n-5383 8956\n-9729 -9021\n-6837 -508\n867 578\n-4297 -4891\n6030 2557\n9983 -5916\n-2697 4599\n8768 2413\n5300 3103\n-8095 -967\n9761 6301\n761 9674\n-6096 -4595\n6434 6870\n5029 4789\n-7327 -7492\n4366 5058\n-2809 -3178\n-6596 3958\n-3198 -9600\n-6031 -9852\n9184 3377\n5465 -1197\n-6943 -641\n-6206 -4109\n-1988 8393\n-8207 9305\n-7084 954\n-6638 -4600\n-5561 752\n8071 232\n7218 -4048\n2299 -2448\n-591 5743\n5817 -720\n2374 2022\n-1784 -562\n-3125 2318\n9819 1591\n4470 6164\n8488 -1138\n-7401 2695\n-9296 5267\n-7878 -1601\n-7147 -9406\n-9945 -8276\n7868 -8319\n-2504 -5890\n-9325 -1870\n6782 -8431\n7166 7417\n-1406 4487\n-6007 2439\n3634 1847\n-3270 -6163\n6498 -6336\n-4215 1128\n9389 51\n1089 5271\n-667 -9151\n-3869 -351\n4049 -8127\n-8332 5557\n2249 654\n1995 -7339\n-6668 3283\n-543 2461\n-3322 -8840\n-8123 4538\n1653 -6204\n8331 -3938\n1146 -46\n-8562 1377\n-6816 3671\n2741 -8867\n-5700 -7350\n7492 -1650\n-3954 -6472\n-8637 -613\n600 7321\n8236 -3955\n-8633 -8221\n6469 -4189\n8293 -7432\n-7458 1077\n-8139 -259\n-4639 1136\n-2479 -6390\n3660 -4402\n7698 7182\n838 -4534\n-1919 3736\n-8618 -8627\n-5191 9846\n-7180 7689\n8984 7296\n5038 4236\n2447 -2761\n6134 7821\n3610 6317\n2684 -8605\n-2561 -2737\n7796 -7962\n-3640 4060\n-4057 6293\n4759 5101\n2281 -1658\n7624 -7229\n-4678 -4736\n-4200 5304\n-1222 6017\n-2817 3343\n2459 8625\n8137 -5957\n4049 -6995\n-1678 7301\n-1048 1190\n673 6841\n8888 7091\n-3790 9006\n4365 -85\n-6474 -8804\n5335 -6313\n852 2809\n-3085 9584\n-2847 938\n-393 1769\n159 -2169\n-1115 -9207\n-459 2874\n-7271 -216\n-638 2713\n820 -3281\n8617 3999\n9564 7561\n-4546 -5344\n-824 3939\n5654 -5089\n-4095 -1737\n-93 -8473\n3766 -4984\n-6565 -9078\n-4150 3969\n-5389 -7569\n-9119 -202\n3224 -3592\n4750 -3849\n4912 -2995\n-1333 -3934\n9669 719\n-9148 743\n-4523 7435\n-9873 -23\n3381 2351\n-4558 5394\n201 -1283\n8620 -7349\n-8165 -7043\n-2543 -2299\n-7716 -8211\n4210 7801\n-6430 -7746\n4583 6841\n5303 -2402\n-8043 9484\n-4398 -5095\n-7400 -6942\n-1451 -9886\n9092 -6218\n-4913 -4410\n1481 -2220\n1967 9889\n-7003 -2736\n-6700 -3277\n-6213 -6451\n8986 -5237\n-6596 2392\n-5655 5483\n12 -2980\n-1417 6249\n5124 -9236\n1855 -1813\n6552 8149\n-91 4371\n",
              output: "780196575\n",
            },
            {
              input:
                "350\n-6351 -9180\n-987 -1975\n-2685 -5427\n-6641 7871\n-7151 9350\n3826 -8958\n-9023 -6929\n-2835 -2376\n6560 9727\n-9130 8391\n-3484 7857\n3747 -2776\n4720 9310\n-884 -9787\n-4768 3849\n1150 -894\n-4905 -2944\n1030 -6650\n-6960 2450\n-6830 1764\n1271 9783\n-1332 -8576\n5055 7572\n-5909 2404\n-7417 8090\n-393 1851\n8919 -3699\n-7720 -8498\n-2532 -517\n-7385 -2371\n-6690 2456\n-891 4858\n1955 -4670\n2131 1642\n-3134 -1251\n-7660 9961\n-4392 7503\n-1978 -4645\n5148 2434\n-1154 8251\n-2803 627\n-8167 -2494\n-8948 337\n3146 -1226\n-7831 -3086\n8586 312\n-3032 6359\n2965 5036\n-5318 -1320\n-5424 -1918\n8395 7662\n-1390 9156\n4039 9122\n3088 1862\n-2813 -5467\n6697 6172\n-7021 -8456\n-6407 -4991\n-4757 3834\n9544 -7918\n2609 2505\n9527 5338\n7339 -1761\n8129 -9623\n-6246 7596\n-1256 1147\n-6344 -382\n4247 -4817\n4868 -9893\n-1369 6404\n-4145 6636\n-6513 -220\n6636 9955\n-3482 -4991\n2253 -4706\n7675 7379\n-9981 9627\n622 6011\n-9361 -6334\n1895 77\n-2153 -8101\n-2107 8592\n-7419 -7193\n5925 -7732\n7456 -5879\n-5792 5575\n8016 -4589\n-1314 7291\n9877 3866\n-3059 7672\n-3408 215\n3075 2237\n4356 6960\n4795 -6034\n-1876 -2637\n-7901 1079\n-9310 9278\n8151 -2459\n9283 -2783\n-9764 -7673\n-8070 -2498\n-7791 -8970\n828 -7678\n6848 -2201\n-874 5907\n-2979 7670\n-5664 8712\n8882 5489\n-2037 5499\n3339 -3760\n-6909 -6823\n4125 1610\n3880 3471\n5304 -8224\n-6775 -8013\n3194 1119\n-6419 -1852\n-3721 -3767\n7574 4701\n-5406 3825\n-3987 -872\n5160 -1814\n-7529 4521\n8034 -6791\n-8342 7714\n-9516 -6943\n-2254 -4550\n3318 5914\n5774 -2995\n3142 -8078\n-4605 2419\n-9929 2794\n-1309 4910\n-652 3862\n8212 5948\n-4927 -3777\n-277 -2866\n-8083 8979\n7767 -8002\n277 -8126\n-8356 9143\n5624 6478\n7404 -4841\n-8136 6641\n-7374 -3910\n-7754 9499\n-7773 -2292\n3231 -6071\n8668 -1932\n8971 9482\n-8697 -7313\n3738 9126\n8522 7131\n367 -1455\n-3306 296\n-2178 -1296\n2970 -5711\n-169 4983\n361 -7622\n-9694 5018\n8449 -6723\n-7599 7618\n-3015 6577\n-1309 -5659\n1437 -7745\n-1995 2109\n-661 -4830\n4359 7801\n-87 7333\n-9743 8174\n-189 -6605\n-5599 -1333\n-6217 -6492\n8129 -4906\n-1075 -767\n9820 -3098\n1236 -3328\n-1349 6562\n6009 -1771\n-8335 -6975\n3880 -933\n-8555 -9883\n930 -5713\n-1416 -4705\n4479 8078\n4015 8380\n-9683 -6334\n-7534 -5115\n7878 -8819\n2099 9088\n8106 -5147\n4084 -5823\n-8629 102\n1949 -8692\n1725 -3116\n-1823 -6631\n1590 8347\n3317 -4935\n-2242 -4675\n-4198 3511\n-9187 -4122\n886 3492\n-1868 -1257\n-4783 -6457\n2536 -8731\n5424 -2711\n-3460 5084\n1458 1\n-2542 -2695\n-9224 -3671\n3057 757\n-870 -7725\n-853 1507\n6693 3097\n7571 852\n-9095 -6220\n-1440 -4148\n9025 -1301\n-8746 -6447\n9549 4240\n1328 279\n4300 9865\n6759 -6210\n2623 8894\n-3771 -1653\n-8545 4289\n-9944 7037\n7644 -3543\n1935 4133\n-7707 820\n287 -5916\n-159 6618\n135 3383\n689 3186\n-311 8167\n-5829 -3713\n3778 2424\n-4297 8649\n-138 3307\n7955 -9986\n-42 -598\n-3112 4087\n9005 9880\n560 5237\n4477 4489\n-2997 6751\n5506 -4439\n-7221 -700\n6891 984\n-6939 -2303\n172 -2638\n-3474 -5171\n-9199 -8485\n-1976 5570\n-7613 4924\n3581 8864\n-3628 2583\n6200 3096\n-2005 -5164\n-9818 -6507\n3932 -2829\n-4236 6973\n5223 -8354\n8266 -1834\n-6023 4958\n-5630 5226\n7405 8315\n9512 398\n4503 6541\n3984 7953\n4612 -4784\n5555 4748\n-1506 -1898\n-913 7082\n5880 -2160\n-1001 4414\n-7461 -637\n-2316 -1096\n1006 477\n7700 -7359\n-5465 -5057\n-2422 2552\n-4992 -2989\n-7895 3595\n3357 843\n7781 5268\n3625 -7959\n-3222 3768\n2763 9140\n-9359 8865\n2465 5630\n-9806 1527\n-215 2780\n3731 7637\n7896 9768\n-2773 5999\n-2809 -1056\n4282 5914\n-9048 2743\n1015 3249\n-4591 5316\n-5817 7503\n-9116 2912\n9396 8494\n-9111 -7249\n4045 -5553\n5129 -4045\n-8352 -1475\n2423 727\n-3064 4900\n711 1060\n2424 -882\n3814 -1733\n-7316 5412\n-9364 7676\n-8293 1468\n-2652 -7751\n-8680 -8983\n-1897 -3467\n-9332 -5006\n-2183 -5863\n5518 -6251\n8481 -2857\n5239 -1603\n2088 -4501\n9854 9899\n-6246 -4633\n193 -6457\n8963 -9158\n223 8868\n2299 2998\n-3501 -7509\n9402 -2042\n-6660 -117\n9675 -6033\n8545 -8654\n1378 7457\n4038 2143\n-7740 6580\n1182 -9585\n3765 6063\n-6541 4206\n1869 5065\n-4986 4271\n-4228 7097\n-1149 7635\n5844 5233\n4273 9415\n-1205 562\n-1955 -7160\n",
              output: "776510124\n",
            },
            {
              input:
                "500\n-28 -12\n14 18\n-21 -1\n-7 12\n14 20\n-24 -1\n8 1\n8 -29\n2 -3\n6 -7\n9 24\n30 5\n26 18\n30 -3\n-5 -19\n-27 24\n-24 22\n-23 -6\n-21 -24\n-20 2\n23 1\n-22 19\n-6 8\n2 -13\n6 -19\n-6 -26\n-27 7\n-27 -19\n30 -27\n23 -20\n-12 -13\n26 -26\n3 9\n-24 24\n22 7\n11 29\n11 13\n-27 -24\n24 9\n-1 20\n11 27\n16 -9\n-9 3\n12 14\n-2 -20\n-22 24\n-25 19\n-10 -27\n26 7\n-13 -7\n16 -19\n13 8\n-26 5\n12 -23\n-11 1\n27 19\n16 -7\n15 -3\n-28 0\n-4 8\n19 -25\n-8 -22\n11 -25\n25 12\n16 -21\n6 21\n-11 -24\n14 4\n-3 -2\n7 -28\n-21 -30\n-24 27\n20 22\n-23 -22\n17 -29\n19 27\n22 26\n19 -9\n-23 15\n4 1\n-14 29\n18 14\n-1 23\n-9 24\n30 -6\n-25 15\n-28 -25\n15 -17\n24 29\n13 -5\n-18 13\n29 6\n-5 -14\n8 7\n-4 28\n21 -10\n-5 -8\n-27 -19\n4 -19\n20 22\n-18 15\n17 -27\n12 -16\n-11 -16\n-8 -18\n19 -17\n-6 22\n-6 -16\n-27 -1\n2 -27\n-24 -29\n-29 4\n25 9\n24 2\n26 28\n2 25\n2 30\n-23 7\n-8 -14\n-16 -22\n-2 18\n-5 -21\n-15 -30\n-24 14\n-16 -23\n6 9\n-4 -18\n-6 -3\n-24 -30\n-19 -6\n-23 -9\n-10 -14\n4 -22\n4 6\n-21 14\n-15 -18\n-15 -28\n-25 -13\n0 14\n29 -13\n23 11\n20 -26\n0 15\n-9 -21\n-10 -16\n-30 16\n-17 0\n10 -21\n-12 6\n12 -2\n-11 16\n0 -2\n-11 28\n18 17\n5 1\n24 5\n9 -3\n16 -3\n3 22\n6 -26\n-17 9\n29 14\n10 16\n22 -21\n8 17\n-29 11\n-24 21\n26 10\n14 -25\n27 19\n27 11\n-16 -18\n-18 9\n20 16\n21 3\n-27 -14\n-20 1\n-1 -4\n-11 -26\n-9 -1\n-2 14\n-13 1\n-22 -23\n21 -10\n-8 -9\n-7 -24\n20 -6\n14 -2\n-10 -11\n23 20\n-17 -15\n20 -1\n-19 -7\n-11 -3\n-15 23\n7 -12\n3 10\n-27 30\n-19 -11\n26 -22\n20 -21\n-17 -22\n-19 14\n30 11\n7 2\n15 15\n28 -18\n-14 27\n1 -6\n28 3\n-19 -14\n23 26\n-24 23\n17 2\n-7 -22\n-24 23\n-3 -11\n2 18\n-14 -24\n-21 6\n14 3\n-5 -27\n-6 6\n-2 10\n-1 5\n0 4\n11 -24\n-30 13\n15 1\n0 22\n-26 -12\n-24 12\n16 -17\n-2 14\n-25 13\n13 4\n-3 0\n-21 30\n-19 -8\n-30 -25\n-14 -9\n28 -28\n-25 27\n5 23\n-10 -19\n-29 10\n-8 -17\n-10 24\n-23 -4\n-1 -27\n-30 10\n14 -25\n-16 27\n-24 29\n-18 9\n-17 -15\n-28 19\n-5 -28\n27 -23\n-24 -11\n-29 -26\n9 25\n2 12\n24 21\n21 12\n13 -16\n-14 -13\n-5 8\n-19 20\n-20 10\n15 -10\n1 21\n6 -4\n30 10\n15 24\n-4 12\n-9 -1\n-7 7\n17 -17\n-2 -3\n10 23\n28 1\n22 -29\n3 22\n22 -21\n-2 -28\n27 7\n-19 19\n25 -23\n-26 -2\n-26 -1\n-24 -23\n-29 10\n22 -14\n14 11\n2 22\n3 -5\n-16 1\n18 -30\n-15 -10\n-7 -24\n-5 -25\n-22 -30\n28 3\n8 -26\n11 -23\n25 -3\n-28 13\n-26 -18\n17 12\n-24 5\n5 29\n-3 21\n2 -29\n-8 14\n26 7\n-10 -7\n-12 12\n-3 4\n-29 -2\n16 16\n-25 -29\n9 -30\n-27 -29\n-3 -13\n-14 24\n30 4\n-11 -29\n-8 -2\n-11 -28\n-23 30\n11 -5\n-11 20\n-13 18\n-10 -25\n-8 -28\n20 17\n-17 4\n-23 -4\n-9 -7\n6 -2\n-12 29\n-23 1\n-8 2\n-19 27\n-24 -2\n-3 -3\n0 -19\n-16 12\n8 16\n-13 -14\n1 10\n-4 -24\n-10 -10\n-12 -24\n20 30\n9 2\n2 15\n-2 18\n5 27\n0 16\n-14 19\n23 12\n21 23\n-6 19\n-5 24\n29 -28\n-29 10\n19 -30\n-20 -12\n-18 17\n-8 24\n9 11\n-10 -21\n3 8\n2 -2\n28 -4\n7 -30\n-13 27\n10 -15\n5 -10\n-11 9\n16 15\n-30 6\n2 25\n-19 -27\n-11 15\n25 -22\n27 -23\n-2 17\n-9 -14\n-21 11\n-16 -29\n13 21\n-25 -13\n-14 -19\n6 -2\n2 25\n-28 29\n-20 -25\n-6 -11\n4 15\n14 8\n-22 3\n22 10\n-7 18\n-26 -7\n9 -2\n13 -7\n22 -25\n12 29\n0 7\n-26 18\n-23 -21\n-22 1\n-4 -12\n-8 -13\n-27 -5\n-21 10\n-1 8\n14 14\n7 28\n21 30\n6 29\n-8 -10\n23 29\n14 7\n-29 -21\n22 -15\n27 -19\n27 11\n-9 -25\n16 4\n22 30\n-2 15\n10 -30\n-6 -9\n28 -12\n3 -20\n-15 -18\n-3 5\n7 3\n-6 26\n-9 -16\n10 -15\n-10 -16\n1 26\n-25 -12\n-10 29\n-23 26\n0 14\n-10 -23\n-6 -28\n-29 -12\n-10 -17\n-12 -30\n-6 7\n24 -28\n17 6\n-10 28\n24 -27\n-28 0\n-5 23\n-23 -15\n13 -22\n30 -27\n29 14\n16 18\n6 -3\n21 -8\n-25 3\n-15 -23\n21 -13\n21 -29\n-2 -24\n20 -16\n-10 15\n27 20\n17 1\n9 -4\n23 5\n13 11\n25 22\n-8 12\n-7 30\n-25 -3\n-11 -15\n21 28\n-8 9\n-4 0\n6 26\n-25 18\n23 11\n9 27\n-27 -17\n-24 -6\n-12 -18\n-3 -1\n21 21\n-20 17\n",
              output: "7031\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_nim-game",
      title: "Stone Game",
      type: "full_source" as const,
      tags: ["medium", "Math", "Bit Manipulation"],
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statement: {
        body: "桌上有 $N$ 堆石子，第 $i$ 堆有 $a_i$ 顆。兩位玩家輪流行動：每次行動必須選擇一個還有石子的堆，從中拿走至少 $1$ 顆石子（可以把整堆拿光）。拿走最後一顆石子的玩家獲勝。\n\n先手先行動。假設雙方都採取最佳策略，請判斷最後誰會獲勝。",
        inputFormat:
          "第一行包含一個整數 $N$（$1 \\le N \\le 10^5$），代表石子堆數。\n\n第二行包含 $N$ 個整數 $a_1, a_2, \\ldots, a_N$（$1 \\le a_i \\le 10^9$），代表每堆的石子數。",
        outputFormat: "若先手獲勝，輸出一行 `First`；否則輸出一行 `Second`。",
      },
      samples: [
        { input: "2\n1 3\n", output: "First\n" },
        { input: "3\n1 2 3\n", output: "Second\n" },
      ],
      testcases: {
        sample: {
          description: "範例測資",
          cases: [
            { input: "2\n1 3\n", output: "First\n" },
            { input: "3\n1 2 3\n", output: "Second\n" },
          ],
        },
        hidden: {
          description:
            "邊界與手工構造測資：單堆、兩堆相等、XOR=0 的多堆、和為偶但 XOR 非零、極值",
          weight: 40,
          cases: [
            { input: "1\n1\n", output: "First\n" },
            { input: "1\n1000000000\n", output: "First\n" },
            { input: "2\n7 7\n", output: "Second\n" },
            { input: "2\n3 5\n", output: "First\n" },
            { input: "4\n1 1 1 1\n", output: "Second\n" },
            { input: "3\n1 4 5\n", output: "Second\n" },
            { input: "5\n1000000000 999999999 3 1000000000 999999999\n", output: "First\n" },
          ],
        },
        hidden2: {
          description: "隨機中大型測資（一般隨機與成對出現使 XOR=0）",
          weight: 60,
          cases: [
            {
              input:
                "600\n485738844 929583700 601051018 920049643 992363556 838826498 499987953 485151262 545290416 918098261 630699661 203905759 198277535 863181387 549657713 510846882 676331423 659233276 851452437 199902474 101064293 479525746 325774625 152251368 97356746 578417752 869349200 956038769 744573898 681238489 44968666 639345075 425373533 486399531 702143974 793404885 660955424 698008399 169107994 669079082 16106914 893032821 567345070 67822819 63942517 38281882 204234563 944425700 259784335 643835018 32300934 835487537 498145836 350354821 473016687 634537865 904549244 209724731 557405273 250875090 687507988 315842846 536627339 4932522 711299772 91255992 491054222 703087909 298675144 436775341 591919223 902174583 89339051 760004800 272724778 338526336 813885617 246601882 550705695 310354285 31945879 75401905 604669396 822795357 115885644 429926021 115752698 909012248 312354605 415015751 71754411 18136002 909791942 735403068 585121 229245688 225182358 995403921 977397048 56180957 504644995 403150546 761174664 426731187 450747588 78424326 607997444 675872065 213127160 835919668 724678205 289669335 361735932 93570373 334158800 357111101 16266657 440288823 813939802 990900180 126692605 144521863 264557048 759152684 108497649 11762860 64310054 499225356 855795336 522722530 190780435 732375075 600538585 202277357 480418804 546390106 204745830 785865427 826267960 140624835 450145316 691183853 412050350 125099504 423970577 451782904 228562780 505636 289690147 928071502 862656530 636450401 326573363 950116684 21078320 226248381 201119746 423349168 917380214 646412436 689165787 619505911 107731480 45212926 157151356 228968327 474101769 277323417 10281331 829669239 655340246 353213193 891516541 318176293 414646838 78811101 79758613 96762582 224125685 625706723 683530527 260933143 16652740 645623610 395861988 399114179 668027650 486628497 136602602 630577721 519395258 893738920 616941184 145747513 930424854 414568530 196309763 673499062 165501541 333731076 975412556 245224770 878108157 655460142 267897043 778882619 203796915 170162000 793950893 675359206 594779093 211086681 737632717 416837247 947244036 518097836 648039931 84286384 452536250 50897050 111497011 117088613 41550023 550137879 273995993 255987775 794384975 756536433 420489079 275931676 451846985 884460297 971547440 640450821 527206707 315073808 558425438 188370169 997759756 773473496 73847802 135721155 245238703 514644353 600615037 701698437 915257398 661285972 659602845 79607297 300883283 228063030 985007988 982417825 219020651 804216646 17797054 74253889 289044778 441765907 478572663 267430467 64913681 50034370 189251056 302754265 395980275 570160795 614362235 141281363 98990539 388850404 148614792 956639787 483555058 355370910 705375412 786950859 742193536 560427699 627537958 150696642 633374144 37667433 991694387 19213749 509804992 977333183 383832692 752660827 334797746 36015289 22826866 642497807 683097930 80352031 517796671 72231226 784366238 334001416 342421093 146679363 77773331 80812927 486502502 586365428 394896361 791353625 47743858 966577967 791442354 791508025 755582051 139097295 851763605 982476538 366805317 377778986 91189480 735669866 508178857 967265231 83396783 935337855 920514121 447914771 848827275 32501798 927146726 536791098 615047371 15604186 671046279 711101900 410527500 407137582 625646701 13365049 653765863 77576880 86116280 97333010 686555153 124103446 276169908 944669286 446941046 781906400 354495735 417080336 789241204 745344834 623793404 491511543 473007427 496736833 900192966 581164732 89960477 556946813 805532048 552473782 31986586 333112281 645625141 94201779 516423451 23934422 247198604 749831160 121209280 533918741 837460797 659817850 708810891 988340990 522157758 274695603 962521989 12141022 395084755 323231339 153781710 728144038 656870245 217512619 556621990 182114292 809355756 972511164 367782634 708658866 998903560 474521389 535057403 957484496 259291154 351071296 434604697 715003673 269078954 213143956 680938216 462670282 862981044 865423454 810277460 981637539 215061773 945181554 229984000 412766422 235769488 626106570 988705126 339825167 225370407 146218219 144474902 533077429 376609725 898824573 961699990 911306493 43564322 763664260 68868738 297207434 882462908 181600791 121149622 483881162 506110018 295453828 993997030 229867049 892167938 444512794 410757902 671876291 558319245 530294640 721712669 338627723 769096125 900996533 903985434 670848495 485843848 343969136 80186195 889839230 33807599 298633062 937193062 652356730 44547825 728270450 760886665 301796989 612657719 380335157 331818809 697165923 849881169 605632247 20523519 688252992 145901281 435068435 488372591 203923431 26549882 825936313 890849699 286058245 254915980 836717920 151262867 855608292 50404198 675577215 123807627 479405077 117059552 676418950 574872329 703347109 687104399 866922952 395870457 83717925 734968489 212654913 214041224 884589107 510180166 274923245 191862736 766891021 11560619 810729797 507020353 574289226 766835231 38842623 192305881 243155937 292438884 835998056 371234998 579486788 748732593 558799886 537317616 659758156 811970929 170931500 422534809 911351084 850330761 751394679 973064559 240435291 93640660 440751923 958474581 775646585 416581974 139489717 483723856 486980742 211394782 671677238 952758874 977067872 7222602 404588889 590572036 610759428 700803135 944163548 539716755 855522311 879877690 368398225 497902385 350541590 699352275 220003656 106262477 775172504 930030456 878691829 857174872 688930258 992384883 770583657 132590004 229025462 260158933 966350183 418998295 94320012 332707072 576552759 849101215 344021222 281194893 977094019 771234625 918890499 16801984 374206589 541938169 88876391 39873262 473414053 367277780 590882199 452493112 824884439 295554732 523392753 987582725 30505396 234391960 868807625 931523587 68780536 460564701 858842997 37692959 185645996 572435355 359708158 737213361 846007534 983555265 150860938\n",
              output: "First\n",
            },
            {
              input:
                "300\n364728811 63162139 710865674 546455041 904523736 922433851 779403808 369558836 225755998 55140201 461874745 219478472 175582696 361850560 364706749 239706399 579273673 458748743 280851928 845362808 504218550 747212147 883225254 683897992 808845106 434451276 731686592 596088145 712530826 748220330 80111481 551922599 191179231 89767817 294256951 646465387 412941122 364706749 434451276 683897992 581054490 390114433 414028608 46690031 46690031 879201418 35127231 904523736 11661309 599352002 652232658 670264953 409783936 395465084 880096429 359953317 690854884 120825630 646465387 557269119 518122105 414028608 645809581 875848685 174233215 214354925 670264953 55140201 236911151 536883929 725478342 430053680 93791755 1788722 972781082 89767817 982509896 288831131 748220330 270988482 928082888 63162139 454414640 639918967 710865674 11661309 717419455 390114433 493128857 779888138 536883929 183839729 375579191 551387751 879201418 615500765 65267068 972781082 375579191 645809581 986668573 928082888 654227028 599352002 83731453 293976528 879662852 705955724 224190244 465448206 19976215 667278945 715552799 430053680 544653039 870104599 238551022 687976388 779403808 88759640 687976388 449726251 359953317 455061830 712530826 302683305 97686868 145029771 110180060 615500765 416876101 599325292 465448206 270988482 238551022 93791755 950878905 398643872 590527261 879662852 747212147 709597926 449726251 654227028 120825630 875848685 652070934 389906314 288831131 454414640 472505235 461874745 489229833 557269119 206014984 705955724 494155610 494155610 294256951 922433851 856712856 828841259 455061830 947071469 986668573 55897733 382622734 544653039 192638378 65267068 710088111 880096429 504218550 737602120 224190244 32743096 710088111 581054490 296940758 549058419 145029771 667278945 652232658 252299723 156017681 225755998 568149844 709597926 476465637 618705693 153115962 88759640 652070934 369558836 394766943 175582696 183839729 808845106 982509896 280851928 599325292 394766943 335588014 332755408 332755408 389906314 296940758 412941122 244431277 402389573 476465637 549058419 731686592 27639129 174233215 39563186 856712856 493128857 122226614 361850560 870104599 741004767 845362808 122226614 302683305 546455041 97686868 398643872 409004667 509566392 30218607 869845843 518122105 19976215 950878905 236911151 402389573 293976528 828841259 741518216 458748743 409004667 239706399 947071469 551387751 821500544 596088145 717419455 30218607 214354925 153115962 364728811 509566392 535045272 409783936 191179231 395465084 192638378 35127231 244431277 55897733 156017681 489229833 511926007 32743096 639918967 39563186 618705693 252299723 741004767 590527261 725478342 27639129 335588014 551922599 741518216 690854884 511926007 821500544 80111481 579273673 110180060 1788722 869845843 715552799 219478472 382622734 472505235 535045272 568149844 883225254 723458063 930001965 737602120 83731453 206014984 779888138 416876101 723458063 930001965\n",
              output: "Second\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_interactive-peak",
      title: "Peak Hunt",
      type: "full_source" as const,
      tags: ["hard", "Binary Search"],
      memoryLimitMb: 256,
      timeLimitMs: 2500,
      visibility: "public" as const,
      judgeConfig: {
        type: "interactive",
        interactorLanguage: "python",
        interactorScript:
          'tokens = judge_input.split()\nn = int(tokens[0])\na = [int(t) for t in tokens[1 : 1 + n]]\nMAXQ = 40\nwrite(f"{n} {MAXQ}")\nqueries = 0\nwhile True:\n    parts = read().split()\n    if len(parts) != 2:\n        wrong("malformed command, expected \'? i\' or \'! i\'")\n    cmd, arg = parts\n    try:\n        i = int(arg)\n    except ValueError:\n        wrong("index is not an integer")\n    if cmd == "?":\n        queries += 1\n        if queries > MAXQ:\n            wrong(f"query limit exceeded ({MAXQ})")\n        if not 1 <= i <= n:\n            wrong("query index out of range")\n        write(str(a[i - 1]))\n    elif cmd == "!":\n        if not 1 <= i <= n:\n            wrong("answer index out of range")\n        if (i == 1 or a[i - 1] > a[i - 2]) and (i == n or a[i - 1] > a[i]):\n            accept(f"found peak at {i} using {queries} queries")\n        wrong(f"index {i} is not a peak")\n    else:\n        wrong("unknown command")\n',
      },
      statement: {
        body: "這是一道互動題。評測系統持有一個隱藏的整數陣列 $a_1, a_2, \\ldots, a_N$，所有元素兩兩相異。若 $a_i$ 同時大於它的左右鄰居，位置 $i$ 就是一個 peak；邊界視為負無窮（$a_0 = a_{N+1} = -\\infty$），也就是說 $a_1$ 只需大於 $a_2$、$a_N$ 只需大於 $a_{N-1}$，而 $N = 1$ 時位置 $1$ 必為 peak。陣列中可能有多個 peak，你只需要找出其中任意一個的位置。\n\n互動流程如下。互動開始時，評測系統會先輸出一行兩個整數 `N maxQ`，其中 $N$ 是陣列長度，`maxQ` 是查詢次數上限（本題固定為 $40$）。接著你可以重複執行：\n\n- 輸出 `? i`（$1 \\le i \\le N$）：查詢 $a_i$，評測系統回覆一行一個整數。\n- 輸出 `! i`：回答位置 $i$ 是一個 peak，互動立即結束。\n\n回答正確即為 Accepted；回答錯誤、查詢超過 $40$ 次、索引越界或輸出格式不符，都會被判為 Wrong Answer。\n\n每次輸出一行後務必清空輸出緩衝區（flush），例如 Python 用 `print(..., flush=True)`、C++ 用 `std::endl` 或 `fflush(stdout)`，否則互動會逾時。範例中的「輸入」欄是評測系統依序送出的行，「輸出」欄是你的程式依序送出的行。",
        inputFormat:
          "互動開始時，評測系統輸出一行兩個整數 $N$ 與 `maxQ`（$1 \\le N \\le 10^5$，`maxQ` 固定為 $40$）。之後每次你送出 `? i`，評測系統回覆一行一個整數 $a_i$（$|a_i| \\le 10^9$，所有元素兩兩相異）。",
        outputFormat:
          "查詢時輸出一行 `? i`；確定答案後輸出一行 `! i` 並結束程式。查詢總次數不得超過 $40$ 次，每次輸出後都要 flush。",
      },
      samples: [{ input: "5 40\n2\n5\n4\n", output: "? 3\n? 4\n? 5\n! 4\n" }],
      testcases: {
        sample: {
          description: "範例互動使用的隱藏陣列",
          cases: [{ input: "5\n1 3 2 5 4\n", output: "" }],
        },
        hidden: {
          description:
            "邊界與手工構造陣列：N=1、嚴格遞增、嚴格遞減、山形、多重 peak、N=2、線性掃描會超限的 N=60",
          weight: 40,
          cases: [
            { input: "1\n-1000000000\n", output: "" },
            { input: "8\n1 2 3 4 5 6 7 8\n", output: "" },
            { input: "8\n1000000000 5 4 3 2 1 0 -7\n", output: "" },
            { input: "9\n-5 -1 3 8 20 9 4 2 -3\n", output: "" },
            { input: "10\n10 1 20 2 30 3 40 4 50 5\n", output: "" },
            { input: "2\n5 9\n", output: "" },
            { input: "2\n9 5\n", output: "" },
            {
              input:
                "60\n13 46 11 41 51 54 31 17 1 20 25 12 9 30 60 52 22 40 23 48 19 32 29 43 47 59 57 50 18 2 39 34 58 37 15 8 49 44 36 45 16 55 27 28 6 3 14 33 56 38 24 7 35 53 5 4 42 26 10 21\n",
              output: "",
            },
          ],
        },
        hidden2: {
          description: "大型隨機排列（1..1500 洗牌），線性掃描必超過查詢上限",
          weight: 60,
          cases: [
            {
              input:
                "1500\n735 47 1230 938 1372 774 1038 129 884 134 193 638 806 145 1358 454 140 245 552 1185 998 359 143 969 520 690 481 967 944 237 1268 225 1091 1164 622 775 1338 639 51 123 1125 1459 834 250 443 790 1293 448 424 1270 787 417 1373 731 1279 1302 402 1003 1082 1196 859 45 821 98 286 990 1040 240 217 287 436 1120 1339 1090 773 211 1234 1078 899 970 1422 314 572 255 309 353 688 330 256 795 902 1103 95 1043 600 1473 1258 1417 918 508 328 429 1466 168 259 586 64 812 504 1147 582 278 1455 296 401 858 1467 1382 69 348 979 88 1166 873 921 517 480 468 1469 164 554 917 219 269 557 1096 393 378 482 909 668 642 299 457 612 502 1456 1113 1108 392 370 1464 1088 585 772 1359 1379 710 655 462 1335 957 117 986 1116 118 479 977 77 48 1278 360 363 1397 222 397 311 570 1284 886 1254 472 730 814 251 323 50 819 1304 739 1344 207 618 566 1484 1021 1402 1392 953 396 1221 1429 275 565 380 662 762 5 1167 835 441 1307 672 1162 960 399 609 1079 235 4 224 343 495 232 556 1492 581 128 516 1443 1362 699 856 941 451 326 811 879 691 395 788 1357 185 184 801 912 1349 253 68 1387 1385 1129 385 1086 503 1171 83 1143 803 24 1175 874 527 831 1318 3 1383 442 1395 579 948 1435 590 992 965 604 769 1352 778 1479 914 1363 876 1396 1342 591 574 722 157 342 703 1351 961 1450 1201 336 116 683 258 671 1126 752 561 461 158 1246 933 202 1173 315 1388 1451 1144 828 513 593 152 86 1291 939 369 497 375 1046 686 297 114 320 52 103 805 665 903 541 808 1361 1475 280 1337 695 543 718 968 1052 1172 1128 737 238 1132 159 1333 754 445 149 846 829 290 1326 1261 477 1298 1005 340 911 1453 179 33 440 1000 1457 537 1123 196 63 575 1347 1283 943 807 412 676 214 629 364 770 1104 376 1130 568 1181 1122 862 996 781 694 26 93 643 863 1011 1287 435 922 177 151 895 41 1346 744 57 208 1095 959 753 555 220 496 740 640 1267 1493 1285 234 1354 637 1085 1015 131 500 743 794 94 701 667 681 634 310 366 1170 324 1192 658 233 636 894 506 371 1280 1024 439 1264 892 647 1087 997 880 611 534 913 780 329 150 112 983 702 110 1314 619 1232 1286 704 1002 982 614 594 1430 649 422 963 1229 1497 1020 898 931 995 1433 751 381 1189 1233 1014 1240 915 820 73 847 294 1368 1180 951 139 563 976 115 254 919 1442 307 530 510 670 1204 470 1431 1152 1485 75 972 1009 1374 1182 1289 1369 244 270 1486 1336 975 1421 837 1075 849 784 264 606 661 845 1376 190 471 39 714 221 1150 942 978 210 1183 897 1006 1010 312 705 195 1055 648 493 1260 410 804 868 1413 241 19 756 689 1299 955 890 535 1194 492 236 1377 1135 1321 101 610 1440 1134 544 989 146 1218 768 1281 865 1195 426 755 491 288 1458 1259 413 1489 1023 1214 783 580 243 28 641 415 906 1131 928 1364 65 1159 162 349 1465 1295 464 927 558 1102 1389 377 924 578 1228 1 1076 1412 1099 635 891 1313 1476 1198 644 1031 560 404 398 631 1250 1165 126 512 467 138 1220 613 621 22 1133 966 274 1056 1140 1083 993 478 1048 758 199 551 707 505 201 1208 1249 267 1329 1100 257 844 1399 99 1432 90 163 175 458 55 1408 1271 10 1153 680 96 733 1404 588 802 169 1155 44 523 696 386 302 836 239 745 848 72 486 403 624 1225 308 262 577 885 1251 334 759 1334 1001 327 717 325 713 1320 1460 1409 1025 1341 1200 524 338 1107 1207 1491 889 1472 716 1068 82 598 719 449 1380 721 13 522 800 120 1356 549 839 1306 501 1141 154 625 851 602 1438 490 1081 346 742 832 1483 91 489 1269 650 545 605 1414 932 793 1050 987 823 518 771 487 830 669 1419 1401 313 1065 187 930 1089 984 316 954 1275 540 76 191 708 281 1178 390 1058 626 1169 1308 6 592 608 1161 532 9 728 300 248 1324 623 1227 483 599 200 838 400 81 446 317 1034 1027 850 908 660 1301 1149 122 664 66 1098 748 1012 418 1092 67 384 463 1265 1202 423 1426 1468 904 746 841 368 1272 107 779 766 434 546 1036 447 1067 1416 469 1496 321 1069 1231 35 883 529 528 741 358 656 1094 1022 720 373 1049 1105 877 521 160 587 1403 935 181 437 726 419 887 1398 78 723 792 1057 362 1062 450 1119 1311 265 1077 216 1191 92 215 760 1273 30 697 1145 165 573 331 357 654 379 279 425 952 1487 183 1184 231 303 318 261 127 738 991 937 16 882 1262 1474 872 319 475 542 1112 1157 1187 1032 1355 1406 356 1353 1211 628 1163 260 268 1028 511 525 1236 632 652 682 869 857 186 767 494 427 293 144 407 34 389 852 1117 514 945 907 809 1448 1047 1033 1343 947 536 815 1217 653 1255 729 589 905 148 860 1241 1477 43 1066 1277 1063 465 252 799 842 1348 79 37 1424 1470 339 1226 725 291 1305 853 1378 206 994 596 601 1072 734 58 29 1316 999 1375 1282 344 1296 679 1142 1332 1054 962 1154 533 1041 1216 341 1109 391 896 1213 817 1039 1330 1193 1017 1303 102 21 867 1288 444 1478 1051 432 698 276 1325 198 1138 1219 706 1074 105 1390 301 678 367 476 1266 1203 1059 295 1322 559 1418 875 1071 981 571 42 627 20 352 365 374 1222 657 414 1371 736 732 1042 277 1471 798 810 827 1044 1350 335 673 1407 188 87 645 23 459 147 421 1093 583 7 1500 203 1029 1053 663 466 1238 1461 40 156 687 1110 1127 1315 916 692 176 1257 747 433 387 56 1114 1156 350 189 1370 1168 1384 675 1495 789 901 934 956 946 617 1297 161 1328 881 818 711 1447 1276 854 507 1405 651 1340 194 620 15 826 724 383 80 615 271 564 121 452 646 974 515 119 855 1064 1499 46 519 900 32 1437 1061 526 12 484 167 1345 411 1394 958 1445 213 763 170 153 246 108 227 223 453 1420 266 1310 1244 1300 218 283 980 791 305 1393 920 1490 18 659 1237 684 155 54 973 1274 1121 964 1323 62 133 1292 372 70 388 1488 142 1206 833 840 97 1428 1480 74 498 1016 1427 761 474 940 499 1498 60 1235 109 1004 124 929 1007 205 1365 1317 1462 132 616 1111 1176 1312 1425 1080 1073 633 1115 893 1199 1190 59 137 1097 538 1215 988 1124 1294 171 796 1118 1146 1212 936 971 361 1436 27 456 333 173 1367 355 263 1084 567 1331 204 715 1013 1247 1224 562 1481 1205 785 1319 292 1494 1423 135 242 607 1139 1391 282 569 1151 985 289 1366 727 31 1253 603 797 428 923 125 100 25 304 1243 247 337 539 1415 104 61 531 351 595 1446 757 1360 764 1045 822 197 473 1327 871 136 1160 509 709 1019 878 1148 782 53 1449 1060 212 584 1290 630 182 666 1411 910 455 438 229 888 2 674 1245 1482 38 1177 408 824 431 925 749 1197 226 712 178 1158 1209 1070 1463 750 1454 1035 1252 332 1444 825 1439 71 1179 550 306 1242 1400 1137 553 111 85 1248 354 298 1188 192 1309 394 816 141 861 406 1101 1018 1174 174 1026 36 1106 273 172 17 677 416 405 1186 249 8 1223 230 870 485 49 285 1008 776 113 843 11 1452 409 89 700 576 813 430 547 180 864 460 1381 420 597 209 786 1410 130 1210 1037 272 228 106 488 345 322 866 926 1441 347 777 84 1434 1263 1136 685 166 1239 950 1030 693 14 1386 382 284 548 765 1256 949\n",
              output: "",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_mf-lru-cache",
      title: "LRU Cache (Multi-File)",
      type: "multi_file" as const,
      tags: ["medium", "Hash Table", "Design"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "這是一題多檔實作題。可執行的進入點是 `main.py`：它從標準輸入讀入快取容量 $C$ 與 $Q$ 筆操作並依序執行——`P k v` 呼叫你實作的 `put(k, v)`，`G k` 呼叫 `get(k)` 並印出結果。\n\n`main.py` 會 `import` 唯讀的 `iolib.py`（提供 `read_ops()` 解析 stdin）；`main()` 已經寫好，你只需在 `main.py` 裡實作 `LRUCache` 這個 class。\n\n`LRUCache(capacity)` 是一個固定容量的快取：`get(key)` 回傳該鍵目前的值，鍵不存在時回傳 $-1$；`put(key, value)` 寫入或更新鍵值。`get` 命中與 `put`（包含更新既有的鍵）都會把該鍵刷新為「最近使用」；當 `put` 使快取內的鍵數超過容量時，淘汰**最久未使用**的鍵。本題規模刻意訂小，任何正確的實作都能在時限內通過，重點是淘汰語意的正確性。",
        inputFormat:
          "第一行兩個整數 $C$ 與 $Q$（$1 \\le C \\le 100$，$1 \\le Q \\le 5000$）。\n\n接下來 $Q$ 行，每行是 `P k v`（執行 `put(k, v)`）或 `G k`（執行 `get(k)` 並印出結果），其中 $0 \\le k, v \\le 10^9$。",
        outputFormat: "對每筆 `G` 操作輸出一行：該鍵目前的值；鍵不在快取中時輸出 `-1`。",
      },
      samples: [
        {
          input: "2 8\nP 1 10\nP 2 20\nG 1\nP 3 30\nG 2\nG 1\nG 3\nG 5\n",
          output: "10\n-1\n10\n30\n-1\n",
        },
        { input: "1 5\nP 7 1\nG 7\nP 8 2\nG 7\nG 8\n", output: "1\n-1\n2\n" },
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content:
            'from iolib import read_ops\n\nclass LRUCache:\n    """Fixed-capacity cache. get(key) returns the stored value, or -1 on a miss.\n    put(key, value) inserts or updates a key. A get hit and a put (including an\n    update of an existing key) both mark the key as most recently used; when a\n    put makes the cache exceed its capacity, evict the least recently used key."""\n\n    def __init__(self, capacity: int) -> None:\n        # implement the data structure here\n        pass\n\n    def get(self, key: int) -> int:\n        # implement get here\n        return -1\n\n    def put(self, key: int, value: int) -> None:\n        # implement put here\n        pass\n\ndef main() -> None:\n    capacity, ops = read_ops()\n    cache = LRUCache(capacity)\n    out = []\n    for kind, key, value in ops:\n        if kind == "P":\n            cache.put(key, value)\n        else:\n            out.append(str(cache.get(key)))\n    print("\\n".join(out))\n\nif __name__ == "__main__":\n    main()\n',
          visibility: "editable",
          description:
            "The runnable entry. main() reads the operations via iolib.read_ops and prints each get result. Implement the LRUCache class here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "iolib.py",
          content:
            '"""Read-only I/O helper for the LRU cache problem.\n\nDo NOT modify. main.py imports read_ops to turn the stdin stream into\nthe cache capacity and the list of operations to execute.\n"""\n\nimport sys\nfrom typing import List, Tuple\n\n\ndef read_ops() -> Tuple[int, List[Tuple[str, int, int]]]:\n    """Return (capacity, ops); each op is ("P", key, value) or ("G", key, 0)."""\n    data = sys.stdin.read().split()\n    if len(data) < 2:\n        return 0, []\n    capacity = int(data[0])\n    q = int(data[1])\n    ops: List[Tuple[str, int, int]] = []\n    idx = 2\n    for _ in range(q):\n        kind = data[idx]\n        if kind == "P":\n            ops.append(("P", int(data[idx + 1]), int(data[idx + 2])))\n            idx += 3\n        else:\n            ops.append(("G", int(data[idx + 1]), 0))\n            idx += 2\n    return capacity, ops\n',
          visibility: "readonly",
          description:
            "Read-only stdin helper. Provides read_ops(), which main.py imports to get the capacity and operation list. You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "Get refreshes freshness and changes the eviction victim; capacity 1.",
          cases: [
            {
              input: "2 8\nP 1 10\nP 2 20\nG 1\nP 3 30\nG 2\nG 1\nG 3\nG 5\n",
              output: "10\n-1\n10\n30\n-1\n",
            },
            { input: "1 5\nP 7 1\nG 7\nP 8 2\nG 7\nG 8\n", output: "1\n-1\n2\n" },
          ],
        },
        hidden: {
          description:
            "Update refresh, pure misses, refresh chains, no-eviction capacity, and 1e9 keys/values.",
          weight: 40,
          cases: [
            {
              input: "2 9\nP 1 100\nP 2 200\nP 1 111\nP 3 300\nG 1\nG 2\nG 3\nP 2 222\nG 2\n",
              output: "111\n-1\n300\n222\n",
            },
            { input: "3 4\nG 5\nP 5 50\nG 5\nG 6\n", output: "-1\n50\n-1\n" },
            {
              input:
                "3 12\nP 1 1\nP 2 2\nP 3 3\nG 1\nG 2\nP 4 4\nG 3\nG 1\nG 2\nG 4\nP 5 5\nG 3\n",
              output: "1\n2\n-1\n1\n2\n4\n-1\n",
            },
            {
              input: "100 6\nP 10 1\nP 20 2\nP 10 3\nG 10\nG 20\nG 30\n",
              output: "3\n2\n-1\n",
            },
            {
              input:
                "2 5\nP 1000000000 999999999\nP 0 0\nG 1000000000\nP 999999999 123456789\nG 0\n",
              output: "999999999\n-1\n",
            },
          ],
        },
        hidden2: {
          description: "Long random interleaved operation sequences with heavy key reuse.",
          weight: 60,
          cases: [
            {
              input:
                "4 250\nG 9\nG 8\nP 7 515\nG 3\nP 4 801\nP 3 448\nP 1 164\nP 1 550\nP 5 805\nP 5 810\nP 6 64\nP 6 216\nG 1\nG 9\nG 10\nP 4 388\nP 3 414\nG 11\nG 0\nP 3 353\nP 12 721\nP 5 577\nG 2\nP 6 67\nP 12 701\nG 11\nG 10\nP 2 896\nP 8 890\nG 2\nG 10\nP 1 589\nP 5 718\nG 7\nG 1\nG 9\nP 12 652\nG 2\nP 12 955\nP 8 910\nP 2 153\nP 4 69\nP 0 705\nP 5 197\nG 4\nP 5 959\nP 2 209\nP 6 819\nP 5 287\nG 10\nP 2 648\nG 6\nG 7\nG 0\nG 3\nG 7\nG 8\nP 5 959\nP 2 695\nG 5\nG 6\nP 11 67\nP 3 123\nP 2 378\nP 0 681\nG 3\nG 10\nG 8\nP 8 469\nG 8\nG 4\nP 11 903\nP 6 997\nG 4\nP 3 350\nG 11\nG 7\nG 4\nG 3\nG 12\nG 9\nP 0 949\nG 7\nG 12\nP 2 824\nP 10 708\nG 4\nG 1\nG 9\nP 5 74\nP 2 998\nP 6 6\nP 3 659\nP 12 237\nP 11 161\nG 2\nG 9\nG 11\nP 7 193\nG 8\nG 12\nG 8\nG 1\nP 0 953\nG 8\nG 9\nP 2 41\nG 7\nG 11\nG 9\nP 4 137\nP 11 295\nP 10 98\nP 4 169\nG 11\nG 10\nG 2\nG 11\nP 10 33\nP 3 919\nP 3 205\nP 6 168\nP 7 947\nG 3\nP 12 929\nP 3 39\nP 3 270\nG 0\nP 6 606\nG 10\nG 10\nG 12\nG 7\nG 4\nP 0 309\nP 1 21\nP 5 993\nG 0\nP 6 58\nP 3 128\nG 7\nG 1\nP 2 676\nG 12\nP 7 994\nP 11 610\nG 4\nG 2\nG 8\nG 4\nG 6\nP 8 543\nG 1\nG 0\nP 7 640\nG 5\nP 2 491\nG 3\nP 12 65\nP 6 779\nP 7 554\nG 0\nP 7 354\nP 6 78\nG 8\nG 12\nP 11 784\nG 6\nP 12 711\nP 0 854\nP 9 174\nG 4\nP 2 575\nP 11 580\nG 9\nG 3\nG 11\nP 3 572\nG 3\nG 1\nP 7 312\nP 2 162\nP 7 811\nP 0 825\nG 1\nG 2\nG 0\nP 0 235\nP 10 737\nP 6 883\nP 3 791\nP 9 962\nP 11 231\nP 9 980\nP 4 432\nP 12 938\nG 2\nP 0 540\nG 6\nG 12\nP 4 505\nP 9 107\nP 1 697\nG 12\nP 12 179\nP 9 610\nP 11 944\nG 11\nP 9 181\nG 3\nG 8\nG 4\nG 2\nP 6 734\nP 8 889\nG 10\nP 11 716\nP 2 371\nP 2 476\nG 12\nP 10 900\nP 7 430\nP 10 718\nG 0\nP 5 820\nP 1 585\nG 5\nP 0 837\nP 7 228\nG 4\nG 2\nG 3\nP 2 292\nG 4\nP 9 727\nP 2 631\nG 0\nP 9 320\nP 9 582\nG 5\nG 6\nG 8\nP 3 62\nP 0 845\nP 3 338\nP 12 997\nG 10\nP 1 279\nP 2 750\nP 3 34\n",
              output:
                "-1\n-1\n-1\n550\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n896\n-1\n-1\n589\n-1\n896\n69\n-1\n819\n-1\n-1\n-1\n-1\n-1\n959\n819\n123\n-1\n-1\n469\n-1\n-1\n903\n-1\n-1\n350\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n161\n-1\n237\n-1\n-1\n-1\n-1\n193\n-1\n-1\n295\n98\n-1\n295\n205\n-1\n-1\n-1\n929\n947\n-1\n309\n-1\n-1\n-1\n-1\n676\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n65\n78\n-1\n174\n-1\n580\n572\n-1\n-1\n162\n825\n-1\n-1\n938\n938\n944\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n820\n-1\n-1\n-1\n-1\n837\n-1\n-1\n-1\n-1\n",
            },
            {
              input:
                "8 250\nP 24 480\nG 13\nG 6\nP 1 871\nP 14 540\nP 10 506\nG 20\nG 27\nG 6\nP 10 435\nG 14\nG 26\nP 1 770\nP 8 894\nP 27 991\nG 1\nG 5\nP 24 389\nP 8 218\nP 29 366\nG 4\nG 22\nP 6 243\nG 9\nP 11 299\nG 10\nP 24 357\nP 24 199\nP 25 533\nG 24\nP 11 246\nG 17\nP 28 996\nG 6\nP 0 681\nP 16 326\nP 3 755\nP 5 608\nP 21 728\nG 9\nG 20\nG 4\nG 21\nP 4 898\nP 0 743\nP 20 765\nP 19 511\nP 3 824\nG 5\nP 28 667\nG 27\nP 15 375\nP 6 691\nP 25 422\nG 14\nP 29 774\nP 13 804\nP 20 682\nP 30 618\nP 5 464\nG 15\nP 7 212\nP 0 989\nP 30 320\nG 16\nG 22\nP 20 894\nG 12\nG 15\nP 9 195\nG 3\nG 17\nP 17 393\nG 17\nG 8\nG 7\nG 9\nG 17\nG 30\nP 28 225\nG 11\nP 19 53\nG 30\nP 17 484\nP 10 243\nG 23\nP 6 956\nG 11\nG 20\nP 26 200\nG 5\nP 14 46\nP 22 905\nP 9 142\nG 30\nG 23\nP 12 39\nG 9\nP 22 142\nP 18 50\nG 21\nG 11\nP 28 290\nG 8\nP 10 192\nG 8\nG 21\nG 13\nP 27 942\nG 20\nP 9 22\nP 20 461\nP 22 211\nP 17 344\nP 23 65\nG 16\nG 28\nP 10 374\nP 19 813\nG 14\nP 24 443\nG 26\nP 18 547\nP 6 89\nP 11 819\nG 30\nP 27 950\nG 27\nG 5\nP 23 598\nP 8 4\nG 29\nG 2\nP 2 818\nG 1\nP 22 351\nP 16 917\nG 8\nP 23 923\nG 22\nP 1 558\nG 13\nP 6 857\nP 4 655\nG 28\nP 0 14\nP 3 879\nG 7\nP 26 618\nP 19 374\nG 9\nP 8 339\nP 30 979\nP 18 500\nP 26 62\nP 30 604\nP 29 488\nP 15 245\nG 28\nG 12\nP 4 844\nG 24\nG 11\nG 1\nP 8 66\nG 30\nP 5 533\nG 23\nG 2\nG 11\nG 0\nP 2 663\nG 12\nG 9\nP 16 603\nP 2 663\nP 9 571\nG 25\nP 7 83\nG 24\nP 0 419\nP 25 337\nG 12\nG 20\nG 29\nP 9 746\nP 0 265\nP 17 593\nG 11\nG 22\nG 29\nP 6 698\nG 4\nP 29 869\nP 17 877\nP 1 964\nG 9\nG 24\nG 11\nP 0 837\nG 12\nP 9 317\nP 19 631\nP 17 480\nP 1 933\nG 4\nP 8 393\nP 14 596\nP 30 866\nG 5\nG 23\nG 27\nP 29 713\nP 20 736\nP 18 581\nP 25 604\nP 15 60\nG 24\nG 24\nP 6 412\nG 18\nG 24\nP 3 578\nP 9 943\nP 19 629\nP 18 889\nP 4 498\nP 12 761\nP 25 822\nG 15\nG 15\nG 16\nP 12 306\nG 2\nG 12\nP 22 96\nG 19\nG 20\nG 13\nP 5 765\nG 16\nG 14\nG 14\nG 3\nG 3\nP 26 982\nG 7\nG 9\nG 10\nP 22 617\n",
              output:
                "-1\n-1\n-1\n-1\n-1\n540\n-1\n770\n-1\n-1\n-1\n-1\n-1\n199\n-1\n243\n-1\n-1\n-1\n728\n608\n-1\n-1\n375\n-1\n-1\n-1\n375\n-1\n-1\n393\n-1\n212\n195\n393\n320\n-1\n320\n-1\n-1\n-1\n-1\n320\n-1\n142\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n290\n-1\n-1\n-1\n950\n-1\n-1\n-1\n-1\n4\n351\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n604\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n746\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n581\n-1\n-1\n-1\n-1\n-1\n306\n629\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n",
            },
            {
              input:
                "3 600\nP 1 758\nP 6 579\nG 8\nP 12 484\nP 2 556\nG 1\nG 3\nP 4 946\nG 0\nP 13 961\nP 1 345\nP 4 603\nG 9\nG 7\nP 8 255\nG 0\nG 8\nG 4\nP 11 999\nP 15 999\nG 4\nP 5 187\nP 12 969\nG 7\nG 2\nP 0 138\nP 5 668\nG 0\nP 0 731\nP 0 259\nP 6 874\nG 5\nP 1 512\nG 4\nP 2 420\nP 4 461\nP 11 890\nP 10 932\nP 14 541\nG 9\nP 13 468\nG 5\nP 15 87\nG 8\nP 4 941\nG 10\nG 10\nG 7\nG 14\nP 8 832\nP 8 686\nP 9 564\nP 10 545\nP 0 664\nG 2\nG 8\nP 13 996\nG 6\nP 1 167\nG 8\nP 5 125\nG 5\nG 15\nP 8 371\nG 5\nG 13\nP 10 797\nP 13 48\nP 7 802\nG 10\nP 7 838\nP 2 783\nP 9 767\nP 14 904\nG 4\nG 4\nP 7 979\nP 3 116\nP 3 582\nP 13 960\nP 2 468\nP 4 777\nG 12\nP 10 682\nP 8 641\nP 15 75\nP 0 835\nP 3 116\nG 4\nP 6 81\nP 8 639\nG 9\nG 13\nP 5 364\nP 15 919\nP 4 372\nP 11 331\nP 9 160\nG 6\nG 11\nG 12\nG 1\nG 8\nG 12\nP 13 902\nG 4\nP 6 490\nG 3\nP 13 317\nG 2\nG 5\nP 1 359\nG 6\nP 12 620\nP 15 76\nG 9\nG 5\nG 14\nP 6 323\nP 12 661\nP 8 153\nP 8 51\nG 0\nG 13\nP 10 18\nG 0\nP 3 682\nP 15 81\nP 2 440\nG 14\nP 5 575\nP 6 343\nG 6\nP 13 688\nG 7\nG 11\nG 0\nG 15\nP 1 384\nP 8 819\nP 0 7\nG 2\nG 2\nG 4\nP 8 697\nP 15 519\nG 9\nP 15 361\nG 11\nG 5\nG 2\nG 10\nG 1\nP 8 275\nG 3\nG 14\nG 2\nP 7 153\nG 0\nP 2 989\nG 9\nG 4\nP 9 747\nP 12 465\nG 3\nP 9 175\nP 3 744\nP 3 949\nP 6 61\nP 0 520\nP 10 311\nG 11\nP 4 84\nG 9\nG 3\nP 2 244\nG 8\nG 4\nP 11 856\nG 2\nP 5 717\nP 5 551\nG 11\nG 6\nG 1\nP 11 744\nG 8\nP 13 493\nG 7\nP 0 697\nG 8\nP 4 386\nP 11 576\nG 5\nG 7\nP 6 159\nP 7 530\nG 15\nG 5\nP 10 119\nG 6\nG 5\nP 15 590\nP 14 982\nP 4 830\nP 5 433\nP 15 226\nG 5\nG 0\nG 6\nG 10\nP 6 588\nG 4\nP 15 837\nG 14\nP 11 672\nG 0\nP 8 76\nP 12 620\nP 9 886\nG 5\nP 14 870\nP 8 239\nG 11\nG 9\nP 2 132\nG 1\nP 7 174\nP 12 258\nG 7\nG 0\nP 5 799\nP 6 715\nG 13\nP 6 224\nP 12 100\nP 10 623\nP 11 349\nG 8\nG 5\nP 13 965\nP 1 24\nP 4 843\nP 1 172\nG 10\nG 5\nG 8\nP 10 406\nG 2\nG 8\nG 13\nG 15\nG 15\nG 11\nP 13 743\nP 5 607\nP 10 624\nG 12\nG 6\nG 7\nG 0\nP 2 783\nP 8 43\nP 12 998\nG 0\nG 6\nP 10 989\nP 6 650\nP 13 76\nP 7 448\nG 12\nP 9 56\nP 15 365\nP 8 713\nG 3\nP 5 244\nG 12\nG 1\nG 6\nG 6\nG 11\nP 10 91\nP 10 713\nP 1 177\nG 5\nP 14 811\nP 7 532\nP 4 130\nP 6 151\nP 1 883\nG 13\nP 7 304\nP 2 355\nP 12 569\nP 4 361\nG 1\nG 6\nP 8 904\nP 9 104\nG 11\nG 0\nP 3 901\nG 8\nP 13 431\nP 14 437\nP 4 293\nP 10 805\nG 8\nP 1 232\nP 8 918\nP 7 45\nG 6\nP 8 92\nP 13 132\nP 4 270\nG 8\nP 13 685\nG 0\nG 13\nP 15 43\nG 6\nP 12 671\nG 3\nG 2\nG 10\nP 12 716\nG 11\nP 15 384\nP 14 635\nP 11 294\nP 6 821\nP 11 818\nG 2\nP 5 22\nP 13 392\nG 3\nP 5 90\nG 1\nG 14\nG 14\nP 12 600\nG 7\nP 11 999\nP 2 99\nP 3 512\nG 7\nP 15 273\nG 9\nP 4 776\nG 14\nP 4 493\nG 5\nP 10 913\nG 8\nP 1 955\nG 5\nG 15\nP 8 643\nP 2 360\nG 10\nP 15 893\nP 1 884\nP 12 676\nG 1\nG 1\nP 3 294\nP 9 67\nP 5 273\nP 0 841\nP 12 185\nG 1\nG 8\nP 3 560\nG 14\nP 10 951\nP 13 985\nG 8\nP 7 965\nG 14\nP 11 394\nG 0\nP 7 331\nG 1\nP 7 337\nP 6 911\nP 10 599\nG 7\nP 7 993\nP 13 744\nP 1 399\nG 7\nP 11 288\nG 5\nP 10 750\nP 15 997\nG 5\nP 11 264\nG 4\nP 8 47\nG 2\nG 8\nP 13 435\nP 4 689\nP 0 156\nG 0\nG 15\nG 11\nP 9 281\nP 4 105\nP 2 72\nP 1 358\nP 0 163\nG 7\nP 14 42\nG 5\nP 3 181\nG 4\nG 5\nP 9 397\nG 7\nP 8 137\nG 2\nP 12 638\nP 0 118\nG 15\nP 1 935\nP 1 52\nP 5 545\nP 14 740\nP 14 832\nP 14 141\nP 14 933\nG 7\nP 6 348\nP 4 350\nP 11 211\nG 4\nG 6\nG 5\nP 15 447\nP 1 658\nP 15 62\nP 15 34\nG 12\nG 8\nP 13 527\nP 14 497\nP 0 627\nP 7 756\nG 9\nG 12\nG 13\nG 0\nP 8 132\nG 10\nP 6 194\nG 9\nP 15 101\nP 12 47\nP 12 922\nP 3 650\nP 7 672\nP 7 55\nG 14\nP 2 621\nG 12\nP 1 434\nG 5\nP 11 484\nP 9 602\nG 11\nP 11 480\nP 4 850\nG 5\nP 6 761\nG 15\nP 7 779\nG 2\nG 0\nP 2 385\nP 12 634\nP 2 809\nG 3\nG 4\nP 3 677\nG 7\nP 7 928\nG 0\nP 1 30\nP 11 531\nP 7 509\nP 10 134\nP 2 160\nP 6 917\nG 3\nP 13 192\nP 5 841\nG 4\nP 13 394\nP 1 844\nG 13\nP 12 527\nP 6 302\nG 6\nP 1 485\nP 15 67\nG 15\nG 8\nG 6\nP 9 951\nG 3\nP 1 821\nP 3 128\nG 5\nG 0\nG 1\nP 11 955\nG 5\nP 3 193\nG 8\nG 5\nG 7\nG 3\nP 14 758\nG 2\nG 6\nP 13 572\nP 13 485\nP 3 5\nG 12\nG 1\nG 3\nP 0 986\nP 11 282\nP 9 27\nP 14 436\nG 7\nP 4 279\nP 11 584\nP 3 988\nG 4\nG 7\nP 4 920\nG 10\nP 11 486\nP 9 430\nP 5 461\nP 14 163\nP 10 641\nP 15 338\nP 13 901\nP 12 334\nG 11\nP 2 953\nP 14 635\nP 7 776\nG 9\nP 1 430\nP 13 454\nP 6 353\nG 1\nP 11 2\nP 4 684\nP 6 714\nG 2\nP 10 922\nP 13 29\nG 6\nP 6 228\nP 0 26\nG 7\nG 11\nP 9 497\nG 15\nP 10 813\nP 3 569\nP 0 579\nP 12 964\nP 8 436\nP 11 634\nG 4\nG 8\nP 6 45\nG 2\nP 15 555\nP 9 344\nG 14\nG 15\nG 15\nG 8\nG 5\nP 6 879\nG 10\nG 2\nP 15 713\nG 15\nG 7\nG 5\nP 0 865\nP 8 485\n",
              output:
                "-1\n-1\n-1\n-1\n-1\n-1\n-1\n255\n603\n603\n-1\n-1\n138\n668\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n125\n-1\n125\n-1\n797\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n331\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n490\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n343\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n84\n244\n856\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n159\n-1\n433\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n886\n-1\n174\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n244\n-1\n-1\n-1\n-1\n-1\n904\n-1\n-1\n92\n-1\n685\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n884\n884\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n337\n993\n-1\n-1\n-1\n-1\n47\n156\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n350\n348\n-1\n-1\n-1\n-1\n-1\n-1\n627\n-1\n-1\n-1\n-1\n-1\n484\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n-1\n394\n302\n67\n-1\n302\n-1\n-1\n-1\n821\n-1\n-1\n-1\n-1\n193\n-1\n-1\n-1\n-1\n5\n-1\n279\n-1\n-1\n-1\n-1\n430\n-1\n714\n-1\n-1\n-1\n-1\n436\n-1\n-1\n555\n555\n-1\n-1\n-1\n-1\n713\n-1\n-1\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_mf-running-median",
      title: "Running Median (Multi-File)",
      type: "multi_file" as const,
      tags: ["medium", "Heap", "Design"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "這是一題多檔實作題。可執行的進入點是 `main.py`：它從標準輸入讀入 $N$ 個整數，依序對每個數呼叫你實作的 `MedianStream.add(x)`，接著呼叫 `median()` 並印出目前的中位數。\n\n`main.py` 會 `import` 唯讀的 `iolib.py`（提供 `read_numbers()` 解析 stdin）；`main()` 已經寫好，你只需在 `main.py` 裡實作 `MedianStream` 這個 class。\n\n`median()` 回傳**下中位數**：已加入 $k$ 個數時，即由小到大第 $\\lceil k/2 \\rceil$ 個（重複的數分開計）。例如目前的數是 `1 2 8 9` 時回傳 $2$。經典解法是同時維護一個 max-heap 與一個 min-heap，但本題規模刻意訂小，任何正確的做法（例如每步重新排序）都能在時限內通過。",
        inputFormat:
          "第一行一個整數 $N$（$1 \\le N \\le 5000$）。\n\n第二行 $N$ 個整數 $x_1, \\dots, x_N$（$-10^9 \\le x_i \\le 10^9$，可能重複）。",
        outputFormat: "輸出 $N$ 行：第 $i$ 行是加入 $x_1, \\dots, x_i$ 之後的下中位數。",
      },
      samples: [{ input: "5\n1 9 2 8 3\n", output: "1\n1\n2\n2\n3\n" }],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content:
            'from iolib import read_numbers\n\nclass MedianStream:\n    """Maintain a growing multiset of integers. add(x) inserts x; median()\n    returns the lower median: with k numbers added so far, the ceil(k/2)-th\n    smallest (duplicates counted separately)."""\n\n    def __init__(self) -> None:\n        # implement the data structure here\n        pass\n\n    def add(self, x: int) -> None:\n        # implement add here\n        pass\n\n    def median(self) -> int:\n        # implement median here\n        return 0\n\ndef main() -> None:\n    stream = MedianStream()\n    out = []\n    for x in read_numbers():\n        stream.add(x)\n        out.append(str(stream.median()))\n    print("\\n".join(out))\n\nif __name__ == "__main__":\n    main()\n',
          visibility: "editable",
          description:
            "The runnable entry. main() feeds each number via MedianStream.add and prints median() after every insertion. Implement the MedianStream class here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "iolib.py",
          content:
            '"""Read-only I/O helper for the running median problem.\n\nDo NOT modify. main.py imports read_numbers to turn the stdin stream\ninto the list of N integers that arrive in order.\n"""\n\nimport sys\nfrom typing import List\n\n\ndef read_numbers() -> List[int]:\n    """Return the N stream integers from stdin (empty list on bad count)."""\n    data = sys.stdin.read().split()\n    if not data:\n        return []\n    n = int(data[0])\n    return [int(tok) for tok in data[1 : 1 + n]]\n',
          visibility: "readonly",
          description:
            "Read-only stdin helper. Provides read_numbers(), which main.py imports to get the stream values. You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "Mixed insertions where the median moves, and a single-element stream.",
          cases: [
            { input: "5\n1 9 2 8 3\n", output: "1\n1\n2\n2\n3\n" },
            { input: "1\n-5\n", output: "-5\n" },
          ],
        },
        hidden: {
          description:
            "All-equal values, strictly decreasing input, duplicate-heavy even steps, and 1e9 extremes.",
          weight: 40,
          cases: [
            { input: "6\n4 4 4 4 4 4\n", output: "4\n4\n4\n4\n4\n4\n" },
            { input: "7\n10 8 6 4 2 0 -2\n", output: "10\n8\n8\n6\n6\n4\n4\n" },
            { input: "8\n5 5 1 1 9 9 5 1\n", output: "5\n5\n5\n1\n5\n5\n5\n5\n" },
            {
              input: "4\n1000000000 -1000000000 -1000000000 1000000000\n",
              output: "1000000000\n-1000000000\n-1000000000\n-1000000000\n",
            },
          ],
        },
        hidden2: {
          description: "Random streams of 250-500 values with many duplicates.",
          weight: 60,
          cases: [
            {
              input:
                "250\n4824 8343 5259 4806 6641 9248 -3777 -3949 6775 5590 -3899 -6915 4634 -58 -5353 -7028 7652 -8627 9512 2982 4844 -4839 -9508 7314 -7930 -8048 -8831 -3767 -2072 9649 -9014 5203 692 4436 9365 -3599 7011 -2343 -361 6377 -9849 -7215 4986 -885 3330 8064 -7273 -1677 332 -2474 6807 -528 -9025 -7698 8454 -6463 3121 -6467 -467 2666 -7810 -9446 -9982 -3003 -3127 -8285 5401 2304 3023 3756 -7606 8555 -3495 -1159 1040 -7144 198 899 -9503 3437 -6133 -5589 -1926 -6688 -9641 -8037 5236 5953 -4177 8327 -3826 4662 6675 -3751 -5708 3738 2575 -6182 2939 3788 -3024 -9984 -1159 9423 -33 -9356 -3095 -3862 2920 9727 8906 -6712 -8620 -5204 -3012 4469 -1536 -9686 780 -290 2655 -7594 -7565 -7047 -3160 9096 -2036 -9491 9703 2081 2180 4851 -5831 9244 5851 8828 -5552 2652 -4009 -4949 185 -2516 -1824 -3780 -4807 8152 -3558 2721 5812 9777 -7427 3811 -8446 -6597 -6426 -8731 6789 -1638 -2187 2833 -1579 3790 9546 6090 -384 7042 -4251 -7746 -5858 -2515 5706 8330 -7570 -817 -3040 -3316 -9456 -7733 -1179 3482 4605 -1838 -8018 -8473 -4224 -760 2085 7400 8749 -5688 -6979 1867 -5464 4757 846 7103 9151 -5401 9330 -8850 -9413 5559 1714 218 -8900 -9303 9608 -7547 5802 -7795 193 450 -5523 -7626 -7533 4847 7895 2052 -8542 -5755 1195 1529 -7217 5509 -7454 3670 -9008 6382 8770 -9523 2529 2425 9094 -9592 9952 -7632 -7371 -7029 -6212 -1571 3640 819 2729 9037 5000 4436 5160 7736 -7254 6997\n",
              output:
                "4824\n4824\n5259\n4824\n5259\n5259\n5259\n4824\n5259\n5259\n5259\n4824\n4824\n4806\n4806\n4634\n4806\n4634\n4806\n4634\n4806\n4634\n4634\n4634\n4634\n2982\n2982\n-58\n-58\n-58\n-58\n-58\n692\n692\n2982\n692\n2982\n692\n692\n692\n692\n-58\n692\n-58\n692\n692\n692\n-58\n332\n-58\n332\n-58\n-58\n-361\n-58\n-361\n-58\n-361\n-361\n-361\n-361\n-467\n-467\n-528\n-528\n-885\n-528\n-528\n-467\n-467\n-467\n-467\n-467\n-528\n-467\n-528\n-467\n-467\n-467\n-467\n-467\n-528\n-528\n-885\n-885\n-1159\n-885\n-885\n-885\n-885\n-885\n-885\n-528\n-885\n-885\n-885\n-528\n-885\n-528\n-528\n-528\n-885\n-885\n-885\n-528\n-885\n-885\n-1159\n-885\n-885\n-528\n-885\n-885\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-885\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1536\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-885\n-885\n-885\n-885\n-885\n-1159\n-885\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1536\n-1159\n-1536\n-1536\n-1536\n-1536\n-1536\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1536\n-1159\n-1159\n-1159\n-1159\n-1159\n-1536\n-1536\n-1579\n-1536\n-1536\n-1179\n-1536\n-1536\n-1579\n-1579\n-1579\n-1536\n-1536\n-1179\n-1536\n-1536\n-1536\n-1536\n-1536\n-1179\n-1179\n-1159\n-1179\n-1159\n-1179\n-1179\n-1179\n-1159\n-1159\n-1159\n-1179\n-1159\n-1179\n-1159\n-1179\n-1159\n-1159\n-1159\n-1179\n-1179\n-1179\n-1159\n-1159\n-1159\n-1179\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-1159\n-885\n-1159\n-885\n-1159\n-1159\n-1159\n-1159\n-1179\n-1159\n-1159\n-1159\n-1159\n-885\n-885\n-817\n-817\n-817\n-817\n",
            },
            {
              input:
                "300\n-5400 -2049 -9226 4652 -3962 -6048 1327 -7389 -2406 -1176 -8372 468 9699 -4130 8088 4091 -8412 8912 -9301 9319 -1350 181 3813 -3769 -4084 -6344 9098 7395 8557 -7995 697 972 -1532 -3955 2884 240 6886 -5339 -840 -1132 -3936 4153 -8390 1221 7427 -8942 3743 -1756 6590 -684 6952 3417 3018 -3942 70 8458 2248 3016 9091 -9174 -257 8860 9518 8393 7797 7274 4205 7310 4004 -7112 -7032 4541 1656 -6770 4148 3200 -8097 -3546 6778 -2176 3129 -9778 -6835 5040 -3661 -4383 -9011 7912 2330 1441 -4139 758 1705 -3732 4536 -8788 -7941 7546 -5589 -3397 -6690 -8293 -3608 3460 -6002 -5164 9238 5093 -8583 -6065 6336 7169 -5557 9155 -687 5501 5604 -7841 1593 -6370 9937 -1517 -6084 -9403 -3877 6385 1477 -7901 1160 -6813 -4384 9559 4235 -1185 -4189 -8628 -7495 -3755 1544 -6130 -2910 7512 -1645 5947 -7770 -4080 -9235 -944 -6809 9036 5400 -3193 3198 1277 -6148 7196 -4088 -8745 -2211 2379 -8919 -3276 -3341 6057 2532 -8389 3743 5220 -1681 -1840 -2439 -6311 -1274 -7863 8550 -4829 -4156 448 -8139 -9017 6344 -4810 9781 -824 -8615 5950 -9022 -920 -9866 -2943 4843 -2354 4518 7517 4084 -5417 1639 1217 -1512 -9701 2448 9935 -6486 -4249 8069 1865 -862 6805 -1378 -3828 -1504 -898 7217 -4785 1401 6708 6246 6380 -5550 7661 -3757 6356 3295 1249 -7457 2673 7249 -3610 -4699 -7192 -8341 2443 1085 -2268 -8220 6964 7185 -4990 -3549 8275 1863 9609 -9979 7276 520 -9284 -6283 6605 -8314 -7865 -6769 8694 -7817 -4155 -1556 6541 -66 244 3500 8842 7223 7991 892 559 -8287 -2321 6776 530 -779 -9888 -2185 -2054 -8120 -6136 310 -223 -9217 358 -6305 -6619 4587 887 -4249 -4763 5623 -677 3594 2914 1602 -5419 3224 53 -2306 7736 -2549 2280 -8673 5214 -826 6848\n",
              output:
                "-5400\n-5400\n-5400\n-5400\n-3962\n-5400\n-3962\n-5400\n-3962\n-3962\n-3962\n-3962\n-2406\n-3962\n-2406\n-2406\n-2406\n-2406\n-2406\n-2406\n-2049\n-2049\n-1350\n-2049\n-2049\n-2406\n-2049\n-2049\n-1350\n-2049\n-1350\n-1350\n-1350\n-1532\n-1350\n-1350\n-1176\n-1350\n-1176\n-1176\n-1176\n-1176\n-1176\n-1176\n-1132\n-1176\n-1132\n-1176\n-1132\n-1132\n-840\n-840\n-684\n-840\n-684\n-684\n70\n70\n181\n70\n70\n70\n181\n181\n240\n240\n468\n468\n697\n468\n468\n468\n697\n468\n697\n697\n697\n468\n697\n468\n697\n468\n468\n468\n468\n240\n240\n240\n468\n468\n468\n468\n697\n468\n697\n468\n468\n468\n468\n240\n240\n181\n181\n181\n181\n70\n181\n181\n181\n70\n181\n181\n181\n181\n181\n181\n240\n181\n240\n181\n240\n181\n181\n70\n70\n70\n181\n70\n181\n70\n70\n70\n181\n70\n70\n-257\n-257\n-684\n-257\n-684\n-684\n-684\n-684\n-684\n-684\n-687\n-687\n-840\n-840\n-840\n-687\n-840\n-687\n-687\n-687\n-687\n-687\n-840\n-840\n-840\n-840\n-944\n-944\n-944\n-840\n-944\n-840\n-840\n-840\n-944\n-944\n-1132\n-1132\n-1176\n-1132\n-1176\n-1176\n-1176\n-1176\n-1185\n-1176\n-1185\n-1176\n-1176\n-1176\n-1176\n-1176\n-1176\n-1176\n-1185\n-1176\n-1185\n-1176\n-1176\n-1132\n-1176\n-1132\n-1132\n-1132\n-1176\n-1132\n-1132\n-1132\n-1176\n-1132\n-1132\n-944\n-944\n-944\n-1132\n-1132\n-1132\n-944\n-1132\n-944\n-944\n-920\n-920\n-920\n-920\n-920\n-920\n-898\n-898\n-898\n-898\n-862\n-898\n-898\n-920\n-920\n-920\n-898\n-920\n-920\n-920\n-898\n-920\n-920\n-920\n-898\n-898\n-898\n-898\n-862\n-898\n-898\n-898\n-898\n-920\n-920\n-920\n-920\n-944\n-944\n-944\n-920\n-920\n-898\n-898\n-862\n-862\n-840\n-840\n-840\n-862\n-840\n-840\n-824\n-840\n-840\n-862\n-862\n-898\n-862\n-862\n-862\n-862\n-862\n-898\n-862\n-862\n-862\n-898\n-862\n-862\n-840\n-840\n-824\n-840\n-824\n-824\n-824\n-824\n-824\n-824\n-824\n-824\n-824\n-824\n",
            },
            {
              input:
                "500\n169 -657 295 -522 674 722 -432 -19 336 803 825 91 862 81 -618 335 854 264 933 31 -342 979 408 82 -14 -88 -422 933 379 302 -855 -382 -152 -366 62 17 841 -892 522 245 761 508 387 -127 670 734 -425 901 -345 138 567 396 -496 -759 771 -885 -346 818 -417 -563 837 -864 536 -250 -747 339 -341 577 -502 51 -441 -344 -986 -275 75 349 -376 137 -192 -203 -620 408 -774 801 -932 -253 788 285 531 399 147 746 -746 -870 -694 -808 -754 656 -351 -993 -882 -160 -435 -286 -584 776 -605 387 339 -204 -62 225 -30 618 -266 208 104 -69 609 764 -369 -4 -856 -980 -14 -222 -223 553 599 -259 -772 368 788 -500 -969 919 111 300 -91 481 -354 788 821 728 438 768 -665 864 14 494 254 -10 -931 415 -820 814 233 906 495 -423 -52 -427 -135 940 39 -167 -466 -32 796 275 970 552 -13 -205 -957 555 -186 -349 645 960 -334 -656 -783 963 -620 874 458 -345 274 951 -413 859 278 -646 558 484 979 -275 703 -123 -111 907 658 -314 896 324 780 -245 537 765 202 346 48 -928 742 530 281 836 478 -973 -533 -15 -811 633 -446 737 195 -839 174 -759 -593 766 -613 -592 946 248 -853 -867 898 393 582 -977 175 -109 82 393 -239 -986 759 924 -681 -153 -952 878 -817 667 751 -717 -64 -918 599 -957 205 599 -570 621 140 -533 385 -769 -314 -249 -818 638 829 518 23 776 -366 983 -936 546 376 712 837 -966 650 -986 20 767 -405 268 -326 -330 75 -737 473 -319 -799 -305 -207 16 540 -78 -444 -585 777 -831 82 -584 717 -737 -470 -794 -644 -151 85 -733 -718 639 -14 116 -50 -57 -336 310 512 -518 -985 -952 -951 -838 -694 -309 -618 -260 508 -482 -513 -372 259 708 671 -982 16 -80 228 -215 173 -422 961 485 -448 -540 562 -913 -414 -673 -193 -944 -291 -830 -760 682 989 -615 321 941 959 -214 -321 -507 659 -221 -915 746 -513 378 628 -735 57 -671 617 876 -209 263 795 540 -841 732 277 20 -613 597 -591 789 809 677 -119 757 665 451 -418 -422 496 -212 859 -362 284 -109 -519 204 369 448 948 -224 641 -70 -90 308 -181 976 -798 -244 574 -97 -675 -426 -552 690 -932 -787 -664 -617 -214 -325 -23 867 -641 709 -130 -730 553 -515 -801 633 -722 939 70 -151 852 -699 880 877 166 26 -812 628 790 -184 -807 842 158 88 -94 -216 -992 203 -802 619 980 -95 11 -567 38 746 -363 -631 107 114 -113 -420 222 -61 884 875 388 -516 -151 -480 -971 -376 -653 759 -9 -378 983 694 -970 903\n",
              output:
                "169\n-657\n169\n-522\n169\n169\n169\n-19\n169\n169\n295\n169\n295\n169\n169\n169\n295\n264\n295\n264\n264\n264\n295\n264\n264\n169\n169\n169\n264\n264\n264\n169\n169\n91\n91\n82\n91\n82\n91\n91\n169\n169\n245\n169\n245\n245\n245\n245\n245\n169\n245\n245\n245\n169\n245\n169\n169\n169\n169\n138\n169\n138\n169\n138\n138\n138\n138\n138\n138\n91\n91\n82\n82\n81\n81\n81\n81\n81\n81\n75\n75\n75\n75\n75\n75\n62\n75\n75\n81\n81\n82\n82\n82\n81\n81\n75\n75\n75\n75\n62\n62\n51\n51\n31\n31\n31\n31\n31\n51\n31\n31\n31\n31\n31\n31\n31\n51\n31\n51\n51\n51\n31\n31\n17\n17\n-4\n-4\n-4\n17\n-4\n-4\n-4\n17\n-4\n-4\n-4\n17\n17\n17\n17\n17\n17\n31\n31\n51\n51\n51\n51\n51\n51\n62\n51\n51\n51\n51\n51\n62\n62\n75\n62\n62\n51\n51\n51\n51\n39\n39\n31\n39\n39\n51\n51\n51\n39\n39\n39\n39\n31\n39\n39\n39\n31\n31\n31\n31\n31\n39\n31\n39\n39\n39\n39\n51\n39\n51\n51\n62\n51\n62\n51\n51\n51\n62\n51\n62\n62\n75\n62\n75\n75\n81\n81\n81\n75\n81\n81\n82\n82\n91\n82\n82\n81\n81\n81\n81\n81\n82\n81\n82\n81\n81\n81\n81\n75\n81\n81\n81\n75\n81\n81\n82\n81\n82\n81\n82\n82\n82\n81\n82\n82\n82\n81\n81\n81\n81\n81\n82\n81\n81\n75\n81\n75\n81\n81\n81\n81\n82\n81\n82\n81\n81\n75\n75\n75\n81\n81\n81\n81\n81\n81\n81\n81\n82\n82\n82\n82\n82\n82\n82\n82\n82\n82\n82\n81\n81\n75\n81\n75\n75\n75\n75\n62\n75\n62\n62\n51\n62\n51\n62\n51\n62\n51\n51\n48\n48\n39\n48\n39\n39\n39\n39\n39\n39\n31\n31\n31\n39\n31\n31\n23\n23\n20\n20\n17\n17\n16\n17\n16\n16\n14\n16\n16\n17\n16\n16\n16\n16\n16\n16\n16\n16\n16\n16\n16\n16\n16\n16\n14\n14\n-4\n-4\n-10\n-10\n-10\n-4\n-10\n-4\n-4\n14\n-4\n-4\n-10\n-4\n-10\n-10\n-10\n-10\n-10\n-4\n-10\n-4\n-10\n-4\n-4\n-4\n-4\n14\n14\n14\n14\n16\n16\n16\n16\n16\n16\n16\n16\n16\n16\n17\n17\n17\n16\n17\n16\n17\n16\n17\n16\n16\n16\n17\n17\n20\n17\n20\n17\n17\n17\n17\n17\n17\n16\n17\n16\n16\n16\n16\n16\n16\n14\n14\n-4\n-4\n-10\n-10\n-10\n-10\n-10\n-10\n-13\n-10\n-13\n-13\n-13\n-13\n-13\n-10\n-13\n-10\n-13\n-10\n-10\n-4\n-4\n-4\n-4\n14\n-4\n-4\n-4\n14\n14\n14\n-4\n-4\n-4\n-4\n-4\n14\n-4\n11\n-4\n11\n11\n11\n-4\n11\n11\n11\n-4\n11\n-4\n11\n11\n14\n11\n11\n-4\n-4\n-10\n-10\n-10\n-9\n-10\n-9\n-9\n-9\n-9\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_mf-any-peak",
      title: "Any Peak Index (Multi-File Checker)",
      type: "multi_file" as const,
      tags: ["medium", "Array", "Binary Search"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      judgeConfig: {
        type: "checker",
        checkerLanguage: "python",
        checkerScript:
          'data = judge_input.split()\nn = int(data[0])\narr = [int(t) for t in data[1 : 1 + n]]\ntokens = team_output.split()\nif not tokens:\n    wrong("empty output")\ntry:\n    i = int(tokens[0])\nexcept ValueError:\n    wrong("first token is not an integer")\nif i < 1 or i > n:\n    wrong(f"index {i} is out of range 1..{n}")\nif i > 1 and arr[i - 1] <= arr[i - 2]:\n    wrong(f"a[{i}] is not strictly greater than its left neighbour")\nif i < n and arr[i - 1] <= arr[i]:\n    wrong(f"a[{i}] is not strictly greater than its right neighbour")\naccept()\n',
      },
      statement: {
        body: "這是一題多檔實作題，也是互動題「Peak Hunt」的離線版。可執行的進入點是 `main.py`：它從標準輸入讀入一個陣列，呼叫你實作的 `find_peak(arr)` 並印出回傳值。\n\n`main.py` 會 `import` 唯讀的 `iolib.py`（提供 `read_array()` 解析 stdin）；`main()` 已經寫好，你只需在 `main.py` 裡實作 `find_peak`。\n\n`find_peak(arr)` 要回傳任意一個 **peak** 的 1-based 索引 $i$：$a_i$ 嚴格大於它實際存在的鄰居（$a_0$ 與 $a_{N+1}$ 視為負無窮大）。保證相鄰元素兩兩不相等，因此 peak 必定存在。答案可能不唯一，由 special judge 驗證，輸出任何一個合法的 peak 都算對。線性掃描即可在時限內通過；沿斜率二分是進階的提示，不是必要條件。",
        inputFormat:
          "第一行一個整數 $N$（$1 \\le N \\le 5000$）。\n\n第二行 $N$ 個整數 $a_1, \\dots, a_N$（$-10^9 \\le a_i \\le 10^9$），保證 $a_i \\ne a_{i+1}$。",
        outputFormat:
          "輸出一行一個整數：任意一個 peak 的 1-based 索引。答案不唯一時輸出任何一個皆可。",
      },
      samples: [{ input: "5\n1 3 2 5 4\n", output: "2\n" }],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content:
            'from typing import List\n\nfrom iolib import read_array\n\ndef find_peak(arr: List[int]) -> int:\n    """Return any 1-based index i whose value is strictly greater than both of\n    its existing neighbours (positions outside the array count as minus\n    infinity). Adjacent elements are guaranteed distinct, so a peak exists."""\n    # implement find_peak here\n    return 1\n\ndef main() -> None:\n    arr = read_array()\n    print(find_peak(arr))\n\nif __name__ == "__main__":\n    main()\n',
          visibility: "editable",
          description:
            "The runnable entry. main() reads the array via iolib.read_array and prints the find_peak result. Implement find_peak here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "iolib.py",
          content:
            '"""Read-only I/O helper for the peak finding problem.\n\nDo NOT modify. main.py imports read_array to turn the stdin stream\ninto the list of N integers.\n"""\n\nimport sys\nfrom typing import List\n\n\ndef read_array() -> List[int]:\n    """Return the N array values from stdin (empty list on bad count)."""\n    data = sys.stdin.read().split()\n    if not data:\n        return []\n    n = int(data[0])\n    return [int(tok) for tok in data[1 : 1 + n]]\n',
          visibility: "readonly",
          description:
            "Read-only stdin helper. Provides read_array(), which main.py imports to get the array. You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "Two interior peaks to choose from, and a single-element array.",
          cases: [
            { input: "5\n1 3 2 5 4\n", output: "PEAK" },
            { input: "1\n7\n", output: "PEAK" },
          ],
        },
        hidden: {
          description:
            "Strictly increasing, strictly decreasing, zigzag, mountain, and 1e9 extremes.",
          weight: 40,
          cases: [
            { input: "6\n1 2 3 4 5 6\n", output: "PEAK" },
            { input: "6\n9 7 5 3 1 -1\n", output: "PEAK" },
            { input: "9\n1 5 2 6 3 7 4 8 0\n", output: "PEAK" },
            { input: "7\n1 4 6 9 5 3 2\n", output: "PEAK" },
            { input: "2\n-1000000000 1000000000\n", output: "PEAK" },
          ],
        },
        hidden2: {
          description:
            "Long random adjacent-distinct arrays with many valid peaks; neither endpoint is a peak.",
          weight: 60,
          cases: [
            {
              input:
                "600\n-3 -1 0 2 -1 3 5 0 -5 1 4 1 4 3 5 -4 0 3 2 -2 -4 -5 -1 -3 -2 -4 1 3 -1 -5 1 -1 -2 0 -3 3 -4 1 4 1 0 -1 -5 -3 4 5 0 1 5 -5 3 4 0 4 -1 5 -4 0 1 3 4 -4 3 2 -4 5 1 0 -1 2 -2 3 -3 5 2 3 5 -4 -1 3 1 -5 -3 0 -1 -5 -1 -4 2 -4 2 -2 -4 3 1 -3 -4 -5 5 3 -1 -5 2 0 -5 2 3 -3 -4 2 -5 2 3 -2 5 3 1 -4 3 2 -2 -4 5 -3 5 1 3 0 -3 4 -2 5 -5 -3 3 1 2 -3 -5 2 -5 -3 3 1 -1 0 1 3 -4 -3 0 -2 2 0 -3 -1 1 -4 -1 1 -5 5 -3 -5 5 -2 -4 3 -2 5 -2 2 -2 0 3 -1 -4 4 -4 0 3 -1 4 -4 -5 -3 1 3 1 2 -3 3 4 0 5 -1 0 5 -4 -5 2 -1 -2 0 -1 -4 -2 2 1 -2 -1 0 -1 -4 5 -4 0 -2 -4 4 2 4 -3 4 3 -3 5 -1 5 0 -2 -5 2 -2 5 2 4 0 -2 0 1 4 1 -4 4 -4 -1 2 3 4 2 3 -3 -2 0 5 1 -4 -1 1 2 -1 3 -4 -5 -4 2 -3 0 5 -1 5 -2 -4 -1 0 -4 -5 -1 2 -2 -1 4 5 -3 3 5 0 -4 -1 2 0 2 3 5 -3 -2 -4 3 2 1 4 2 3 -4 1 5 -1 0 4 1 3 4 2 5 0 -2 0 -5 3 -2 5 2 4 0 -5 3 4 0 2 4 -3 -4 3 -1 3 -1 4 -5 -3 5 2 -2 -3 5 4 5 -3 5 4 -1 -2 4 -1 -5 0 2 3 0 -5 -4 2 -1 3 -2 1 3 4 -3 2 0 3 -5 5 -4 -2 3 -3 5 -1 -2 0 2 3 -2 2 0 1 -1 -4 4 2 -4 4 -5 -3 3 -4 -2 -3 -5 2 0 3 4 -1 -3 4 2 0 -5 -1 -3 -4 -3 -4 2 5 0 -2 2 4 5 -2 3 -5 1 -1 4 -5 1 -4 -3 4 5 -3 3 -2 -4 -5 0 -1 2 -5 1 5 -5 -2 -5 -2 1 5 -5 1 4 -2 -5 1 3 -1 0 -2 -1 -4 5 2 4 -1 -5 2 3 -2 -4 2 -2 -3 -4 5 -5 3 -2 5 -1 5 2 4 1 -3 2 -4 -5 -4 3 -2 3 -4 -1 0 4 -5 2 -3 -4 1 0 2 5 -5 -2 2 1 -5 -3 -5 3 5 4 -3 -4 2 1 -1 -2 0 3 -3 5 -5 1 -2 4 -1 1 -2 5 -5 -4 -2 -5 -2 3 5 -2 2 3 -5 2 -3 -1 -5 0 2 3 1 -2 4 -1 0 -5 -2 -4 -3 4 5 -5 2 0 -3 -5 -1 4 2 -2 2 -4 -1 -3 5 -3 5 -5 2 0 -3 5 -2 2 -2 3 0 -5 -4 0 4 1 -3 0 -3 5 3\n",
              output: "PEAK",
            },
            {
              input:
                "800\n-56832 -28202 -25914 -65010 -75063 -97304 21857 -28061 31871 -93654 -88064 -56131 21465 -38006 5323 -13220 24008 53131 77802 -81681 66595 22779 -90954 9446 9349 -39739 -62264 -44731 30939 75828 67664 -59699 -27517 -4158 -6414 67511 -73966 -73134 42474 -37148 -96822 -66266 -96900 84558 -52591 60717 -69820 79729 -92270 11536 15133 -6966 87287 -58161 90960 48613 -74646 94212 -15110 -43229 88533 -67583 -3020 -5882 51624 -82677 18879 93891 7993 58905 43724 14729 95290 94889 -41487 -45718 -95525 -49713 -40794 86017 -34223 17516 -62003 35513 73439 78171 49157 -39037 -56529 84921 91078 29654 60500 69436 -33583 29802 -70106 -27691 75913 -73844 91892 27221 -94700 -8923 -61456 -92104 85726 -98629 54840 -5940 91655 -94140 -77865 -86638 28192 -66176 28644 -6128 48765 42398 5420 90483 1526 -65799 -379 -5806 -69971 -71142 -18589 -36991 40825 5867 -31076 -1200 -97397 -80013 -86477 -48968 70384 67593 -6073 5529 64566 72987 -70665 2141 88226 -36748 -87105 -49415 -77489 -94792 45157 49863 -18336 79259 6472 -54617 58504 73330 28475 -95002 -78806 55830 -82291 58288 -60801 -99648 -37726 -87124 -3037 75419 86044 41985 -8521 -66336 70100 12906 -55991 66133 -98743 32740 94427 -85410 78838 62961 -69267 75872 65811 -6414 -46782 -66132 62181 15414 74619 -49185 87023 -38124 81360 96559 77908 -97323 -95848 -3975 -89181 -19543 28738 -89545 54039 73565 51323 -12788 61537 -70472 -52039 65191 99742 99414 -31300 -81042 68573 -24246 54649 -27307 -59115 91099 -30342 -63653 -23363 34071 -97183 -1917 84570 71167 26686 -53530 73255 86470 20895 -15815 -32120 47867 -64902 -34285 62533 -54369 58453 -8367 46298 87857 -71634 -58651 32705 -46775 -59779 -85 15656 -86006 -23390 -32191 75957 35302 -33550 45966 -52923 39834 91194 65786 -13087 3277 -19664 90335 12326 -70727 37841 -98813 -98663 36232 28495 22977 -86372 62714 -73109 14696 -84809 -2029 1470 93047 -31854 -80610 -18586 12573 -92465 -79073 23854 -79283 34581 -48294 -20679 -65980 36881 -20626 -54029 -94421 79467 40973 18335 64082 47136 -33067 -86018 -55403 18703 55408 -74389 88055 27034 -92911 59081 4921 92088 47099 15247 62075 84470 72088 85844 -75352 33968 -47242 -76256 -61678 30601 -81504 -27391 -25435 39583 38181 -12212 73184 47766 42416 -40654 1356 817 70350 52406 -5475 -11243 -65425 27979 -90511 84083 51963 20059 -70094 39000 -62701 -81764 73662 -21022 20579 90443 30219 -2821 -97789 46483 -63207 -3134 -56890 43152 -42551 -91996 -79754 20313 -4704 74039 -97691 74244 75515 91175 -42888 57831 82203 98011 65143 -7417 92971 -54169 -14936 -92024 -14009 68060 46827 -8978 -7561 -76174 -68993 33525 -59859 85035 -40374 -97243 9416 -5412 -25503 83445 -65866 8183 31748 -15634 16058 -83328 54401 -9196 -14784 -40495 24543 81029 -74801 1885 -6822 -58637 -38711 -79891 -31698 -98281 33564 -72764 -63494 -11168 62105 -90435 14626 -38149 -70292 -53612 -9577 96597 -95980 19196 95093 -80640 40319 -36519 -26532 -58428 35641 61598 -8232 -60534 7647 57297 46752 73708 -4862 -65775 41359 93374 -4716 97831 25112 72311 -8243 19101 87412 32407 -3216 32183 77086 87715 135 67272 -57387 -20335 4625 97598 90147 -46645 -82322 89174 -24147 31609 -41634 1301 38097 51561 4846 77777 -43412 14864 12204 97840 99911 -93829 -92915 1522 -5201 41764 20667 70933 -24683 30504 824 92798 10860 48284 -37940 85317 60900 74783 69764 -81417 -26115 -84093 62567 69085 81197 97687 39510 26335 79968 -98123 1126 42974 4698 -2784 30936 4149 -51807 -14654 -74998 -71839 3106 96684 -99558 -26528 71458 -95228 -5116 -92174 -12431 91038 63905 55268 20981 -44651 -17242 82184 74171 -27702 -71562 -50152 20530 34862 -24268 15974 64750 90441 -60427 83551 -78396 -16605 -69835 -14842 -33961 56782 -65699 -2057 33650 42264 -90263 -37173 -58267 57564 68003 12343 5261 75038 63904 20662 -65307 -87033 -98130 -76644 42369 64468 10859 -59170 -91310 743 -66427 -66110 35777 -742 74999 -16829 68890 -22247 36875 -79752 5377 24079 -58912 85435 76794 65481 32986 77142 -22758 -52834 -84341 25917 -97479 50089 -79404 -92152 -59425 -56911 27214 40404 19942 -18714 -41033 63851 -16933 -81890 -96902 -4703 4076 91409 44816 -93902 80675 84128 -63654 -40716 34415 -15697 -30428 -57570 83683 -65446 54177 12309 -93715 -7095 63461 -9854 -60818 -71414 -22553 5265 18175 -67811 -81807 -89779 -79179 -73638 -82148 5438 -90176 97110 52743 -85468 -23263 41395 -2731 13647 -11706 25774 -27592 85722 -77233 -83769 -44436 -69699 9521 58793 -84566 -73908 5485 -21929 -80606 -58170 48882 22089 76395 -22234 73430 -68273 26561 16342 40523 -92451 31947 12253 15393 -71642 -14433 11466 -59477 -85683 -6387 44313 -74368 -56337 82331 60540 -41018 30409 9642 65525 58081 -7817 3036 -47633 -7082 11353 -32161 23411 -37280 91526 -33897 46715 43727 75186 -52366 22137 -20005 75675 -19096 26921 -41836 -45271 94285 26601 -67666 37761 -22121 -40671 -13818 76674 44545 -68520 90741 -69367 -21020 91734 91974 98235 71891 75621 -43031 94550 80418 -53982 -63859 56751 -65022 -45101 -4900 -34688 28151 49033 -42430 94641 67527 -72401 -47909 18598 39737 24340 60237 -70854 21907 29617 -60623 83081 -38776 28362 -85162 -75668 -56169 78224 5060 30906 17703 36514 -72875 -14030 -19408 81325 -18941 -10218 -70252 56093 -54844 80815 -75385\n",
              output: "PEAK",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_mf-top-k-words",
      title: "Top-K Frequent Words (Multi-File)",
      type: "multi_file" as const,
      tags: ["medium", "Hash Table", "Sorting", "String"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "這是一題多檔實作題。可執行的進入點是 `main.py`：它從標準輸入讀入 $N$ 個單字與整數 $K$，呼叫你實作的 `top_k(words, k)`，並把回傳的每個 `(單字, 次數)` 逐行印出。\n\n`main.py` 會 `import` 唯讀的 `iolib.py`（提供 `read_input()` 解析 stdin）；`main()` 已經寫好，你只需在 `main.py` 裡實作 `top_k`。\n\n`top_k(words, k)` 要回傳出現次數前 $K$ 名的單字及其出現次數，依出現次數由大到小排列；次數相同時，字典序較小的單字排前面。保證 $K$ 不超過相異單字數，因此回傳的 list 恰有 $K$ 個元素。本題規模刻意訂小，重點是計數與 tie-break 規則的正確性。",
        inputFormat:
          "第一行兩個整數 $N$ 與 $K$（$1 \\le N \\le 5000$，$1 \\le K \\le$ 相異單字數）。\n\n接下來 $N$ 行，每行一個單字 $w_i$（$1 \\le |w_i| \\le 20$，僅含小寫英文字母）。",
        outputFormat: "輸出 $K$ 行：第 $i$ 行是排名第 $i$ 的單字與其出現次數，以一個空白分隔。",
      },
      samples: [
        {
          input: "7 2\napple\nbanana\napple\ncherry\nbanana\napple\ncherry\n",
          output: "apple 3\nbanana 2\n",
        },
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content:
            'from typing import List, Tuple\n\nfrom iolib import read_input\n\ndef top_k(words: List[str], k: int) -> List[Tuple[str, int]]:\n    """Return the k most frequent words as (word, count) pairs, ordered by\n    count descending; ties are broken by the lexicographically smaller word\n    first. k never exceeds the number of distinct words."""\n    # implement top_k here\n    return []\n\ndef main() -> None:\n    words, k = read_input()\n    for word, count in top_k(words, k):\n        print(word, count)\n\nif __name__ == "__main__":\n    main()\n',
          visibility: "editable",
          description:
            "The runnable entry. main() reads the words via iolib.read_input and prints each (word, count) pair returned by top_k. Implement top_k here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "iolib.py",
          content:
            '"""Read-only I/O helper for the top-k frequent words problem.\n\nDo NOT modify. main.py imports read_input to turn the stdin stream\ninto the word list and K.\n"""\n\nimport sys\nfrom typing import List, Tuple\n\n\ndef read_input() -> Tuple[List[str], int]:\n    """Return (words, k) parsed from stdin (empty list and 0 on bad count)."""\n    data = sys.stdin.read().split()\n    if len(data) < 2:\n        return [], 0\n    n = int(data[0])\n    k = int(data[1])\n    return data[2 : 2 + n], k\n',
          visibility: "readonly",
          description:
            "Read-only stdin helper. Provides read_input(), which main.py imports to get the word list and K. You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "A tie broken by lexicographic order, and K=1 with a two-way tie.",
          cases: [
            {
              input: "7 2\napple\nbanana\napple\ncherry\nbanana\napple\ncherry\n",
              output: "apple 3\nbanana 2\n",
            },
            { input: "4 1\nbb\naa\nbb\naa\n", output: "aa 2\n" },
          ],
        },
        hidden: {
          description:
            "Single repeated word, K equal to the distinct count, all-tied frequencies, N=1, and 20-char near-identical words.",
          weight: 40,
          cases: [
            { input: "5 1\nzz\nzz\nzz\nzz\nzz\n", output: "zz 5\n" },
            { input: "6 3\nc\nb\na\nb\nc\nc\n", output: "c 3\nb 2\na 1\n" },
            {
              input: "8 4\ndog\ncat\nant\nbee\nfox\nelk\nowl\nbat\n",
              output: "ant 1\nbat 1\nbee 1\ncat 1\n",
            },
            { input: "1 1\nhello\n", output: "hello 1\n" },
            {
              input:
                "5 2\naaaaaaaaaaaaaaaaaaab\naaaaaaaaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaaab\naaaaaaaaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaaaz\n",
              output: "aaaaaaaaaaaaaaaaaaaa 2\naaaaaaaaaaaaaaaaaaab 2\n",
            },
          ],
        },
        hidden2: {
          description: "Random word streams from small pools with many frequency ties.",
          weight: 60,
          cases: [
            {
              input:
                "300 9\naffbdf\nfcecd\neabfad\nddbaab\nfcecd\nb\nbf\nbf\nddbaab\nd\nddefce\nddbaab\nddefce\naffbdf\ncbbd\neeaaea\nbdacd\nbf\ncbbd\ndcbbaf\ncfdbef\nfcecd\ndcbbaf\ncfba\nddefce\naffbdf\nbdacd\neeaaea\nbcf\nbdacd\na\nbf\nbcf\ne\nbf\naffbdf\nbf\neeaaea\nf\nfcecd\nbaccbe\ne\ncfdbef\nb\nbf\ndcbbaf\nb\nddefce\nfcecd\nbdacd\neeaaea\ne\ndcbbaf\nd\ncbbd\nd\na\nbcf\nf\nbaccbe\nbaccbe\neabfad\neabfad\nbcf\nddbaab\naffbdf\naf\neabfad\nfcecd\nd\nbdacd\ndcbbaf\ncfba\ncfba\nbaccbe\ncbbd\ndcbbaf\nfcecd\nbf\nb\ncbbd\nfcecd\nf\nddbaab\ncfba\ndcbbaf\ne\nbf\nb\neabfad\ne\nfcecd\nddefce\nbf\ne\nbcf\ne\ncfba\naffbdf\nbf\ne\ne\nf\ndcbbaf\naf\nfcecd\neeaaea\na\nbdacd\nddbaab\ne\ncfdbef\nd\nf\nbcf\nddbaab\na\nbf\nbcf\nfcecd\neabfad\ndcbbaf\nbaccbe\na\nf\neabfad\ndcbbaf\na\nbf\ncbbd\nfcecd\na\neeaaea\neabfad\nbf\ndcbbaf\nbcf\naf\neabfad\ncfdbef\nf\neabfad\nbcf\ne\naffbdf\nf\neeaaea\naf\nbdacd\nd\nbcf\ncbbd\ne\naffbdf\nddefce\na\ncfba\nb\ncfba\ndcbbaf\naffbdf\neeaaea\ncfdbef\nddefce\nd\neabfad\nbcf\naffbdf\naffbdf\nd\ndcbbaf\nd\nbcf\nddefce\nbcf\ncbbd\nbcf\naffbdf\naffbdf\na\ncfdbef\ncfba\ncfdbef\ncfdbef\na\nbdacd\naf\nddbaab\nb\na\nbaccbe\ncbbd\neabfad\ncbbd\nd\nbcf\ne\neabfad\ndcbbaf\ne\ncbbd\nfcecd\neeaaea\ncbbd\nf\nbcf\nbf\na\ncbbd\neabfad\naf\nbdacd\ncfdbef\ncfba\ncfba\ncbbd\ncfba\ncbbd\ncfba\naffbdf\naffbdf\ncbbd\nf\ncfba\nbaccbe\ndcbbaf\neeaaea\neeaaea\na\nd\nbf\nd\nddbaab\nfcecd\nddefce\nddbaab\nbf\naf\nbdacd\naf\ncfba\nfcecd\nd\na\nbcf\ne\nddbaab\naffbdf\neabfad\nf\neeaaea\ne\nfcecd\naf\nb\ndcbbaf\nddefce\naffbdf\neeaaea\naffbdf\na\naffbdf\nf\ncbbd\nddefce\nddbaab\ndcbbaf\ncbbd\naf\nbaccbe\nfcecd\nfcecd\naffbdf\neeaaea\ndcbbaf\ndcbbaf\nd\ne\nbdacd\nd\nf\naffbdf\neabfad\neabfad\nbcf\ncfba\nbdacd\nbcf\ncbbd\ncbbd\ne\ne\naffbdf\nbf\neabfad\nbf\nbcf\na\naffbdf\naffbdf\n",
              output:
                "affbdf 24\nbcf 20\ncbbd 20\nbf 19\ndcbbaf 19\ne 19\neabfad 18\nfcecd 18\na 16\n",
            },
            {
              input:
                "600 16\nc\ndfc\ncabe\ncc\nb\ndcbbe\nfeaeda\na\nedbdec\nf\nacce\nedbdec\nffaefb\ndcbbe\nfa\nb\nfa\necebfa\nbe\nacce\nbcbb\nca\nadaec\ncabe\na\nf\nffaefb\nf\nb\ncc\nfa\nadaec\ncc\nffe\nacce\nfeaeda\necebfa\nbcbb\nfc\necebfa\ncc\ndfc\naebff\nad\nbfdead\nfa\nadaec\ndcbbe\nfa\nffe\ncc\nffe\na\ndfc\nbe\ncbfddf\na\nacce\nffe\nbfdead\nffaefb\nfc\nfbbdd\nbcbb\nafd\naaab\nafd\nffaefb\ndccbbc\naafcbb\naafcbb\nf\ncbfddf\nfc\naafcbb\nfa\ndcbbe\nfa\nad\nad\nedbdec\ncbfddf\ndcbbe\nadaec\nb\ncc\nfeaeda\ndfc\nca\naebff\nffe\ndcbbe\nfa\nf\neecfed\naebff\neecfed\nbcbb\nc\nedbdec\necebfa\nbfdead\ncabe\nffaefb\ncc\ncabe\nacce\nafd\nafd\naafcbb\nbe\na\ndccbbc\ndcbbe\nafd\ndccbbc\nafd\na\naafcbb\neecfed\necebfa\naaab\nafd\naafcbb\nffaefb\naaab\nfeaeda\nbe\naafcbb\ncc\nafd\nb\nedbdec\ncbfddf\naebff\ndcbbe\nad\nf\nffe\nffaefb\ndccbbc\ndccbbc\ncbfddf\nafd\nfbbdd\ncbfddf\nfbbdd\nca\naebff\nacce\nacce\nedbdec\nca\nbfdead\nca\nca\ncabe\nfeaeda\nf\naaab\nedbdec\necebfa\necebfa\nacce\naaab\nc\nf\nbe\nfbbdd\nfeaeda\nacce\nafd\naebff\naebff\ndcbbe\ncabe\nad\nca\nadaec\nb\ncabe\nafd\nfeaeda\nffe\naafcbb\ncabe\nfbbdd\nfeaeda\nfeaeda\ndcbbe\nacce\naaab\necebfa\ndcbbe\nfc\na\naafcbb\nffe\nfa\nfeaeda\nafd\nadaec\nca\ncbfddf\ncbfddf\naebff\nfeaeda\nc\nffaefb\naaab\nadaec\nc\na\nc\nb\nffe\nfbbdd\nfbbdd\ncabe\nbcbb\nca\neecfed\nf\nfbbdd\ndcbbe\nedbdec\neecfed\ncbfddf\nad\naebff\nbcbb\naebff\naaab\ndccbbc\nf\ndcbbe\naaab\nf\nbe\naaab\naaab\ndccbbc\ncbfddf\ncc\nffe\nfeaeda\ncc\nadaec\naaab\ncc\naafcbb\nfeaeda\nadaec\naafcbb\ndfc\naafcbb\nedbdec\nfeaeda\nafd\nc\nacce\nffaefb\ndccbbc\nafd\ndccbbc\ndfc\naaab\ndfc\naafcbb\nca\nedbdec\ndccbbc\ndccbbc\ncc\nbe\nffe\nb\naebff\nedbdec\neecfed\nbe\nafd\nb\nc\nad\nedbdec\necebfa\nbcbb\ncabe\nbe\nffe\nfa\nffe\naafcbb\na\ncabe\ndfc\ndccbbc\nacce\naafcbb\ndcbbe\naebff\ncc\nb\nad\nffe\nbfdead\nffaefb\naafcbb\nffaefb\nafd\nbfdead\nbcbb\nadaec\ncabe\nfc\ndcbbe\neecfed\nbcbb\ndfc\nfbbdd\necebfa\ncc\na\nedbdec\nfc\ndcbbe\nbcbb\nffe\nedbdec\nacce\nffaefb\nad\nb\nacce\nffaefb\nacce\nf\ndcbbe\nad\nb\nbcbb\ndfc\naebff\neecfed\nbe\naebff\nedbdec\necebfa\nfeaeda\nb\ncc\ncbfddf\nb\nffaefb\nffe\nfeaeda\naaab\naafcbb\necebfa\nca\nfc\nb\naaab\na\nbe\nfa\nad\necebfa\nb\nadaec\nf\ncabe\ndcbbe\neecfed\nca\ndcbbe\na\nacce\naafcbb\nffaefb\neecfed\nffaefb\nad\ndcbbe\naaab\nfc\nbfdead\ndccbbc\ndcbbe\nad\nca\nad\naaab\nbcbb\nbfdead\nffaefb\nffe\nfbbdd\nfeaeda\naaab\nffaefb\nbfdead\naebff\nedbdec\nafd\nedbdec\nacce\nbfdead\nfa\ndcbbe\nffaefb\nfeaeda\nca\ndfc\nf\nad\nffe\nffe\nafd\nfeaeda\nadaec\nfbbdd\nfbbdd\nadaec\nffaefb\nca\na\nadaec\nf\nffe\nbe\nfbbdd\nffe\nca\nfbbdd\nedbdec\nfeaeda\nf\nfbbdd\nafd\nb\nadaec\nfbbdd\neecfed\nacce\nc\nfeaeda\naaab\nfeaeda\ncbfddf\nafd\naebff\nfc\nffe\ncabe\nbfdead\nbcbb\nfc\nfbbdd\nfeaeda\nafd\nafd\na\nedbdec\naebff\nc\nbe\nb\nfeaeda\naafcbb\nfa\nb\nbfdead\necebfa\ncc\nc\nedbdec\nfc\ndcbbe\nbe\na\nacce\nffaefb\nb\nadaec\ndccbbc\nb\naaab\nacce\ndfc\nca\nbfdead\nf\nfbbdd\nbe\nca\ndfc\ncc\nacce\nc\nffaefb\ndccbbc\naebff\nb\naaab\neecfed\nca\na\ncc\nffe\nfbbdd\ndcbbe\nedbdec\nf\nf\nf\nedbdec\naebff\nbfdead\nca\naafcbb\nedbdec\nffe\nbe\ndfc\nbe\nedbdec\nfeaeda\nacce\nf\nffaefb\nbcbb\ncc\nbcbb\nedbdec\nca\nbe\nc\neecfed\nbcbb\ndcbbe\nad\naebff\nca\nedbdec\nc\nedbdec\nf\nffaefb\nadaec\ndfc\ndccbbc\nbcbb\nc\ndcbbe\nfc\na\nbcbb\nbcbb\naebff\nca\nfbbdd\ndccbbc\ndfc\necebfa\nbe\ncabe\ncabe\ncabe\nedbdec\naebff\ncc\ncbfddf\nfbbdd\nffaefb\nfbbdd\nf\nadaec\nedbdec\naafcbb\nbcbb\ncc\nedbdec\necebfa\ndfc\nbe\naafcbb\nfc\nfa\nafd\nedbdec\nbcbb\nafd\nfbbdd\naebff\nad\na\naaab\nafd\n",
              output:
                "edbdec 31\ndcbbe 26\nafd 25\nfeaeda 25\nffaefb 25\nffe 24\naebff 23\nca 23\nf 23\nfbbdd 23\naaab 22\naafcbb 22\nacce 22\nb 22\nbcbb 21\ncc 21\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      id: "problem_mf-josephus",
      title: "Josephus Survivor (Multi-File)",
      type: "multi_file" as const,
      tags: ["hard", "Math", "Recursion"],
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statement: {
        body: "這是一題多檔實作題，也是經典的約瑟夫問題（Josephus problem）。$n$ 個人編號 $1$ 到 $n$ 圍成一圈，從 $1$ 號開始數，每次數到第 $k$ 個人就把他淘汰出圈，下一輪從被淘汰者的下一位重新從 $1$ 開始數，直到只剩一人。請求出最後倖存者的編號。\n\n可執行的進入點是 `main.py`：`main()` 已經寫好，會透過唯讀的 `iolib.py` 讀入所有詢問，對每筆呼叫你實作的 `survivor(n, k)` 並印出結果。你只需要實作 `survivor`。\n\n注意 $n$ 最大可達 $10^{12}$：逐一模擬淘汰過程（無論用陣列還是鏈結串列）都無法在時限內完成。$k$ 很小，想想如何一次跳過一整輪的淘汰，讓每層遞迴把問題規模縮小為約 $(1 - 1/k)$ 倍。\n\n例如 $n = 5$、$k = 2$ 時，淘汰順序是 $2, 4, 1, 5$，倖存者是 $3$。",
        inputFormat:
          "第一行包含一個整數 $Q$（$1 \\le Q \\le 100$），代表詢問數。\n\n接下來 $Q$ 行，每行包含兩個整數 $n$ 與 $k$（$1 \\le n \\le 10^{12}$，$1 \\le k \\le 10$）。",
        outputFormat: "輸出 $Q$ 行，第 $i$ 行為第 $i$ 筆詢問的倖存者編號。",
      },
      samples: [
        { input: "3\n5 2\n1 5\n7 3\n", output: "3\n1\n4\n" },
        { input: "2\n6 1\n2 2\n", output: "6\n1\n" },
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content:
            'import sys\n\nfrom iolib import read_queries\n\n\ndef survivor(n: int, k: int) -> int:\n    """Return the 1-indexed position of the last survivor among n people counting k."""\n    # implement survivor here; note n can be as large as 10**12\n    return 1\n\n\ndef main() -> None:\n    for n, k in read_queries():\n        print(survivor(n, k))\n\n\nif __name__ == "__main__":\n    main()\n',
          visibility: "editable",
          description:
            "The runnable entry. main() reads queries via iolib.read_queries and prints one survivor per query. Implement survivor(n, k) here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "iolib.py",
          content:
            '"""Read-only stdin helper for the Josephus survivor problem.\n\nDo NOT modify. main.py imports read_queries to get the (n, k) query list.\n"""\n\nimport sys\nfrom typing import List, Tuple\n\n\ndef read_queries() -> List[Tuple[int, int]]:\n    """Return the Q (n, k) query pairs from stdin."""\n    data = sys.stdin.read().split()\n    if not data:\n        return []\n    q = int(data[0])\n    out = []\n    for i in range(q):\n        out.append((int(data[1 + 2 * i]), int(data[2 + 2 * i])))\n    return out\n',
          visibility: "readonly",
          description:
            "Read-only stdin helper providing read_queries(). You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "Classic small circles including k=1 and the n=5,k=2 example.",
          cases: [
            { input: "3\n5 2\n1 5\n7 3\n", output: "3\n1\n4\n" },
            { input: "2\n6 1\n2 2\n", output: "6\n1\n" },
          ],
        },
        hidden: {
          description:
            "Subtask 1: behavioural edges — n=1, n=2, k=1, and small-to-medium circles a simulation can still solve.",
          weight: 40,
          cases: [
            { input: "5\n1 1\n1 10\n2 2\n2 3\n3 1\n", output: "1\n1\n1\n2\n3\n" },
            { input: "4\n10 2\n10 3\n41 3\n100 7\n", output: "5\n4\n31\n50\n" },
            { input: "3\n13 4\n17 5\n1000 10\n", output: "5\n11\n63\n" },
            { input: "1\n2000 9\n", output: "418\n" },
          ],
        },
        hidden2: {
          description:
            "Subtask 2: n up to 10^12 — forces the O(k log n) block-skipping recurrence; naive simulation cannot finish.",
          weight: 60,
          cases: [
            {
              input: "3\n1000000000000 2\n999999999999 10\n100000000000 7\n",
              output: "900488372225\n754164869066\n88799638190\n",
            },
            {
              input:
                "5\n123456789012 3\n987654321098 9\n1000000000000 10\n55555555555 5\n1 2\n",
              output: "68400330719\n157648450116\n754164869076\n37819131411\n1\n",
            },
            {
              input: "2\n1000000000000 1\n999999999937 2\n",
              output: "1000000000000\n900488372099\n",
            },
          ],
        },
      },
    },
  ];
}

export async function seedProblems(
  prisma: PrismaClient,
  teacherId: string,
  options: {
    advancedDemoImages: SeedAdvancedDemoImages;
    storage?: SeedStorageClient;
  },
) {
  const storage = (options.storage ?? createStorageClient()) as ReturnType<
    typeof createStorageClient
  >;

  const problemDefs = buildSeedProblemDefs(teacherId, options.advancedDemoImages);

  validateProblemDefinitions(problemDefs);

  await prisma.$transaction(
    async (tx) => {
      // Use the same transaction-scoped lock as normal publishing. Without it,
      // a publish racing this seed can reserve the same max(displayId)+1.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4711)`;
      let nextDisplayId =
        ((await tx.problem.aggregate({ _max: { displayId: true } }))._max.displayId ?? 0) + 1;

      for (const def of problemDefs) {
        const validator = await persistJudgeConfig(
          storage as unknown as SeedStorageClient,
          def.id,
          def.judgeConfig,
        );

        const samples = toSamplesJson(def.samples);
        const sharedFields = {
          title: def.title,
          difficulty: pickSeedDifficulty(def.tags),
          tags: stripDifficultyTags(def.tags),
          type: def.type,
          status: def.status ?? "published",
          ...(validator.judgeConfig !== undefined
            ? { judgeConfig: validator.judgeConfig as unknown as Prisma.InputJsonValue }
            : {}),
          checkerStorage: validator.checkerStorage ?? Prisma.DbNull,
          interactorStorage: validator.interactorStorage ?? Prisma.DbNull,
          ...(samples !== undefined ? { samples } : {}),
          ...(def.advancedConfig
            ? { advancedConfig: def.advancedConfig as unknown as Prisma.InputJsonValue }
            : {}),
          ...(def.advancedRequiredPaths
            ? { advancedRequiredPaths: def.advancedRequiredPaths }
            : {}),
        };

        const existing = await tx.problem.findUnique({
          where: { id: def.id },
          select: { displayId: true },
        });
        const isPublished = (def.status ?? "published") === "published";
        const displayId = isPublished ? (existing?.displayId ?? nextDisplayId++) : null;

        const problem = await tx.problem.upsert({
          create: {
            authorId: def.authorId,
            id: def.id,
            memoryLimitMb: def.memoryLimitMb,
            timeLimitMs: def.timeLimitMs,
            visibility: def.visibility,
            displayId,
            ...sharedFields,
          },
          update: {
            ...sharedFields,
            ...(isPublished && existing?.displayId == null ? { displayId } : {}),
          },
          where: { id: def.id },
        });
        let activeStorageBytes =
          (validator.checkerStorage?.size ?? 0) +
          (validator.interactorStorage?.size ?? 0);

        const stmt = def.statement;
        await tx.problemStatement.upsert({
          create: {
            bodyMarkdown: stmt.body,
            inputFormat: stmt.inputFormat ?? "",
            outputFormat: stmt.outputFormat ?? "",
            problemId: problem.id,
          },
          update: {
            bodyMarkdown: stmt.body,
            inputFormat: stmt.inputFormat ?? "",
            outputFormat: stmt.outputFormat ?? "",
          },
          where: { problemId: problem.id },
        });

        if (def.testcases) {
          const setEntries = Object.entries(def.testcases);
          for (const [index, [setName, setDef]] of setEntries.entries()) {
            // Subtask weight must be >= 1 (subtaskResultItemSchema rejects 0), so the
            // judge's executeSandbox result validates. Samples carry a minimal weight
            // of 1 (vs the scored set's 100) — a correct solution still earns full
            // marks, and a samples-only pass earns only the 1-point floor.
            const weight = setDef.weight ?? (setName === "sample" ? 1 : 100);
            const testcaseSet = await tx.testcaseSet.upsert({
              create: {
                name: setName,
                description: setDef.description ?? "",
                ordinal: index,
                problemId: problem.id,
                weight,
              },
              update: {
                description: setDef.description ?? "",
                ordinal: index,
                weight,
              },
              where: {
                problemId_name: {
                  name: setName,
                  problemId: problem.id,
                },
              },
            });

            await tx.testcase.deleteMany({
              where: { testcaseSetId: testcaseSet.id },
            });

            const preparedCases = await Promise.all(
              setDef.cases.map(async (testcase) => {
                const id = randomUUID();
                const version = randomUUID();
                const [inputStorage, outputStorage] = await Promise.all([
                  putImmutableText(
                    storage,
                    testcaseInputKey(problem.id, id, version),
                    testcase.input,
                  ),
                  putImmutableText(
                    storage,
                    testcaseOutputKey(problem.id, id, version),
                    testcase.output,
                  ),
                ]);
                return { id, inputStorage, outputStorage };
              }),
            );
            await tx.testcase.createMany({
              data: preparedCases.map((testcase, caseIndex) => ({
                  id: testcase.id,
                  ordinal: caseIndex + 1,
                  testcaseSetId: testcaseSet.id,
                  inputStorage: testcase.inputStorage,
                  outputStorage: testcase.outputStorage,
                })),
            });
            activeStorageBytes += preparedCases.reduce(
              (total, testcase) =>
                total + testcase.inputStorage.size + testcase.outputStorage.size,
              0,
            );
          }
        }

        if (def.workspaceFiles && def.workspaceFiles.length > 0) {
          await tx.problemWorkspaceFile.deleteMany({
            where: { problemId: problem.id },
          });
          const preparedFiles = await Promise.all(
            def.workspaceFiles.map(async (file) => {
              const id = randomUUID();
              return {
                id,
                file,
                contentStorage: await putImmutableText(
                  storage,
                  workspaceFileKey(problem.id, id, randomUUID()),
                  file.content,
                ),
              };
            }),
          );
          await tx.problemWorkspaceFile.createMany({
            data: preparedFiles.map(({ id, file, contentStorage }) => ({
              id,
              problemId: problem.id,
              language: file.language,
              path: file.path,
              contentStorage,
              visibility: file.visibility,
              description: file.description ?? "",
              orderIndex: file.orderIndex ?? 0,
            })),
          });
          activeStorageBytes += preparedFiles.reduce(
            (total, file) => total + file.contentStorage.size,
            0,
          );
        }

        await tx.problem.update({
          where: { id: problem.id },
          data: { activeStorageBytes, storageGeneration: { increment: 1 } },
        });

        const testcaseSetCount = def.testcases ? Object.keys(def.testcases).length : 0;
        const extras: string[] = [];
        if (def.samples?.length) extras.push(`${def.samples.length} samples`);
        if (def.workspaceFiles?.length)
          extras.push(`${def.workspaceFiles.length} workspace files`);
        const extrasLabel = extras.length ? `, ${extras.join(", ")}` : "";
        console.log(
          `  Problem: ${def.id} [${def.type}] (${testcaseSetCount} testcase sets${extrasLabel})`,
        );
      }
    },
    { maxWait: 10_000, timeout: 30 * 60 * 1000 },
  );
}

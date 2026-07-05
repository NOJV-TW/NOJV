import { randomUUID } from "node:crypto";

import type { AdvancedConfig } from "@nojv/core";
import {
  checkerKey,
  createStorageClient,
  interactorKey,
  putText,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
} from "@nojv/storage";

import type { Prisma, PrismaClient } from "../../generated/prisma/client";

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

type SeedLocale = "en" | "zh-TW";

type SeedStatement = {
  title: string;
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

type SeedStatements = Record<SeedLocale, SeedStatement>;

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
  statements: SeedStatements;
  testcases?: SeedTestcaseSets;
  judgeConfig?: Record<string, unknown>;
  status?: "draft" | "published";
  samples?: SeedProblemSample[];
  workspaceFiles?: SeedWorkspaceFile[];
  advancedConfig?: AdvancedConfig;
  advancedRequiredPaths?: string[];
};

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

    if (!def.statements.en?.title || !def.statements["zh-TW"]?.title) {
      throw new Error(`Missing required locales for problem: ${def.id}`);
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
): Promise<Record<string, unknown> | undefined> {
  if (!judgeConfig) return undefined;
  const client = storage as ReturnType<typeof createStorageClient>;
  const { checkerScript, interactorScript, ...rest } = judgeConfig;

  if (rest.type === "checker" && typeof checkerScript === "string") {
    const key = checkerKey(problemId);
    await putText(client, key, checkerScript);
    return { ...rest, checkerKey: key };
  }
  if (rest.type === "interactive" && typeof interactorScript === "string") {
    const key = interactorKey(problemId);
    await putText(client, key, interactorScript);
    return { ...rest, interactorKey: key };
  }
  return rest;
}

export function buildSeedProblemDefs(teacherId: string): SeedProblemDef[] {
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
      statements: {
        "zh-TW": {
          title: "暖身：兩數之和",
          body: "經典暖身題。從標準輸入讀取兩個整數，輸出它們的總和。",
          inputFormat: String.raw`一行，包含兩個以空白分隔的整數 $a$ 和 $b$（$-2^{31} \le a, b \le 2^{31}-1$）。`,
          outputFormat: "一行，輸出 $a + b$ 的值。",
        },
        en: {
          title: "Warmup Sum",
          body: "The classic warmup task. Read exactly two integers from standard input and print their sum.",
          inputFormat: String.raw`A single line containing two space-separated integers $a$ and $b$ ($-2^{31} \le a, b \le 2^{31}-1$).`,
          outputFormat: "A single line containing the value of $a + b$.",
        },
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
      statements: {
        "zh-TW": {
          title: "二分搜尋：lower bound",
          body: "給定一個由小到大排序的整數陣列，以及若干個查詢值。對每個查詢值 $x$，回答陣列中第一個「大於等於 $x$」的元素之 0-based 索引；若不存在，回答陣列長度 $N$。\n\n每個查詢都應以 $O(\\log N)$ 的二分搜尋回答。",
          inputFormat:
            "第一行一個整數 $N$（$1 \\le N \\le 2 \\times 10^5$），表示陣列長度。\n\n第二行 $N$ 個由小到大排序的整數 $a_0 \\le a_1 \\le \\dots \\le a_{N-1}$（$-10^9 \\le a_i \\le 10^9$）。\n\n第三行一個整數 $Q$（$1 \\le Q \\le 2 \\times 10^5$），表示查詢數。\n\n第四行 $Q$ 個整數，每個是一筆查詢值 $x$。",
          outputFormat: "一行，輸出 $Q$ 個以空白分隔的索引，第 $k$ 個是第 $k$ 筆查詢的答案。",
        },
        en: {
          title: "Binary Search Lower Bound",
          body: "Given a sorted array of integers and several query values, for each query $x$ report the 0-based index of the first element that is greater than or equal to $x$. If no such element exists, report the array length $N$.\n\nEach query must be answered with an $O(\\log N)$ binary search.",
          inputFormat:
            "The first line contains an integer $N$ ($1 \\le N \\le 2 \\times 10^5$), the array length.\n\nThe second line contains $N$ non-decreasing integers $a_0 \\le a_1 \\le \\dots \\le a_{N-1}$ ($-10^9 \\le a_i \\le 10^9$).\n\nThe third line contains an integer $Q$ ($1 \\le Q \\le 2 \\times 10^5$), the number of queries.\n\nThe fourth line contains $Q$ query values $x$.",
          outputFormat:
            "A single line with $Q$ space-separated indices; the $k$-th is the answer to the $k$-th query.",
        },
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
      statements: {
        "zh-TW": {
          title: "迷宮最短路徑",
          body: "給定一個由 `.`（可通行）與 `#`（牆）組成的格狀迷宮。從左上角 $(0,0)$ 出發，每步可往上、下、左、右移動到相鄰的可通行格子，求到達右下角 $(R-1,C-1)$ 的最短步數。\n\n若起點或終點是牆，或無法到達終點，輸出 `-1`。這是一道單源最短路徑（BFS）題。",
          inputFormat:
            "第一行兩個整數 $R$ 和 $C$（$1 \\le R, C \\le 1000$），表示列數與行數。\n\n接下來 $R$ 行，每行 $C$ 個字元，`.` 表示通道，`#` 表示牆壁。",
          outputFormat: "一行，輸出從 $(0,0)$ 到 $(R-1,C-1)$ 的最短步數；若不可達輸出 `-1`。",
        },
        en: {
          title: "Maze Shortest Path",
          body: "Given a grid maze of `.` (open) and `#` (wall) cells, start at the top-left $(0,0)$ and move up/down/left/right between adjacent open cells. Report the minimum number of steps to reach the bottom-right $(R-1,C-1)$.\n\nIf the start or goal is a wall, or the goal is unreachable, output `-1`. This is a single-source shortest-path (BFS) problem.",
          inputFormat:
            "The first line contains two integers $R$ and $C$ ($1 \\le R, C \\le 1000$), the number of rows and columns.\n\nThe next $R$ lines each contain $C$ characters: `.` for passage and `#` for wall.",
          outputFormat:
            "A single line containing the shortest number of steps from $(0,0)$ to $(R-1,C-1)$, or `-1` if it is unreachable.",
        },
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
      visibility: "private" as const,
      statements: {
        "zh-TW": {
          title: "最大子陣列和",
          body: "給定一個整數陣列，找出和最大的「連續非空子陣列」，並輸出該最大和。\n\n這是經典的 Kadane 動態規劃題：以線性時間維護「以當前位置結尾的最大子陣列和」。注意陣列可能全為負數，此時答案是最大的單一元素。",
          inputFormat:
            "第一行一個整數 $N$（$1 \\le N \\le 10^5$），表示陣列長度。\n\n第二行 $N$ 個整數 $a_i$（$-10^4 \\le a_i \\le 10^4$）。",
          outputFormat: "一行，輸出最大連續子陣列和。",
        },
        en: {
          title: "Maximum Subarray Sum",
          body: "Given an array of integers, find the contiguous non-empty subarray with the largest sum and print that sum.\n\nThis is the classic Kadane dynamic-programming problem: maintain, in linear time, the best subarray sum ending at the current position. Note the array may be all negative, in which case the answer is the single largest element.",
          inputFormat:
            "The first line contains an integer $N$ ($1 \\le N \\le 10^5$), the array length.\n\nThe second line contains $N$ integers $a_i$ ($-10^4 \\le a_i \\le 10^4$).",
          outputFormat: "A single line containing the maximum contiguous subarray sum.",
        },
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
      visibility: "private" as const,
      statements: {
        "zh-TW": {
          title: "0/1 背包問題",
          body: "有 $N$ 件物品與一個容量為 $W$ 的背包。第 $i$ 件物品的重量為 $w_i$、價值為 $v_i$，每件物品至多選一次。在總重量不超過 $W$ 的前提下，求能取得的最大總價值。\n\n這是經典的 0/1 背包動態規劃，以一維 DP 表 $dp[c]$ 由大到小更新容量即可。",
          inputFormat:
            "第一行兩個整數 $N$ 和 $W$（$1 \\le N \\le 100$，$1 \\le W \\le 10^4$）。\n\n接下來 $N$ 行，每行兩個整數 $w_i$ 和 $v_i$（$1 \\le w_i \\le W$，$1 \\le v_i \\le 10^9$）。",
          outputFormat: "一行，輸出總重量不超過 $W$ 時的最大總價值。",
        },
        en: {
          title: "0/1 Knapsack",
          body: "There are $N$ items and a knapsack of capacity $W$. Item $i$ has weight $w_i$ and value $v_i$, and each item may be taken at most once. Maximize the total value without exceeding total weight $W$.\n\nThis is the classic 0/1 knapsack dynamic program; a one-dimensional table $dp[c]$ updated from high capacity to low suffices.",
          inputFormat:
            "The first line contains two integers $N$ and $W$ ($1 \\le N \\le 100$, $1 \\le W \\le 10^4$).\n\nThe next $N$ lines each contain two integers $w_i$ and $v_i$ ($1 \\le w_i \\le W$, $1 \\le v_i \\le 10^9$).",
          outputFormat:
            "A single line containing the maximum total value with total weight at most $W$.",
        },
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
      tags: ["easy", "Linked List", "Math", "Recursion"],
      type: "full_source" as const,
      id: "problem_add-two-numbers",
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "兩數相加",
          body: "讀入兩個整數並輸出它們的總和。",
          inputFormat: String.raw`一行，包含兩個以空白分隔的整數 $a$ 和 $b$（$-2^{31} \le a, b \le 2^{31}-1$）。`,
          outputFormat: "一行，輸出 $a + b$ 的值。",
        },
        en: {
          title: "Add Two Numbers",
          body: "Read two integers from stdin and print their sum.",
          inputFormat: String.raw`A single line containing two space-separated integers $a$ and $b$ ($-2^{31} \le a, b \le 2^{31}-1$).`,
          outputFormat: "A single line containing the value of $a + b$.",
        },
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
      statements: {
        "zh-TW": {
          title: "浮點數比較",
          body: "計算結果並以浮點數精度輸出。答案與預期值的絕對差必須小於 1e-6。",
          inputFormat: String.raw`一行，包含兩個以空白分隔的正整數 $a$ 和 $b$（$1 \le a, b \le 10^9$）。`,
          outputFormat: "一行，輸出 $a / b$ 的值。答案與預期值的絕對差須小於 $10^{-6}$。",
        },
        en: {
          title: "Float Compare",
          body: "Compute the result and output it with floating-point precision. Your answer must be within 1e-6 absolute difference of the expected value.",
          inputFormat: String.raw`A single line containing two space-separated positive integers $a$ and $b$ ($1 \le a, b \le 10^9$).`,
          outputFormat:
            "A single line containing the value of $a / b$. Your answer must be within $10^{-6}$ absolute difference of the expected value.",
        },
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
      statements: {
        "zh-TW": {
          title: "任意兩數之和（自訂 checker）",
          body: "這是一道「答案不唯一」的 checker 示範題。給定 $N$ 個整數與一個目標值 $T$，請找出**任意一組**索引 $i$、$j$（$1 \\le i, j \\le N$ 且 $i \\ne j$，1-based），使得 $a_i + a_j = T$，並輸出 `i j`（順序不限）。若不存在任何一組，輸出 `-1`。\n\n判題使用自訂 checker：只要你輸出的索引對確實滿足 $a_i + a_j = T$ 即視為正確，不要求與標準答案完全相同。",
          inputFormat:
            "第一行兩個整數 $N$ 和 $T$（$2 \\le N \\le 2000$，$-10^9 \\le T \\le 10^9$）。\n\n第二行 $N$ 個整數 $a_i$（$-10^9 \\le a_i \\le 10^9$）。",
          outputFormat: "輸出任意一組滿足條件的 1-based 索引 `i j`；若不存在輸出 `-1`。",
        },
        en: {
          title: "Any Two Sum (Checker)",
          body: "A multiple-valid-answers checker demo. Given $N$ integers and a target $T$, output **any** pair of indices $i$, $j$ ($1 \\le i, j \\le N$, $i \\ne j$, 1-based) such that $a_i + a_j = T$, printed as `i j` (either order). If no such pair exists, output `-1`.\n\nGrading uses a custom checker: any index pair that truly satisfies $a_i + a_j = T$ is accepted — you need not match a fixed reference answer.",
          inputFormat:
            "The first line contains two integers $N$ and $T$ ($2 \\le N \\le 2000$, $-10^9 \\le T \\le 10^9$).\n\nThe second line contains $N$ integers $a_i$ ($-10^9 \\le a_i \\le 10^9$).",
          outputFormat: "Output any valid 1-based index pair `i j`, or `-1` if none exists.",
        },
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
      statements: {
        "zh-TW": {
          title: "猜數字",
          body: "這是一道互動題。系統會選定一個秘密數字，你需要透過互動來猜出它。\\n\\n系統首先會輸出範圍 `lo hi`，你每次猜一個數字，系統會回應 `higher`（太小）、`lower`（太大）或 `correct`（猜對）。你最多有 20 次猜測機會。",
          inputFormat: String.raw`第一行包含兩個整數 $lo$ 和 $hi$（$1 \le lo \le hi \le 10^6$），表示數字的範圍。`,
          outputFormat: "每次輸出一個整數作為你的猜測。",
        },
        en: {
          title: "Guess the Number",
          body: "This is an interactive problem. The system picks a secret number and you must guess it.\\n\\nThe system first outputs the range `lo hi`. Each turn, you output a guess and the system responds with `higher` (too low), `lower` (too high), or `correct`. You have at most 20 guesses.",
          inputFormat: String.raw`The first line contains two integers $lo$ and $hi$ ($1 \le lo \le hi \le 10^6$), the range of the number.`,
          outputFormat: "Output one integer per line as your guess.",
        },
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
      statements: {
        "zh-TW": {
          title: "質數判定（多檔）",
          body: "這是一題多檔實作題。可執行的進入點是 `main.py`：它從標準輸入讀入 $Q$ 個整數，對每個整數 $n$ 呼叫你實作的 `is_prime(n)`，並逐行印出 `YES`（質數）或 `NO`（非質數）。\n\n`main.py` 會 `import` 唯讀的 `iolib.py`（提供 `read_queries()` 解析 stdin）；你只需在 `main.py` 裡實作 `is_prime`。\n\n定義：小於 2 的整數都不是質數。請以試除到 $\\sqrt{n}$ 的方式判定，使每筆查詢都能在時限內完成。",
          inputFormat:
            "第一行一個整數 $Q$（$1 \\le Q \\le 10^4$）。\n\n接下來 $Q$ 行，每行一個整數 $n$（$0 \\le n \\le 10^9$）。",
          outputFormat: "對每個查詢輸出一行：質數輸出 `YES`，否則輸出 `NO`。",
        },
        en: {
          title: "Primality Test (Multi-File)",
          body: "A multi-file problem. The runnable entry point is `main.py`: it reads $Q$ integers from stdin, calls your `is_prime(n)` on each, and prints `YES` (prime) or `NO` (not prime), one per line.\n\n`main.py` imports the read-only `iolib.py` (which provides `read_queries()` to parse stdin); you only implement `is_prime` in `main.py`.\n\nDefinition: integers below 2 are not prime. Use trial division up to $\\sqrt{n}$ so each query stays within the time limit.",
          inputFormat:
            "The first line contains an integer $Q$ ($1 \\le Q \\le 10^4$).\n\nThe next $Q$ lines each contain an integer $n$ ($0 \\le n \\le 10^9$).",
          outputFormat: "For each query print one line: `YES` if prime, otherwise `NO`.",
        },
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
      statements: {
        "zh-TW": {
          title: "二分搜尋（多檔）",
          body: "這是一題多檔實作題。可執行的進入點是 `main.py`：它讀入一個由小到大排序、且元素互異的整數陣列，以及若干筆查詢。對每筆查詢 $x$，呼叫你實作的 `binary_search(arr, x)`，回傳 $x$ 在陣列中的 0-based 索引；若不存在，回傳 $-1$。\n\n`main.py` 會 `import` 唯讀的 `iolib.py`（提供 `read_problem()` 解析 stdin）；你只需在 `main.py` 裡實作 `binary_search`，且必須使用 $O(\\log N)$ 二分搜尋。",
          inputFormat:
            "第一行一個整數 $N$（$1 \\le N \\le 2 \\times 10^5$）。\n\n第二行 $N$ 個嚴格遞增的整數。\n\n第三行一個整數 $Q$（$1 \\le Q \\le 2 \\times 10^5$）。\n\n第四行 $Q$ 個查詢值。",
          outputFormat: "一行，輸出 $Q$ 個以空白分隔的結果，每個是對應查詢的索引或 $-1$。",
        },
        en: {
          title: "Binary Search (Multi-File)",
          body: "A multi-file problem. The runnable entry point is `main.py`: it reads a strictly increasing array of distinct integers and several queries. For each query $x$, it calls your `binary_search(arr, x)`, which returns the 0-based index of $x$ in the array, or $-1$ if absent.\n\n`main.py` imports the read-only `iolib.py` (which provides `read_problem()` to parse stdin); you only implement `binary_search` in `main.py`, and it must use an $O(\\log N)$ binary search.",
          inputFormat:
            "The first line contains an integer $N$ ($1 \\le N \\le 2 \\times 10^5$).\n\nThe second line contains $N$ strictly increasing integers.\n\nThe third line contains an integer $Q$ ($1 \\le Q \\le 2 \\times 10^5$).\n\nThe fourth line contains $Q$ query values.",
          outputFormat:
            "A single line with $Q$ space-separated results, each the index of the query or $-1$.",
        },
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
      statements: {
        "zh-TW": {
          title: "任意因數對（多檔 × 自訂 checker）",
          body: "這是一題「多檔 × 自訂 checker、且答案不唯一」示範題。可執行的進入點是 `main.py`：它讀入一個保證為合數的整數 $n$，呼叫你實作的 `any_factor_pair(n)`，並印出兩個整數 `a b`。\n\n你的目標是找出**任意一組**整數 $a, b$，使得 $a > 1$、$b > 1$ 且 $a \\times b = n$。例如 $n = 12$ 時，`2 6`、`3 4`、`6 2` 都算正確。\n\n`main.py` 會 `import` 唯讀的 `numio.py`（提供 `read_n()`）。判題使用自訂 checker，只驗證乘積是否等於 $n$。你只需在 `main.py` 裡實作 `any_factor_pair`。",
          inputFormat: "一行一個整數 $n$（$4 \\le n \\le 10^9$，保證為合數）。",
          outputFormat:
            "一行兩個以空白分隔的整數 `a b`，滿足 $a > 1$、$b > 1$ 且 $a \\times b = n$。",
        },
        en: {
          title: "Any Factor Pair (Multi-File Checker)",
          body: "A multi_file × custom-checker demo with multiple valid answers. The runnable entry point is `main.py`: it reads a guaranteed-composite integer $n$, calls your `any_factor_pair(n)`, and prints two integers `a b`.\n\nYour goal is to find **any** integers $a, b$ with $a > 1$, $b > 1$, and $a \\times b = n$. For $n = 12$, the outputs `2 6`, `3 4`, and `6 2` are all accepted.\n\n`main.py` imports the read-only `numio.py` (which provides `read_n()`). Grading uses a custom checker that only verifies the product equals $n$. You only implement `any_factor_pair` in `main.py`.",
          inputFormat:
            "A single line with one integer $n$ ($4 \\le n \\le 10^9$, guaranteed composite).",
          outputFormat:
            "A single line with two space-separated integers `a b` satisfying $a > 1$, $b > 1$, and $a \\times b = n$.",
        },
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
      statements: {
        "zh-TW": {
          title: "Multi-File Bisect (Interactive)",
          body: "這是一題「多檔 × 互動」示範題。可執行的進入點是 `main.py`：它先讀互動器輸出的第一行 `lo hi`，`import` 唯讀的 `proto.py`（提供 `read_range()` / `send_guess(g)` / `read_verdict()` 三個協定函式），再用二分搜尋找出秘密數字。\n\n互動器每回合回應 `higher`（太小）、`lower`（太大）或 `correct`（猜中）。你只需在 `main.py` 裡完成二分搜尋邏輯。",
          inputFormat: "互動器第一行輸出 `lo hi`（$1 \\le lo \\le hi \\le 10^6$）。",
          outputFormat: "每回合輸出一個整數猜測並立即 flush。",
        },
        en: {
          title: "Multi-File Bisect (Interactive)",
          body: "A multi_file × interactive demo problem. The runnable entry point is `main.py`: it reads the interactor's opening `lo hi` line, imports the read-only `proto.py` (which provides `read_range()` / `send_guess(g)` / `read_verdict()`), and binary-searches for the secret.\n\nEach turn the interactor replies `higher` (too low), `lower` (too high), or `correct`. You only complete the binary-search loop in `main.py`.",
          inputFormat: "The interactor first prints `lo hi` ($1 \\le lo \\le hi \\le 10^6$).",
          outputFormat: "Print one integer guess per turn and flush immediately.",
        },
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
      statements: {
        "zh-TW": {
          title: "Noisy Oracle Hunt",
          body: "這是一道高難互動題。你要找出區間內秘密數字，但 oracle 並非完全誠實。\n\n互動器第一行輸出：`lo hi maxTurns liePeriod`。\n你每回合輸出一個猜測整數，互動器回應：\n- `higher`：你的猜測太小\n- `lower`：你的猜測太大\n- `correct`：猜中\n\n陷阱：每逢第 `liePeriod` 回合（例如 5,10,15...），若尚未猜中，回應會故意反轉。",
          inputFormat: "互動器先輸出四個整數 `lo hi maxTurns liePeriod`。",
          outputFormat: "每回合輸出一個整數猜測，並立即 flush。",
        },
        en: {
          title: "Noisy Oracle Hunt",
          body: "This is a hard interactive problem. You must find a hidden number in range, but the oracle is not always truthful.\n\nThe interactor first prints: `lo hi maxTurns liePeriod`.\nEach turn, print one integer guess, and receive:\n- `higher`: your guess is too small\n- `lower`: your guess is too large\n- `correct`: guessed exactly\n\nTrap: on every `liePeriod`-th turn (5, 10, 15, ...), if not already correct, the response is intentionally inverted.",
          inputFormat: "The interactor first outputs `lo hi maxTurns liePeriod`.",
          outputFormat: "Print one integer guess per turn and flush immediately.",
        },
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
        run: { imageRef: "nojv-demo-advanced-run:local", imageSource: "registry" },
        grade: { imageRef: "nojv-demo-advanced-grade:local", imageSource: "registry" },
        network: { mode: "none" },
        maxScore: 100,
      },
      advancedRequiredPaths: ["main.py"],
      statements: {
        "zh-TW": {
          title: "兩數之和（Advanced 示範）",
          body: "這是一道 Advanced Mode（run/grade 拆分）示範題目。請上傳一個名為 `main.py` 的 Python 程式，系統會把檔案放到 `/workspace/submission/`。\n\nrun 映像檔（`nojv-demo-advanced-run:local`，請先 `pnpm demo-advanced:build` 建好）會用每筆內建測資的 stdin 執行你的 `main.py`，並把輸出交給 grade 映像檔（`nojv-demo-advanced-grade:local`，內含標準答案）比對。每行輸入是兩個以空白分隔的整數，請輸出它們的和。全部測資通過即 AC。\n\n範例 `main.py`：\n\n```python\na, b = map(int, input().split())\nprint(a + b)\n```",
          inputFormat: "一行兩個以空白分隔的整數 `a b`。",
          outputFormat: "一個整數：`a + b`。",
        },
        en: {
          title: "Sum of Two Integers (Advanced Demo)",
          body: "Advanced Mode (run/grade split) demo problem. Upload a Python program named `main.py`; the system mounts it under `/workspace/submission/`.\n\nThe run image (`nojv-demo-advanced-run:local`, build it first with `pnpm demo-advanced:build`) feeds each baked-in testcase's stdin to your `main.py` and hands the output to the grade image (`nojv-demo-advanced-grade:local`, which holds the answers) for comparison. Each input line is two space-separated integers; print their sum. All testcases passing is AC.\n\nExample `main.py`:\n\n```python\na, b = map(int, input().split())\nprint(a + b)\n```",
          inputFormat: "One line with two space-separated integers `a b`.",
          outputFormat: "A single integer: `a + b`.",
        },
      },
    },
  ];
}

export async function seedProblems(
  prisma: PrismaClient,
  teacherId: string,
  storageOverride?: SeedStorageClient,
) {
  const storage = (storageOverride ?? createStorageClient()) as ReturnType<
    typeof createStorageClient
  >;

  const problemDefs = buildSeedProblemDefs(teacherId);

  validateProblemDefinitions(problemDefs);

  for (const [problemIndex, def] of problemDefs.entries()) {
    const judgeConfig = await persistJudgeConfig(
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
      displayId: (def.status ?? "published") === "published" ? problemIndex + 1 : null,
      ...(judgeConfig !== undefined
        ? { judgeConfig: judgeConfig as unknown as Prisma.InputJsonValue }
        : {}),
      ...(samples !== undefined ? { samples } : {}),
      ...(def.advancedConfig
        ? { advancedConfig: def.advancedConfig as unknown as Prisma.InputJsonValue }
        : {}),
      ...(def.advancedRequiredPaths
        ? { advancedRequiredPaths: def.advancedRequiredPaths }
        : {}),
    };

    const problem = await prisma.problem.upsert({
      create: {
        authorId: def.authorId,
        id: def.id,
        memoryLimitMb: def.memoryLimitMb,
        timeLimitMs: def.timeLimitMs,
        visibility: def.visibility,
        ...sharedFields,
      },
      update: sharedFields,
      where: { id: def.id },
    });

    for (const [locale, stmt] of Object.entries(def.statements)) {
      await prisma.problemStatementI18n.upsert({
        create: {
          bodyMarkdown: stmt.body,
          inputFormat: stmt.inputFormat ?? "",
          outputFormat: stmt.outputFormat ?? "",
          locale,
          problemId: problem.id,
          title: stmt.title,
        },
        update: {
          bodyMarkdown: stmt.body,
          inputFormat: stmt.inputFormat ?? "",
          outputFormat: stmt.outputFormat ?? "",
          title: stmt.title,
        },
        where: {
          problemId_locale: {
            locale,
            problemId: problem.id,
          },
        },
      });
    }

    if (def.testcases) {
      const setEntries = Object.entries(def.testcases);
      for (const [index, [setName, setDef]] of setEntries.entries()) {
        // Subtask weight must be >= 1 (subtaskResultItemSchema rejects 0), so the
        // judge's executeSandbox result validates. Samples carry a minimal weight
        // of 1 (vs the scored set's 100) — a correct solution still earns full
        // marks, and a samples-only pass earns only the 1-point floor.
        const weight = setDef.weight ?? (setName === "sample" ? 1 : 100);
        const testcaseSet = await prisma.testcaseSet.upsert({
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

        await prisma.testcase.deleteMany({
          where: { testcaseSetId: testcaseSet.id },
        });

        const testcaseIds = setDef.cases.map(() => randomUUID());
        await Promise.all(
          setDef.cases.flatMap((tc, caseIndex) => {
            const id = testcaseIds[caseIndex]!;
            return [
              putText(storage, testcaseInputKey(problem.id, id), tc.input),
              putText(storage, testcaseOutputKey(problem.id, id), tc.output),
            ];
          }),
        );
        await prisma.testcase.createMany({
          data: setDef.cases.map((_tc, caseIndex) => {
            const id = testcaseIds[caseIndex]!;
            return {
              id,
              ordinal: caseIndex + 1,
              testcaseSetId: testcaseSet.id,
              inputKey: testcaseInputKey(problem.id, id),
              outputKey: testcaseOutputKey(problem.id, id),
            };
          }),
        });
      }
    }

    if (def.workspaceFiles && def.workspaceFiles.length > 0) {
      await prisma.problemWorkspaceFile.deleteMany({
        where: { problemId: problem.id },
      });
      const fileIds = def.workspaceFiles.map(() => randomUUID());
      await Promise.all(
        def.workspaceFiles.map((wf, i) =>
          putText(storage, workspaceFileKey(problem.id, fileIds[i]!), wf.content),
        ),
      );
      await prisma.problemWorkspaceFile.createMany({
        data: def.workspaceFiles.map((wf, i) => ({
          id: fileIds[i]!,
          problemId: problem.id,
          language: wf.language,
          path: wf.path,
          contentKey: workspaceFileKey(problem.id, fileIds[i]!),
          visibility: wf.visibility,
          description: wf.description ?? "",
          orderIndex: wf.orderIndex ?? 0,
        })),
      });
    }

    const testcaseSetCount = def.testcases ? Object.keys(def.testcases).length : 0;
    const extras: string[] = [];
    if (def.samples?.length) extras.push(`${def.samples.length} samples`);
    if (def.workspaceFiles?.length) extras.push(`${def.workspaceFiles.length} workspace files`);
    const extrasLabel = extras.length ? `, ${extras.join(", ")}` : "";
    console.log(
      `  Problem: ${def.id} [${def.type}] (${Object.keys(def.statements).join(", ")} statements, ${testcaseSetCount} testcase sets${extrasLabel})`,
    );
  }
}

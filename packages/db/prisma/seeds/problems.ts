import { randomUUID } from "node:crypto";

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

// Seed defs still list difficulty inside `tags` for brevity — split it out
// into the dedicated column at upsert time so `tags` stays topic-only.
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
};

type SeedStatements = Record<SeedLocale, SeedStatement>;

type SeedTestcaseSets = {
  sample: SeedTestcaseSet;
  hidden: SeedTestcaseSet;
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

type SeedProblemDef = {
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
  advancedImageSource?: "registry" | "tarball";
  advancedImageRef?: string;
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
      if (!def.advancedImageRef || !def.advancedImageSource) {
        throw new Error(`special_env problem must declare image ref + source: ${def.id}`);
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

// Shape of the S3 client subset used by `putText`. Allowing injection lets
// the dry-run validator stub S3 without requiring real S3 env vars.
export type SeedStorageClient = { send: (command: unknown) => Promise<unknown> };

// Move checker/interactor script bodies to object storage and return the
// judgeConfig to persist — type + *Language + the storage key, never the
// body. Mirrors saveProblemJudgeConfig in the production domain layer.
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

export async function seedProblems(
  prisma: PrismaClient,
  teacherId: string,
  storageOverride?: SeedStorageClient,
) {
  // Single storage client shared across every blob upload below. The seed
  // script writes testcase + workspace blobs through the same primitives
  // the production domain layer uses (no parallel impl). Validator passes
  // a no-op stub so it can run without S3 env vars.
  const storage = (storageOverride ?? createStorageClient()) as ReturnType<
    typeof createStorageClient
  >;

  const problemDefs: SeedProblemDef[] = [
    {
      authorId: teacherId,
      title: "Warmup Sum",
      tags: ["easy"],
      type: "full_source" as const,
      id: "problem_warmup-sum",
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Warmup Sum",
          body: "實作經典的暖身題。從標準輸入讀取兩個整數，並將它們的總和加上換行符號後輸出。",
          inputFormat:
            "一行，包含兩個以空白分隔的整數 $a$ 和 $b$（$-2^{31} \\le a, b \\le 2^{31}-1$）。",
          outputFormat: "一行，輸出 $a + b$ 的值。",
        },
        en: {
          title: "Warmup Sum",
          body: "Implement the classic warmup judge task. Read exactly two integers from standard input and print their sum followed by a newline.",
          inputFormat:
            "A single line containing two space-separated integers $a$ and $b$ ($-2^{31} \\le a, b \\le 2^{31}-1$).",
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
      title: "Graph Docking",
      tags: ["medium"],
      type: "full_source" as const,
      id: "problem_graph-docking",
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Graph Docking",
          body: "為每艘船維護下一個可用碼頭。隱藏評審偏好使用 DSU 或貪心路徑壓縮方法。",
          inputFormat:
            "第一行一個整數 $N$（$1 \\le N \\le 10^6$），表示碼頭數量。\n\n接下來 $N$ 行，每行一個整數 $d_i$（$1 \\le d_i \\le N$），表示第 $i$ 艘船希望停靠的碼頭編號。",
          outputFormat: "一行，輸出無法成功停靠的船隻數量。",
        },
        en: {
          title: "Graph Docking",
          body: "Maintain the next available dock for each incoming ship. The hidden judge favors DSU or greedy path compression approaches.",
          inputFormat:
            "The first line contains an integer $N$ ($1 \\le N \\le 10^6$), the number of docks.\n\nThe next $N$ lines each contain an integer $d_i$ ($1 \\le d_i \\le N$), the preferred dock for the $i$-th ship.",
          outputFormat: "A single line containing the number of ships that could not dock.",
        },
      },
      samples: [
        { input: "4\n3\n4\n1\n1\n", output: "2" },
        { input: "2\n1\n2\n", output: "0" },
      ],
      testcases: {
        sample: {
          description: "1 ≤ N ≤ 6, simple verification cases.",
          cases: [
            { input: "4\n3\n4\n1\n1\n", output: "2" },
            { input: "2\n1\n2\n", output: "0" },
          ],
        },
        hidden: {
          description: "1 ≤ N ≤ 10^6, stresses DSU/path compression.",
          cases: [
            { input: "6\n5\n6\n3\n3\n2\n1\n", output: "3" },
            { input: "1\n1\n", output: "0" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Distributed Labyrinth",
      tags: ["hard"],
      type: "full_source" as const,
      id: "problem_distributed-labyrinth",
      memoryLimitMb: 512,
      timeLimitMs: 3000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Distributed Labyrinth",
          body: "在多層走廊中協調多個代理，同時保持最短路徑保證。一旦迷宮開始分支，需要高效的狀態壓縮和最短路徑推理。",
          inputFormat:
            "第一行兩個整數 $R$ 和 $C$（$1 \\le R, C \\le 1000$），表示迷宮的列數與行數。\n\n接下來 $R$ 行，每行 $C$ 個字元，`.` 表示通道，`#` 表示牆壁。\n\n起點為左上角 $(0,0)$，終點為右下角 $(R-1,C-1)$。",
          outputFormat: "一行，輸出從起點到終點的最短路徑長度。",
        },
        en: {
          title: "Distributed Labyrinth",
          body: "Coordinate multiple agents across layered corridors while preserving shortest-path guarantees. Efficient state compression and shortest-path reasoning are both required once the maze begins to branch.",
          inputFormat:
            "The first line contains two integers $R$ and $C$ ($1 \\le R, C \\le 1000$), the number of rows and columns.\n\nThe next $R$ lines each contain $C$ characters: `.` for passage and `#` for wall.\n\nThe start is at $(0,0)$ and the goal is at $(R-1,C-1)$.",
          outputFormat:
            "A single line containing the length of the shortest path from start to goal.",
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
          description: "1 ≤ R, C ≤ 1000, dense and degenerate mazes.",
          cases: [
            { input: "5 5\n.....\n.###.\n.#.#.\n.###.\n.....\n", output: "8" },
            { input: "1 1\n.\n", output: "0" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Process Log Parser",
      tags: ["medium"],
      type: "full_source" as const,
      id: "problem_process-log-parser",
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "private" as const,
      statements: {
        "zh-TW": {
          title: "Process Log Parser",
          body: "解析作業系統行程追蹤並輸出正規化的生命週期日誌。這是一個私有題目，僅供課程作業使用。",
          inputFormat:
            "第一行一個整數 $N$（$1 \\le N \\le 10^5$），表示事件數量。\n\n接下來 $N$ 行，每行格式為 `fork <parent> <child>`、`exit <pid>` 或 `wait <pid>`。",
          outputFormat:
            "每行一個事件的正規化描述：\n\n- `fork` 事件輸出 `<parent>-><child> forked`\n- `exit` 事件輸出 `<pid> exited`\n- `wait` 事件輸出 `<pid> waited`",
        },
        en: {
          title: "Process Log Parser",
          body: "Parse an operating-system process trace and emit a normalized lifecycle log. This private problem is meant for course-only usage.",
          inputFormat:
            "The first line contains an integer $N$ ($1 \\le N \\le 10^5$), the number of events.\n\nThe next $N$ lines each contain an event in the form `fork <parent> <child>`, `exit <pid>`, or `wait <pid>`.",
          outputFormat:
            "One line per event:\n\n- `fork` events produce `<parent>-><child> forked`\n- `exit` events produce `<pid> exited`\n- `wait` events produce `<pid> waited`",
        },
      },
      samples: [
        {
          input: "3\nfork 1 2\nexit 2\nwait 1\n",
          output: "1->2 forked\n2 exited\n1 waited\n",
        },
      ],
      testcases: {
        sample: {
          description: "1 ≤ N ≤ 5, demonstrates the event format.",
          cases: [
            {
              input: "3\nfork 1 2\nexit 2\nwait 1\n",
              output: "1->2 forked\n2 exited\n1 waited\n",
            },
          ],
        },
        hidden: {
          description: "1 ≤ N ≤ 10^5, nested fork chains.",
          cases: [
            {
              input: "5\nfork 1 2\nfork 2 3\nexit 3\nwait 2\nexit 1\n",
              output: "1->2 forked\n2->3 forked\n3 exited\n2 waited\n1 exited\n",
            },
            {
              input: "2\nfork 1 2\nexit 2\n",
              output: "1->2 forked\n2 exited\n",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Fork Bomb Safeguard",
      tags: ["hard"],
      type: "full_source" as const,
      id: "problem_fork-bomb-safeguard",
      memoryLimitMb: 512,
      timeLimitMs: 2000,
      visibility: "private" as const,
      statements: {
        "zh-TW": {
          title: "Fork Bomb Safeguard",
          body: "計算在爆發約束下行程樹的最小成本隔離策略。這個題目在課程考試中保持私有。",
          inputFormat:
            "第一行一個整數 $N$（$2 \\le N \\le 10^5$），表示行程數量。\n\n接下來 $N-1$ 行，每行兩個整數 $u$ 和 $v$，表示行程 $u$ fork 了行程 $v$。",
          outputFormat: "一行，輸出最小隔離成本。",
        },
        en: {
          title: "Fork Bomb Safeguard",
          body: "Compute the minimum cost isolation strategy for a process tree under burst constraints. This problem stays private to the course exam.",
          inputFormat:
            "The first line contains an integer $N$ ($2 \\le N \\le 10^5$), the number of processes.\n\nThe next $N-1$ lines each contain two integers $u$ and $v$, indicating process $u$ forked process $v$.",
          outputFormat: "A single line containing the minimum isolation cost.",
        },
      },
      samples: [
        { input: "4\n1 2\n1 3\n3 4\n", output: "7" },
        { input: "2\n1 2\n", output: "3" },
      ],
      testcases: {
        sample: {
          description: "Small process trees demonstrating the cost model.",
          cases: [
            { input: "4\n1 2\n1 3\n3 4\n", output: "7" },
            { input: "2\n1 2\n", output: "3" },
          ],
        },
        hidden: {
          description: "2 ≤ N ≤ 10^5, deep + wide trees.",
          cases: [
            { input: "5\n1 2\n1 3\n3 4\n3 5\n", output: "11" },
            { input: "3\n1 2\n2 3\n", output: "6" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Add Two Numbers",
      tags: ["easy"],
      type: "full_source" as const,
      id: "problem_add-two-numbers",
      memoryLimitMb: 256,
      timeLimitMs: 1000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "兩數相加",
          body: "讀入兩個整數並輸出它們的總和。",
          inputFormat:
            "一行，包含兩個以空白分隔的整數 $a$ 和 $b$（$-2^{31} \\le a, b \\le 2^{31}-1$）。",
          outputFormat: "一行，輸出 $a + b$ 的值。",
        },
        en: {
          title: "Add Two Numbers",
          body: "Read two integers from stdin and print their sum.",
          inputFormat:
            "A single line containing two space-separated integers $a$ and $b$ ($-2^{31} \\le a, b \\le 2^{31}-1$).",
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
      tags: ["easy"],
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
          inputFormat:
            "一行，包含兩個以空白分隔的正整數 $a$ 和 $b$（$1 \\le a, b \\le 10^9$）。",
          outputFormat: "一行，輸出 $a / b$ 的值。答案與預期值的絕對差須小於 $10^{-6}$。",
        },
        en: {
          title: "Float Compare",
          body: "Compute the result and output it with floating-point precision. Your answer must be within 1e-6 absolute difference of the expected value.",
          inputFormat:
            "A single line containing two space-separated positive integers $a$ and $b$ ($1 \\le a, b \\le 10^9$).",
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
      title: "Guess the Number",
      tags: ["medium"],
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
          inputFormat:
            "第一行包含兩個整數 $lo$ 和 $hi$（$1 \\le lo \\le hi \\le 10^6$），表示數字的範圍。",
          outputFormat: "每次輸出一個整數作為你的猜測。",
        },
        en: {
          title: "Guess the Number",
          body: "This is an interactive problem. The system picks a secret number and you must guess it.\\n\\nThe system first outputs the range `lo hi`. Each turn, you output a guess and the system responds with `higher` (too low), `lower` (too high), or `correct`. You have at most 20 guesses.",
          inputFormat:
            "The first line contains two integers $lo$ and $hi$ ($1 \\le lo \\le hi \\le 10^6$), the range of the number.",
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
      title: "Stateful DHCP Option Parser",
      tags: ["hard"],
      type: "multi_file" as const,
      id: "problem_stateful-dhcp-parser",
      memoryLimitMb: 256,
      timeLimitMs: 1500,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Stateful DHCP Option Parser",
          body: '這是一題多檔實作題。可執行的進入點是 `main.py`：它從標準輸入讀資料、對每行 payload 呼叫 `parse_dhcp_options(hex_payload)`，並印出結果。輸入是一串十六進位字元（每兩位代表一個 byte），內容為 DHCP option TLV 串流。\n\n`main.py` 會 `import` 唯讀的 `iolib.py`（提供 `read_payloads()` 解析 stdin）；你只需在 `main.py` 裡實作 `parse_dhcp_options`。\n\n規則：\n1. Code 0 為 padding，略過。\n2. Code 255 為 End，遇到即停止。\n3. 若長度欄位或資料不足，回傳 `["ERROR"]`。\n4. 回傳每個 TLV 的字串格式 `CODE:LEN:VALUE`。\n5. Code 1/3/6 的 VALUE 需轉為 IPv4（每 4 bytes 一組，以逗號串接）；其他 code 以大寫十六進位連續字串輸出。',
          inputFormat:
            "第一行一個整數 $Q$，接著有 $Q$ 行 hex payload。每行都會呼叫一次 `parse_dhcp_options`。",
          outputFormat: "每筆 payload 輸出一行。若回傳列表為 `[a, b, c]`，則輸出 `a|b|c`。",
        },
        en: {
          title: "Stateful DHCP Option Parser",
          body: 'A multi-file problem. The runnable entry point is `main.py`: it reads stdin, calls `parse_dhcp_options(hex_payload)` once per payload line, and prints the result. The input is a hexadecimal string (2 chars per byte) representing a DHCP option TLV stream.\n\n`main.py` imports the read-only `iolib.py` (which provides `read_payloads()` to parse stdin); you only implement `parse_dhcp_options` in `main.py`.\n\nRules:\n1. Code 0 is padding and must be skipped.\n2. Code 255 is End and terminates parsing.\n3. If length/data is malformed, return `["ERROR"]`.\n4. Return each TLV entry as `CODE:LEN:VALUE`.\n5. For codes 1/3/6, VALUE must be formatted as IPv4 addresses (4-byte chunks joined by commas); for other codes, output uppercase contiguous hex.',
          inputFormat:
            "The first line contains an integer $Q$, followed by $Q$ payload lines. Each line is passed once to `parse_dhcp_options`.",
          outputFormat:
            "Print one line per payload. A returned list `[a, b, c]` must be printed as `a|b|c`.",
        },
      },
      samples: [
        {
          input: "2\n0104C0A8010103040A000001FF\n0108C0A80101C0A80102FF\n",
          output: "1:4:192.168.1.1|3:4:10.0.0.1\n1:8:192.168.1.1,192.168.1.2",
        },
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content: `from typing import List

from iolib import read_payloads


def parse_dhcp_options(hex_payload: str) -> List[str]:
    """Parse a DHCP option TLV stream into CODE:LEN:VALUE entries.

    Rules:
      - Code 0 is padding (skip).
      - Code 255 is End (stop).
      - On malformed input return ["ERROR"].
      - Codes 1/3/6 -> IPv4 dotted groups joined by commas.
      - Other codes -> uppercase contiguous hex.
    """
    # implement parse_dhcp_options here
    return ["ERROR"]


def main() -> None:
    for payload in read_payloads():
        print("|".join(parse_dhcp_options(payload)))


if __name__ == "__main__":
    main()
`,
          visibility: "editable",
          description:
            "The runnable entry. main() reads payloads via iolib.read_payloads and prints each parse_dhcp_options result with '|' separators. Implement parse_dhcp_options here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "iolib.py",
          content: `"""Read-only I/O helper for the DHCP option parser.

Do NOT modify. main.py imports read_payloads to turn the stdin stream
into the list of hex payload strings to parse.
"""

import sys
from typing import List


def read_payloads() -> List[str]:
    """Return the Q payload lines from stdin (empty list on bad count)."""
    data = sys.stdin.read().splitlines()
    if not data:
        return []
    try:
        q = int(data[0])
    except ValueError:
        return []
    return [line.strip() for line in data[1 : 1 + q]]
`,
          visibility: "readonly",
          description:
            "Read-only stdin helper. Provides read_payloads(), which main.py imports to get the list of hex payloads. You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "Single sample exercising IPv4 + Ethernet codes.",
          cases: [
            {
              input: "2\n0104C0A8010103040A000001FF\n0108C0A80101C0A80102FF\n",
              output: "1:4:192.168.1.1|3:4:10.0.0.1\n1:8:192.168.1.1,192.168.1.2",
            },
          ],
        },
        hidden: {
          description: "Malformed payloads, multi-byte non-IP values, padding handling.",
          cases: [
            {
              input: "2\n0C066E6F6A762D31FF\n0104C0A801\n",
              output: "12:6:6E6F6A762D31\nERROR",
            },
            {
              input: "1\n00000608C0A80101C0A801FEFF\n",
              output: "6:8:192.168.1.1,192.168.1.254",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Memory Leak Forensics",
      tags: ["hard"],
      type: "multi_file" as const,
      id: "problem_memory-leak-forensics",
      memoryLimitMb: 256,
      timeLimitMs: 2000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Memory Leak Forensics",
          body: "這是一題多檔實作題。可執行的進入點是 `main.py`：它從標準輸入讀事件、呼叫 `analyze_trace(events)`，並印出三個整數。每個事件格式為：\n- `ALLOC <id> <size>`\n- `FREE <id>`\n\n`main.py` 會 `import` 唯讀的 `iolib.py`（提供 `read_events()` 解析 stdin）；你只需在 `main.py` 裡實作 `analyze_trace`。\n\n同一 `id` 重複 ALLOC 視為先前未釋放（覆蓋前請先計入洩漏），FREE 不存在的 `id` 視為 invalid free。\n\n回傳 `(peak_bytes, leaked_blocks, invalid_free_count)`。",
          inputFormat: "第一行一個整數 $N$，再讀 $N$ 行事件。",
          outputFormat: "輸出三個整數：`peak_bytes leaked_blocks invalid_free_count`。",
        },
        en: {
          title: "Memory Leak Forensics",
          body: "A multi-file problem. The runnable entry point is `main.py`: it reads stdin, calls `analyze_trace(events)`, and prints three integers. Each event is one of:\n- `ALLOC <id> <size>`\n- `FREE <id>`\n\n`main.py` imports the read-only `iolib.py` (which provides `read_events()` to parse stdin); you only implement `analyze_trace` in `main.py`.\n\nIf an `id` is allocated again before being freed, treat the old block as leaked before overwrite. Freeing a non-existing `id` counts as an invalid free.\n\nReturn `(peak_bytes, leaked_blocks, invalid_free_count)`.",
          inputFormat: "The first line contains an integer $N$, then $N$ event lines follow.",
          outputFormat: "Print three integers: `peak_bytes leaked_blocks invalid_free_count`.",
        },
      },
      samples: [
        {
          input: "6\nALLOC a 16\nALLOC b 32\nFREE a\nALLOC a 8\nFREE b\nFREE a\n",
          output: "48 0 0",
        },
        {
          input: "5\nALLOC x 10\nALLOC x 5\nFREE y\nFREE x\nFREE x\n",
          output: "10 1 2",
        },
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content: `from typing import Iterable, Tuple

from iolib import read_events


def analyze_trace(events: Iterable[str]) -> Tuple[int, int, int]:
    """Return (peak_bytes, leaked_blocks, invalid_free_count).

    Events are strings of the form 'ALLOC <id> <size>' or 'FREE <id>'.
    Re-allocating a live id leaks the prior block. Freeing an unknown
    id counts as an invalid free and does not crash.
    """
    # implement analyze_trace here
    return (0, 0, 0)


def main() -> None:
    peak, leaked, invalid = analyze_trace(read_events())
    print(f"{peak} {leaked} {invalid}")


if __name__ == "__main__":
    main()
`,
          visibility: "editable",
          description:
            "The runnable entry. main() reads the event lines via iolib.read_events and prints the three integers analyze_trace returns. Implement analyze_trace here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "iolib.py",
          content: `"""Read-only I/O helper for Memory Leak Forensics.

Do NOT modify. main.py imports read_events to turn the stdin trace into
the list of N event lines analyze_trace expects.
"""

import sys
from typing import List


def read_events() -> List[str]:
    """Return the N event lines from stdin (empty list on bad count)."""
    data = sys.stdin.read().splitlines()
    if not data:
        return []
    try:
        n = int(data[0])
    except ValueError:
        return []
    return data[1 : 1 + n]
`,
          visibility: "readonly",
          description:
            "Read-only stdin helper. Provides read_events(), which main.py imports to get the event lines. You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "Sample event streams covering basic and re-alloc-leak cases.",
          cases: [
            {
              input: "6\nALLOC a 16\nALLOC b 32\nFREE a\nALLOC a 8\nFREE b\nFREE a\n",
              output: "48 0 0",
            },
            {
              input: "5\nALLOC x 10\nALLOC x 5\nFREE y\nFREE x\nFREE x\n",
              output: "10 1 2",
            },
          ],
        },
        hidden: {
          description: "Mixed traces with peak tracking, leaks, and invalid frees.",
          cases: [
            {
              input:
                "8\nALLOC p1 100\nALLOC p2 200\nFREE p1\nALLOC p3 50\nALLOC p2 30\nFREE p3\nFREE p9\nFREE p2\n",
              output: "300 1 1",
            },
            {
              input: "4\nFREE z\nALLOC z 1\nALLOC z 2\nALLOC z 3\n",
              output: "3 2 1",
            },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Multi-File Mean (Checker)",
      tags: ["medium"],
      type: "multi_file" as const,
      id: "problem_multi-checker-stats",
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
          title: "Multi-File Mean (Checker)",
          body: "這是一題「多檔 × 自訂 checker」示範題。可執行的進入點是 `main.py`：它讀入 $N$ 與 $N$ 個整數，`import` 唯讀的 `stats.py`（提供 `mean(values)`），並以 6 位小數印出平均值。\n\n判題使用自訂 checker：只要你的答案與標準答案的絕對誤差小於 $10^{-6}$ 即視為正確。你只需在 `main.py` 裡完成讀檔與輸出。",
          inputFormat:
            "第一行一個整數 $N$（$1 \\le N \\le 10^5$），接著有 $N$ 個整數（可跨多行，以空白分隔）。",
          outputFormat: "一行，輸出這 $N$ 個整數的平均值。與標準答案絕對誤差須小於 $10^{-6}$。",
        },
        en: {
          title: "Multi-File Mean (Checker)",
          body: "A multi_file × custom-checker demo problem. The runnable entry point is `main.py`: it reads $N$ and $N$ integers, imports the read-only `stats.py` (which provides `mean(values)`), and prints the mean to 6 decimal places.\n\nGrading uses a custom checker: any answer within $10^{-6}$ absolute error of the reference is accepted. You only complete the read + print logic in `main.py`.",
          inputFormat:
            "The first line contains an integer $N$ ($1 \\le N \\le 10^5$), followed by $N$ integers (whitespace-separated, possibly across multiple lines).",
          outputFormat:
            "A single line containing the mean of the $N$ integers. Must be within $10^{-6}$ absolute error of the reference.",
        },
      },
      samples: [
        { input: "5\n1 2 3 4 5\n", output: "3.000000" },
        { input: "3\n1 2 4\n", output: "2.333333" },
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content: `import sys
from typing import List

from stats import mean


def read_numbers() -> List[float]:
    """Read N then N integers from stdin and return them as floats."""
    # implement reading: first token is the count N, then N integers
    tokens = sys.stdin.read().split()
    if not tokens:
        return []
    n = int(tokens[0])
    return [float(t) for t in tokens[1 : 1 + n]]


def main() -> None:
    numbers = read_numbers()
    print(f"{mean(numbers):.6f}")


if __name__ == "__main__":
    main()
`,
          visibility: "editable",
          description:
            "The runnable entry. main() reads the numbers, averages them via stats.mean, and prints the mean to 6 dp. Implement read_numbers here.",
          orderIndex: 0,
        },
        {
          language: "python",
          path: "stats.py",
          content: `"""Read-only statistics helper.

Do NOT modify. main.py imports mean to average the parsed numbers.
"""

from typing import Sequence


def mean(values: Sequence[float]) -> float:
    """Return the arithmetic mean of values (0.0 for an empty input)."""
    if not values:
        return 0.0
    return sum(values) / len(values)
`,
          visibility: "readonly",
          description:
            "Read-only helper. Provides mean(values), which main.py imports. You don't need to touch this file.",
          orderIndex: 1,
        },
      ],
      testcases: {
        sample: {
          description: "Public sample cases for the float-mean checker.",
          cases: [
            { input: "5\n1 2 3 4 5\n", output: "3.000000" },
            { input: "3\n1 2 4\n", output: "2.333333" },
          ],
        },
        hidden: {
          description: "Hidden cases graded by the abs-diff < 1e-6 checker.",
          cases: [
            { input: "1\n7\n", output: "7.000000" },
            { input: "4\n-2 -1 1 2\n", output: "0.000000" },
            { input: "6\n10 20 30 40 50 65\n", output: "35.833333" },
          ],
        },
      },
    },
    {
      authorId: teacherId,
      title: "Multi-File Bisect (Interactive)",
      tags: ["medium"],
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
      tags: ["hard"],
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
      title: "Shell Scripting Lab",
      tags: ["medium"],
      type: "special_env" as const,
      id: "problem_shell-scripting-lab",
      memoryLimitMb: 512,
      timeLimitMs: 30_000,
      visibility: "public" as const,
      advancedImageSource: "registry" as const,
      advancedImageRef: "nojv-demo-judge-shell:local",
      statements: {
        "zh-TW": {
          title: "Shell Scripting Lab",
          body: '這是一道 Advanced Mode 題目。請上傳一個名為 `main.sh` 的 shell 腳本，系統會把檔案放到 `/workspace/submission/`。\n\n判題容器（demo image `nojv-demo-judge-shell:local`，請先 `pnpm demo-judge:build` 建好）會執行你的 `main.sh`：只要它成功跑完、且標準輸出中包含字串 `hello` 即判定 AC，否則 WA；找不到 `main.sh` 則為 RE。\n\n範例 `main.sh`：\n\n```bash\n#!/bin/bash\necho "hello from $(whoami)"\n```',
          inputFormat: "（無 stdin；判題映像檔執行你上傳的 `main.sh`。）",
          outputFormat: "（你的 `main.sh` 標準輸出需包含 `hello`。）",
        },
        en: {
          title: "Shell Scripting Lab",
          body: 'Advanced Mode demo problem. Upload a shell script named `main.sh`; the system mounts it under `/workspace/submission/`.\n\nThe judge container (demo image `nojv-demo-judge-shell:local`, build it first with `pnpm demo-judge:build`) runs your `main.sh`: if it finishes successfully and its stdout contains the token `hello`, the verdict is AC; otherwise WA. A missing `main.sh` is RE.\n\nExample `main.sh`:\n\n```bash\n#!/bin/bash\necho "hello from $(whoami)"\n```',
          inputFormat: "(No stdin; the judge image runs your uploaded `main.sh`.)",
          outputFormat: "(Your `main.sh` stdout must contain the token `hello`.)",
        },
      },
    },
  ];

  validateProblemDefinitions(problemDefs);

  for (const def of problemDefs) {
    // Validator script bodies move to object storage; the persisted
    // judgeConfig keeps only the storage key. Upload first (S3 before DB),
    // same flow as the production save path.
    const judgeConfig = await persistJudgeConfig(storage, def.id, def.judgeConfig);

    const sharedFields = {
      title: def.title,
      difficulty: pickSeedDifficulty(def.tags),
      tags: stripDifficultyTags(def.tags),
      type: def.type,
      judgeConfig,
      status: def.status ?? "published",
      samples: toSamplesJson(def.samples),
      advancedImageRef: def.advancedImageRef ?? null,
      advancedImageSource: def.advancedImageSource ?? null,
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

    // Upsert statements for each locale
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

    // Upsert testcase sets (standard types only — special_env has no
    // system-managed testcases; the TA image bundles everything).
    if (def.testcases) {
      const setEntries = Object.entries(def.testcases);
      for (const [index, [setName, setDef]] of setEntries.entries()) {
        const testcaseSet = await prisma.testcaseSet.upsert({
          create: {
            name: setName,
            description: setDef.description ?? "",
            ordinal: index,
            problemId: problem.id,
            weight: 1,
          },
          update: {
            description: setDef.description ?? "",
            ordinal: index,
          },
          where: {
            problemId_name: {
              name: setName,
              problemId: problem.id,
            },
          },
        });

        // Delete existing testcases and re-create for idempotency. The
        // matching S3 blobs from a previous run, if any, are overwritten
        // below since each new testcase gets a fresh id (and thus a
        // fresh S3 key). Old objects become orphans — fine for seed.
        await prisma.testcase.deleteMany({
          where: { testcaseSetId: testcaseSet.id },
        });

        // S3 first, single createMany after — same write order as the
        // production domain mutation.
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

    // Upsert workspace files (multi-file scaffolds + hidden helpers).
    if (def.workspaceFiles && def.workspaceFiles.length > 0) {
      await prisma.problemWorkspaceFile.deleteMany({
        where: { problemId: problem.id },
      });
      // S3 first, then createMany — same flow as production. Orphan
      // blobs from previous seed runs (if any) are tolerable.
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

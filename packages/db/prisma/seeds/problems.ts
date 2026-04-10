import type { PrismaClient } from "../../generated/prisma/client";

type SeedLocale = "en" | "zh-TW";

type SeedStatement = {
  title: string;
  body: string;
  inputFormat?: string;
  outputFormat?: string;
};

type SeedTestcase = {
  stdin: string;
  expectedStdout: string;
};

type SeedTestcaseSet = {
  cases: SeedTestcase[];
};

type SeedStatements = Record<SeedLocale, SeedStatement>;

type SeedTestcaseSets = {
  sample: SeedTestcaseSet;
  hidden: SeedTestcaseSet;
};

type SeedSubmissionType = "full_source" | "function" | "zip_project";

type SeedProblemMode = "standard" | "advanced";

type SeedWorkspaceFile = {
  language: "python" | "c" | "cpp" | "go" | "java" | "javascript" | "rust" | "typescript";
  path: string;
  content: string;
  visibility: "editable" | "readonly" | "hidden";
  editableRegions?: [number, number][] | null;
  description?: string;
  orderIndex?: number;
};

type SeedAdvancedTestcase = {
  stdin: string;
  expected: string;
  files: Record<string, string>;
};

type SeedProblemSample = {
  stdin: string;
  expected: string;
};

type SeedAdvancedResourceLimits = {
  totalTimeMs: number;
  memoryMb: number;
  networkEnabled: boolean;
};

type SeedProblemDef = {
  authorId: string;
  defaultTitle: string;
  difficulty: string;
  id: string;
  memoryLimitMb: number;
  summary: string;
  timeLimitMs: number;
  visibility: "public" | "private";
  statements: SeedStatements;
  testcases?: SeedTestcaseSets;
  submissionType?: SeedSubmissionType;
  judgeConfig?: Record<string, unknown>;
  status?: "draft" | "published";
  samples?: SeedProblemSample[];
  workspaceFiles?: SeedWorkspaceFile[];
  mode?: SeedProblemMode;
  advancedImageSource?: "registry" | "tarball";
  advancedImageRef?: string;
  advancedResourceLimits?: SeedAdvancedResourceLimits;
  advancedTestcases?: SeedAdvancedTestcase[];
};

const hardenedIds = [
  "problem_stateful-dhcp-parser",
  "problem_memory-leak-forensics",
  "problem_noisy-oracle-hunt"
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

    if (def.mode === "advanced") {
      if (!def.advancedTestcases || def.advancedTestcases.length === 0) {
        throw new Error(`Advanced-mode problem must declare advancedTestcases: ${def.id}`);
      }
      if (!def.advancedImageRef || !def.advancedImageSource) {
        throw new Error(`Advanced-mode problem must declare image ref + source: ${def.id}`);
      }
    } else {
      if (!def.testcases) {
        throw new Error(`Standard-mode problem must declare testcases: ${def.id}`);
      }
      if (def.testcases.sample.cases.length === 0 || def.testcases.hidden.cases.length === 0) {
        throw new Error(`Sample/hidden testcase sets must be non-empty: ${def.id}`);
      }
    }

    if (def.judgeConfig) {
      const config = def.judgeConfig;
      if (config.type === "checker" && !(config.checkerScript as string)?.trim()) {
        throw new Error(`Checker judge requires checkerScript in judgeConfig: ${def.id}`);
      }
      if (config.type === "interactive" && !(config.interactorScript as string)?.trim()) {
        throw new Error(
          `Interactive judge requires interactorScript in judgeConfig: ${def.id}`
        );
      }
    }
  }

  for (const id of hardenedIds) {
    const def = problemDefs.find((entry) => entry.id === id);
    if (!def) {
      throw new Error(`Missing hardened seed problem: ${id}`);
    }
    if (def.difficulty !== "hard") {
      throw new Error(`Hardened problem must be hard difficulty: ${id}`);
    }
  }
}

export async function seedProblems(prisma: PrismaClient, teacherId: string) {
  const problemDefs: SeedProblemDef[] = [
    {
      authorId: teacherId,
      defaultTitle: "Warmup Sum",
      difficulty: "easy",
      id: "problem_warmup-sum",
      memoryLimitMb: 256,
      summary:
        "The sandbox-backed testcase judge uses this task to exercise the editor, queue, and submission lifecycle.",
      timeLimitMs: 1000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Warmup Sum",
          body: "實作經典的暖身題。從標準輸入讀取兩個整數，並將它們的總和加上換行符號後輸出。",
          inputFormat:
            "一行，包含兩個以空白分隔的整數 $a$ 和 $b$（$-2^{31} \\le a, b \\le 2^{31}-1$）。",
          outputFormat: "一行，輸出 $a + b$ 的值。"
        },
        en: {
          title: "Warmup Sum",
          body: "Implement the classic warmup judge task. Read exactly two integers from standard input and print their sum followed by a newline.",
          inputFormat:
            "A single line containing two space-separated integers $a$ and $b$ ($-2^{31} \\le a, b \\le 2^{31}-1$).",
          outputFormat: "A single line containing the value of $a + b$."
        }
      },
      samples: [
        { stdin: "2 5", expected: "7" },
        { stdin: "0 0", expected: "0" }
      ],
      testcases: {
        sample: {
          cases: [
            { stdin: "2 5", expectedStdout: "7" },
            { stdin: "0 0", expectedStdout: "0" },
            { stdin: "-3 7", expectedStdout: "4" }
          ]
        },
        hidden: {
          cases: [
            { stdin: "1000000 999999", expectedStdout: "1999999" },
            { stdin: "-100 -200", expectedStdout: "-300" },
            { stdin: "2147483646 1", expectedStdout: "2147483647" }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Graph Docking",
      difficulty: "medium",
      id: "problem_graph-docking",
      memoryLimitMb: 256,
      summary: "A medium problem used to show richer catalog metadata on the problem page.",
      timeLimitMs: 2000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Graph Docking",
          body: "為每艘船維護下一個可用碼頭。隱藏評審偏好使用 DSU 或貪心路徑壓縮方法。",
          inputFormat:
            "第一行一個整數 $N$（$1 \\le N \\le 10^6$），表示碼頭數量。\n\n接下來 $N$ 行，每行一個整數 $d_i$（$1 \\le d_i \\le N$），表示第 $i$ 艘船希望停靠的碼頭編號。",
          outputFormat: "一行，輸出無法成功停靠的船隻數量。"
        },
        en: {
          title: "Graph Docking",
          body: "Maintain the next available dock for each incoming ship. The hidden judge favors DSU or greedy path compression approaches.",
          inputFormat:
            "The first line contains an integer $N$ ($1 \\le N \\le 10^6$), the number of docks.\n\nThe next $N$ lines each contain an integer $d_i$ ($1 \\le d_i \\le N$), the preferred dock for the $i$-th ship.",
          outputFormat: "A single line containing the number of ships that could not dock."
        }
      },
      samples: [
        { stdin: "4\n3\n4\n1\n1\n", expected: "2" },
        { stdin: "2\n1\n2\n", expected: "0" }
      ],
      testcases: {
        sample: {
          cases: [
            { stdin: "4\n3\n4\n1\n1\n", expectedStdout: "2" },
            { stdin: "2\n1\n2\n", expectedStdout: "0" }
          ]
        },
        hidden: {
          cases: [
            { stdin: "6\n5\n6\n3\n3\n2\n1\n", expectedStdout: "3" },
            { stdin: "1\n1\n", expectedStdout: "0" }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Distributed Labyrinth",
      difficulty: "hard",
      id: "problem_distributed-labyrinth",
      memoryLimitMb: 512,
      summary:
        "A hard graph problem that showcases the catalog's ability to carry richer editorial metadata and higher-difficulty workloads.",
      timeLimitMs: 3000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Distributed Labyrinth",
          body: "在多層走廊中協調多個代理，同時保持最短路徑保證。一旦迷宮開始分支，需要高效的狀態壓縮和最短路徑推理。",
          inputFormat:
            "第一行兩個整數 $R$ 和 $C$（$1 \\le R, C \\le 1000$），表示迷宮的列數與行數。\n\n接下來 $R$ 行，每行 $C$ 個字元，`.` 表示通道，`#` 表示牆壁。\n\n起點為左上角 $(0,0)$，終點為右下角 $(R-1,C-1)$。",
          outputFormat: "一行，輸出從起點到終點的最短路徑長度。"
        },
        en: {
          title: "Distributed Labyrinth",
          body: "Coordinate multiple agents across layered corridors while preserving shortest-path guarantees. Efficient state compression and shortest-path reasoning are both required once the maze begins to branch.",
          inputFormat:
            "The first line contains two integers $R$ and $C$ ($1 \\le R, C \\le 1000$), the number of rows and columns.\n\nThe next $R$ lines each contain $C$ characters: `.` for passage and `#` for wall.\n\nThe start is at $(0,0)$ and the goal is at $(R-1,C-1)$.",
          outputFormat:
            "A single line containing the length of the shortest path from start to goal."
        }
      },
      samples: [
        { stdin: "3 3\n...\n.#.\n...\n", expected: "4" },
        { stdin: "2 2\n..\n..\n", expected: "2" }
      ],
      testcases: {
        sample: {
          cases: [
            { stdin: "3 3\n...\n.#.\n...\n", expectedStdout: "4" },
            { stdin: "2 2\n..\n..\n", expectedStdout: "2" }
          ]
        },
        hidden: {
          cases: [
            { stdin: "5 5\n.....\n.###.\n.#.#.\n.###.\n.....\n", expectedStdout: "8" },
            { stdin: "1 1\n.\n", expectedStdout: "0" }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Process Log Parser",
      difficulty: "medium",
      id: "problem_process-log-parser",
      memoryLimitMb: 256,
      summary:
        "A private course problem for assignments where the public catalog should not reveal the prompt.",
      timeLimitMs: 1000,
      visibility: "private" as const,
      statements: {
        "zh-TW": {
          title: "Process Log Parser",
          body: "解析作業系統行程追蹤並輸出正規化的生命週期日誌。這是一個私有題目，僅供課程作業使用。",
          inputFormat:
            "第一行一個整數 $N$（$1 \\le N \\le 10^5$），表示事件數量。\n\n接下來 $N$ 行，每行格式為 `fork <parent> <child>`、`exit <pid>` 或 `wait <pid>`。",
          outputFormat:
            "每行一個事件的正規化描述：\n\n- `fork` 事件輸出 `<parent>-><child> forked`\n- `exit` 事件輸出 `<pid> exited`\n- `wait` 事件輸出 `<pid> waited`"
        },
        en: {
          title: "Process Log Parser",
          body: "Parse an operating-system process trace and emit a normalized lifecycle log. This private problem is meant for course-only usage.",
          inputFormat:
            "The first line contains an integer $N$ ($1 \\le N \\le 10^5$), the number of events.\n\nThe next $N$ lines each contain an event in the form `fork <parent> <child>`, `exit <pid>`, or `wait <pid>`.",
          outputFormat:
            "One line per event:\n\n- `fork` events produce `<parent>-><child> forked`\n- `exit` events produce `<pid> exited`\n- `wait` events produce `<pid> waited`"
        }
      },
      samples: [
        {
          stdin: "3\nfork 1 2\nexit 2\nwait 1\n",
          expected: "1->2 forked\n2 exited\n1 waited\n"
        }
      ],
      testcases: {
        sample: {
          cases: [
            {
              stdin: "3\nfork 1 2\nexit 2\nwait 1\n",
              expectedStdout: "1->2 forked\n2 exited\n1 waited\n"
            }
          ]
        },
        hidden: {
          cases: [
            {
              stdin: "5\nfork 1 2\nfork 2 3\nexit 3\nwait 2\nexit 1\n",
              expectedStdout: "1->2 forked\n2->3 forked\n3 exited\n2 waited\n1 exited\n"
            },
            {
              stdin: "2\nfork 1 2\nexit 2\n",
              expectedStdout: "1->2 forked\n2 exited\n"
            }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Fork Bomb Safeguard",
      difficulty: "hard",
      id: "problem_fork-bomb-safeguard",
      memoryLimitMb: 512,
      summary: "A private exam problem that should only surface inside a course assessment.",
      timeLimitMs: 2000,
      visibility: "private" as const,
      statements: {
        "zh-TW": {
          title: "Fork Bomb Safeguard",
          body: "計算在爆發約束下行程樹的最小成本隔離策略。這個題目在課程考試中保持私有。",
          inputFormat:
            "第一行一個整數 $N$（$2 \\le N \\le 10^5$），表示行程數量。\n\n接下來 $N-1$ 行，每行兩個整數 $u$ 和 $v$，表示行程 $u$ fork 了行程 $v$。",
          outputFormat: "一行，輸出最小隔離成本。"
        },
        en: {
          title: "Fork Bomb Safeguard",
          body: "Compute the minimum cost isolation strategy for a process tree under burst constraints. This problem stays private to the course exam.",
          inputFormat:
            "The first line contains an integer $N$ ($2 \\le N \\le 10^5$), the number of processes.\n\nThe next $N-1$ lines each contain two integers $u$ and $v$, indicating process $u$ forked process $v$.",
          outputFormat: "A single line containing the minimum isolation cost."
        }
      },
      samples: [
        { stdin: "4\n1 2\n1 3\n3 4\n", expected: "7" },
        { stdin: "2\n1 2\n", expected: "3" }
      ],
      testcases: {
        sample: {
          cases: [
            { stdin: "4\n1 2\n1 3\n3 4\n", expectedStdout: "7" },
            { stdin: "2\n1 2\n", expectedStdout: "3" }
          ]
        },
        hidden: {
          cases: [
            { stdin: "5\n1 2\n1 3\n3 4\n3 5\n", expectedStdout: "11" },
            { stdin: "3\n1 2\n2 3\n", expectedStdout: "6" }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Add Two Numbers",
      difficulty: "easy",
      id: "problem_add-two-numbers",
      memoryLimitMb: 256,
      submissionType: "function" as const,
      summary: "Write a function that adds two integers.",
      timeLimitMs: 1000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "兩數相加",
          body: "撰寫一個函式，接收兩個整數並回傳它們的總和。",
          inputFormat:
            "一行，包含兩個以空白分隔的整數 $a$ 和 $b$（$-2^{31} \\le a, b \\le 2^{31}-1$）。",
          outputFormat: "一行，輸出 $a + b$ 的值。"
        },
        en: {
          title: "Add Two Numbers",
          body: "Write a function that takes two integers and returns their sum.",
          inputFormat:
            "A single line containing two space-separated integers $a$ and $b$ ($-2^{31} \\le a, b \\le 2^{31}-1$).",
          outputFormat: "A single line containing the value of $a + b$."
        }
      },
      samples: [
        { stdin: "1 2", expected: "3" },
        { stdin: "0 0", expected: "0" }
      ],
      testcases: {
        sample: {
          cases: [
            { stdin: "1 2", expectedStdout: "3" },
            { stdin: "0 0", expectedStdout: "0" },
            { stdin: "-1 1", expectedStdout: "0" }
          ]
        },
        hidden: {
          cases: [
            { stdin: "1000000 999999", expectedStdout: "1999999" },
            { stdin: "-500 -700", expectedStdout: "-1200" },
            { stdin: "2147483646 1", expectedStdout: "2147483647" }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Float Compare",
      difficulty: "easy",
      id: "problem_float-compare",
      memoryLimitMb: 256,
      submissionType: "full_source" as const,
      judgeConfig: {
        type: "checker",
        checkerScript: `import sys

def main():
    input_path, expected_path, user_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(expected_path) as f:
        expected = float(f.read().strip())
    with open(user_path) as f:
        actual = float(f.read().strip())
    if abs(expected - actual) < 1e-6:
        print("100")
        sys.exit(0)
    else:
        print(f"Expected {expected}, got {actual}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
`
      },
      summary: "Compute the result with floating-point precision.",
      timeLimitMs: 1000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "浮點數比較",
          body: "計算結果並以浮點數精度輸出。答案與預期值的絕對差必須小於 1e-6。",
          inputFormat:
            "一行，包含兩個以空白分隔的正整數 $a$ 和 $b$（$1 \\le a, b \\le 10^9$）。",
          outputFormat: "一行，輸出 $a / b$ 的值。答案與預期值的絕對差須小於 $10^{-6}$。"
        },
        en: {
          title: "Float Compare",
          body: "Compute the result and output it with floating-point precision. Your answer must be within 1e-6 absolute difference of the expected value.",
          inputFormat:
            "A single line containing two space-separated positive integers $a$ and $b$ ($1 \\le a, b \\le 10^9$).",
          outputFormat:
            "A single line containing the value of $a / b$. Your answer must be within $10^{-6}$ absolute difference of the expected value."
        }
      },
      samples: [
        { stdin: "1 3", expected: "0.333333" },
        { stdin: "1 7", expected: "0.142857" }
      ],
      testcases: {
        sample: {
          cases: [
            { stdin: "1 3", expectedStdout: "0.333333" },
            { stdin: "1 7", expectedStdout: "0.142857" }
          ]
        },
        hidden: {
          cases: [
            { stdin: "2 3", expectedStdout: "0.666667" },
            { stdin: "355 113", expectedStdout: "3.141593" }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Guess the Number",
      difficulty: "medium",
      id: "problem_guess-the-number",
      memoryLimitMb: 256,
      submissionType: "full_source" as const,
      judgeConfig: {
        type: "interactive",
        interactorScript: `import sys

def main():
    # The interactor picks a secret number
    # User program must guess it using binary search
    # Protocol: interactor writes the range, user guesses, interactor responds "higher"/"lower"/"correct"

    input_path = sys.argv[1]
    with open(input_path) as f:
        secret = int(f.read().strip())

    lo, hi = 1, 1000000
    print(f"{lo} {hi}", flush=True)

    for _ in range(20):  # max 20 guesses
        line = input().strip()
        guess = int(line)

        if guess == secret:
            print("correct", flush=True)
            sys.exit(0)
        elif guess < secret:
            print("higher", flush=True)
        else:
            print("lower", flush=True)

    # Out of guesses
    print(f"Failed to guess {secret} within 20 attempts", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    main()
`
      },
      summary: "Guess a hidden number using binary search with interactive I/O.",
      timeLimitMs: 2000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "猜數字",
          body: "這是一道互動題。系統會選定一個秘密數字，你需要透過互動來猜出它。\\n\\n系統首先會輸出範圍 `lo hi`，你每次猜一個數字，系統會回應 `higher`（太小）、`lower`（太大）或 `correct`（猜對）。你最多有 20 次猜測機會。",
          inputFormat:
            "第一行包含兩個整數 $lo$ 和 $hi$（$1 \\le lo \\le hi \\le 10^6$），表示數字的範圍。",
          outputFormat: "每次輸出一個整數作為你的猜測。"
        },
        en: {
          title: "Guess the Number",
          body: "This is an interactive problem. The system picks a secret number and you must guess it.\\n\\nThe system first outputs the range `lo hi`. Each turn, you output a guess and the system responds with `higher` (too low), `lower` (too high), or `correct`. You have at most 20 guesses.",
          inputFormat:
            "The first line contains two integers $lo$ and $hi$ ($1 \\le lo \\le hi \\le 10^6$), the range of the number.",
          outputFormat: "Output one integer per line as your guess."
        }
      },
      samples: [
        { stdin: "42", expected: "" },
        { stdin: "500000", expected: "" }
      ],
      testcases: {
        sample: {
          cases: [
            { stdin: "42", expectedStdout: "" },
            { stdin: "500000", expectedStdout: "" }
          ]
        },
        hidden: {
          cases: [
            { stdin: "1", expectedStdout: "" },
            { stdin: "1000000", expectedStdout: "" },
            { stdin: "314159", expectedStdout: "" }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Stateful DHCP Option Parser",
      difficulty: "hard",
      id: "problem_stateful-dhcp-parser",
      memoryLimitMb: 256,
      submissionType: "function" as const,
      summary:
        "Implement a resilient TLV parser over DHCP option bytes with malformed-stream handling and canonical formatting.",
      timeLimitMs: 1500,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Stateful DHCP Option Parser",
          body: '這是一題函式題。你要實作 `parse_dhcp_options(hex_payload)`，輸入是一串十六進位字元（每兩位代表一個 byte），內容為 DHCP option TLV 串流。\n\n規則：\n1. Code 0 為 padding，略過。\n2. Code 255 為 End，遇到即停止。\n3. 若長度欄位或資料不足，回傳 `["ERROR"]`。\n4. 回傳每個 TLV 的字串格式 `CODE:LEN:VALUE`。\n5. Code 1/3/6 的 VALUE 需轉為 IPv4（每 4 bytes 一組，以逗號串接）；其他 code 以大寫十六進位連續字串輸出。',
          inputFormat:
            "評測 driver 會先讀入整數 $Q$，接著有 $Q$ 行 hex payload。每行都會呼叫一次 `parse_dhcp_options`。",
          outputFormat: "每筆 payload 輸出一行。若回傳列表為 `[a, b, c]`，則輸出 `a|b|c`。"
        },
        en: {
          title: "Stateful DHCP Option Parser",
          body: 'This is a function-mode problem. Implement `parse_dhcp_options(hex_payload)`, where the input is a hexadecimal string (2 chars per byte) representing a DHCP option TLV stream.\n\nRules:\n1. Code 0 is padding and must be skipped.\n2. Code 255 is End and terminates parsing.\n3. If length/data is malformed, return `["ERROR"]`.\n4. Return each TLV entry as `CODE:LEN:VALUE`.\n5. For codes 1/3/6, VALUE must be formatted as IPv4 addresses (4-byte chunks joined by commas); for other codes, output uppercase contiguous hex.',
          inputFormat:
            "The judge driver reads an integer $Q$, followed by $Q$ payload lines. Each line is passed once to `parse_dhcp_options`.",
          outputFormat:
            "Print one line per payload. A returned list `[a, b, c]` must be printed as `a|b|c`."
        }
      },
      samples: [
        {
          stdin: "2\n0104C0A8010103040A000001FF\n0108C0A80101C0A80102FF\n",
          expected: "1:4:192.168.1.1|3:4:10.0.0.1\n1:8:192.168.1.1,192.168.1.2"
        }
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content: `from typing import List


def parse_dhcp_options(hex_payload: str) -> List[str]:
    """Parse a DHCP option TLV stream.

    Rules:
      - Code 0 is padding (skip).
      - Code 255 is End (stop).
      - On malformed input return ["ERROR"].
      - Return each entry formatted as CODE:LEN:VALUE.
      - Codes 1/3/6 -> IPv4 dotted groups joined by commas.
      - Other codes -> uppercase contiguous hex.
    """
    # write your code here
    return []
`,
          visibility: "editable",
          editableRegions: [[15, 17]],
          description:
            "Implement parse_dhcp_options here. This is the file you edit; the driver and hidden smoke check import from `main`.",
          orderIndex: 0
        },
        {
          language: "python",
          path: "driver.py",
          content: `"""Read-only judge driver.

Do NOT modify. The grader reads Q payload lines and calls
parse_dhcp_options once per line, printing results with '|' separators.
"""

import sys

from main import parse_dhcp_options


def main_driver() -> None:
    data = sys.stdin.read().splitlines()
    if not data:
        return
    try:
        q = int(data[0])
    except ValueError:
        print("ERROR")
        return
    for line in data[1 : 1 + q]:
        result = parse_dhcp_options(line.strip())
        print("|".join(result))


if __name__ == "__main__":
    main_driver()
`,
          visibility: "readonly",
          editableRegions: null,
          description:
            "Judge driver — reads Q hex payloads from stdin and prints the return of parse_dhcp_options for each. You don't need to touch this file.",
          orderIndex: 1
        },
        {
          language: "python",
          path: "_hidden_smoke.py",
          content: `"""Hidden pre-flight sanity checks (not shipped to the browser).

The worker runs this before grading to weed out obvious breakage like
missing imports or return-type mistakes.
"""

from main import parse_dhcp_options


def _smoke() -> None:
    out = parse_dhcp_options("FF")
    assert isinstance(out, list), "parse_dhcp_options must return a list"
    assert all(isinstance(entry, str) for entry in out), "entries must be str"


if __name__ == "__main__":
    _smoke()
`,
          visibility: "hidden",
          editableRegions: null,
          description:
            "Hidden pre-flight sanity check run by the judge before grading. Ensures parse_dhcp_options at least returns a list of strings so a crash here fails fast with a clear signal.",
          orderIndex: 2
        }
      ],
      testcases: {
        sample: {
          cases: [
            {
              stdin: "2\n0104C0A8010103040A000001FF\n0108C0A80101C0A80102FF\n",
              expectedStdout: "1:4:192.168.1.1|3:4:10.0.0.1\n1:8:192.168.1.1,192.168.1.2"
            }
          ]
        },
        hidden: {
          cases: [
            {
              stdin: "2\n0C066E6F6A762D31FF\n0104C0A801\n",
              expectedStdout: "12:6:6E6F6A762D31\nERROR"
            },
            {
              stdin: "1\n00000608C0A80101C0A801FEFF\n",
              expectedStdout: "6:8:192.168.1.1,192.168.1.254"
            }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Memory Leak Forensics",
      difficulty: "hard",
      id: "problem_memory-leak-forensics",
      memoryLimitMb: 256,
      submissionType: "function" as const,
      summary:
        "Analyze allocator event streams and report peak allocation, leaked block count, and invalid free attempts.",
      timeLimitMs: 2000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Memory Leak Forensics",
          body: "這是一題函式題。實作 `analyze_trace(events)`，每個事件格式為：\n- `ALLOC <id> <size>`\n- `FREE <id>`\n\n同一 `id` 重複 ALLOC 視為先前未釋放（覆蓋前請先計入洩漏），FREE 不存在的 `id` 視為 invalid free。\n\n回傳 `(peak_bytes, leaked_blocks, invalid_free_count)`。",
          inputFormat:
            "評測 driver 會先讀入整數 $N$，再讀 $N$ 行事件，最後呼叫 `analyze_trace`。",
          outputFormat: "輸出三個整數：`peak_bytes leaked_blocks invalid_free_count`。"
        },
        en: {
          title: "Memory Leak Forensics",
          body: "This is a function-mode problem. Implement `analyze_trace(events)`, where each event is one of:\n- `ALLOC <id> <size>`\n- `FREE <id>`\n\nIf an `id` is allocated again before being freed, treat the old block as leaked before overwrite. Freeing a non-existing `id` counts as an invalid free.\n\nReturn `(peak_bytes, leaked_blocks, invalid_free_count)`.",
          inputFormat:
            "The judge driver reads an integer $N$, then $N$ event lines, and calls `analyze_trace`.",
          outputFormat: "Print three integers: `peak_bytes leaked_blocks invalid_free_count`."
        }
      },
      samples: [
        {
          stdin: "6\nALLOC a 16\nALLOC b 32\nFREE a\nALLOC a 8\nFREE b\nFREE a\n",
          expected: "48 0 0"
        },
        {
          stdin: "5\nALLOC x 10\nALLOC x 5\nFREE y\nFREE x\nFREE x\n",
          expected: "10 1 2"
        }
      ],
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content: `from typing import Iterable, Tuple


def analyze_trace(events: Iterable[str]) -> Tuple[int, int, int]:
    """Return (peak_bytes, leaked_blocks, invalid_free_count).

    Events are strings of the form 'ALLOC <id> <size>' or 'FREE <id>'.
    Re-allocating a live id leaks the prior block. Freeing an unknown
    id counts as an invalid free and does not crash.
    """
    # write your code here
    return (0, 0, 0)
`,
          visibility: "editable",
          editableRegions: [[11, 13]],
          description:
            "Implement analyze_trace here. The driver imports it from `main` and feeds it parsed event lines.",
          orderIndex: 0
        },
        {
          language: "python",
          path: "driver.py",
          content: `"""Read-only judge driver.

Reads N followed by N event lines from stdin and prints the three
integers returned by analyze_trace, space-separated.
"""

import sys

from main import analyze_trace


def main_driver() -> None:
    data = sys.stdin.read().splitlines()
    if not data:
        print("0 0 0")
        return
    n = int(data[0])
    events = data[1 : 1 + n]
    peak, leaked, invalid = analyze_trace(events)
    print(f"{peak} {leaked} {invalid}")


if __name__ == "__main__":
    main_driver()
`,
          visibility: "readonly",
          editableRegions: null,
          description:
            "Judge driver — parses the stdin event stream and prints the three integers your analyze_trace returns. Read-only.",
          orderIndex: 1
        }
      ],
      testcases: {
        sample: {
          cases: [
            {
              stdin: "6\nALLOC a 16\nALLOC b 32\nFREE a\nALLOC a 8\nFREE b\nFREE a\n",
              expectedStdout: "48 0 0"
            },
            {
              stdin: "5\nALLOC x 10\nALLOC x 5\nFREE y\nFREE x\nFREE x\n",
              expectedStdout: "10 1 2"
            }
          ]
        },
        hidden: {
          cases: [
            {
              stdin:
                "8\nALLOC p1 100\nALLOC p2 200\nFREE p1\nALLOC p3 50\nALLOC p2 30\nFREE p3\nFREE p9\nFREE p2\n",
              expectedStdout: "300 1 1"
            },
            {
              stdin: "4\nFREE z\nALLOC z 1\nALLOC z 2\nALLOC z 3\n",
              expectedStdout: "3 2 1"
            }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Noisy Oracle Hunt",
      difficulty: "hard",
      id: "problem_noisy-oracle-hunt",
      memoryLimitMb: 256,
      submissionType: "full_source" as const,
      judgeConfig: {
        type: "interactive",
        interactorScript: `import sys

def main():
    input_path = sys.argv[1]
    with open(input_path) as f:
        secret = int(f.read().strip())

    lo, hi = 1, 1_000_000
    max_turns = 35
    lie_period = 5

    print(f"{lo} {hi} {max_turns} {lie_period}", flush=True)

    for turn in range(1, max_turns + 1):
        line = input().strip()
        guess = int(line)

        if guess == secret:
            print("correct", flush=True)
            sys.exit(0)

        truthful = "higher" if guess < secret else "lower"
        if turn % lie_period == 0:
            truthful = "lower" if truthful == "higher" else "higher"

        print(truthful, flush=True)

    print(f"Failed to find {secret} in {max_turns} turns", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    main()
`
      },
      summary:
        "Interactive search under periodic adversarial lies: every 5th non-terminal response is inverted.",
      timeLimitMs: 2500,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Noisy Oracle Hunt",
          body: "這是一道高難互動題。你要找出區間內秘密數字，但 oracle 並非完全誠實。\n\n互動器第一行輸出：`lo hi maxTurns liePeriod`。\n你每回合輸出一個猜測整數，互動器回應：\n- `higher`：你的猜測太小\n- `lower`：你的猜測太大\n- `correct`：猜中\n\n陷阱：每逢第 `liePeriod` 回合（例如 5,10,15...），若尚未猜中，回應會故意反轉。",
          inputFormat: "互動器先輸出四個整數 `lo hi maxTurns liePeriod`。",
          outputFormat: "每回合輸出一個整數猜測，並立即 flush。"
        },
        en: {
          title: "Noisy Oracle Hunt",
          body: "This is a hard interactive problem. You must find a hidden number in range, but the oracle is not always truthful.\n\nThe interactor first prints: `lo hi maxTurns liePeriod`.\nEach turn, print one integer guess, and receive:\n- `higher`: your guess is too small\n- `lower`: your guess is too large\n- `correct`: guessed exactly\n\nTrap: on every `liePeriod`-th turn (5, 10, 15, ...), if not already correct, the response is intentionally inverted.",
          inputFormat: "The interactor first outputs `lo hi maxTurns liePeriod`.",
          outputFormat: "Print one integer guess per turn and flush immediately."
        }
      },
      samples: [
        { stdin: "42", expected: "" },
        { stdin: "777777", expected: "" }
      ],
      testcases: {
        sample: {
          cases: [
            { stdin: "42", expectedStdout: "" },
            { stdin: "777777", expectedStdout: "" }
          ]
        },
        hidden: {
          cases: [
            { stdin: "1", expectedStdout: "" },
            { stdin: "1000000", expectedStdout: "" },
            { stdin: "314159", expectedStdout: "" }
          ]
        }
      }
    },
    {
      authorId: teacherId,
      defaultTitle: "Shell Scripting Lab",
      difficulty: "medium",
      id: "problem_shell-scripting-lab",
      memoryLimitMb: 512,
      summary:
        "Advanced Mode demo: submit a ZIP of shell scripts that a TA-provided judge image runs against a scenario workspace.",
      timeLimitMs: 30_000,
      visibility: "public" as const,
      mode: "advanced" as const,
      advancedImageSource: "registry" as const,
      advancedImageRef: "ghcr.io/nojv/demo-judge-shell:latest",
      advancedResourceLimits: {
        totalTimeMs: 30_000,
        memoryMb: 512,
        networkEnabled: false
      },
      statements: {
        "zh-TW": {
          title: "Shell Scripting Lab",
          body: "這是一道 Advanced Mode 題目。請上傳一份 ZIP 檔案，內含可執行的 shell 腳本（例如 `solve.sh`）。\n\n判題容器會把 ZIP 解壓到 `/workspace/submission/`，接著進入 `/workspace/testcases/<ordinal>/` 取得輸入與輔助檔案，執行 `bash /workspace/submission/solve.sh < stdin` 並與 `expected` 比對輸出。\n\n本題用於示範 Advanced Mode 的上傳介面與 TA 自訂判題映像檔流程。",
          inputFormat:
            "每個 testcase 以 `stdin` 檔案提供標準輸入。部分 testcase 會在目錄中附上輔助檔案，腳本可透過相對路徑 `./aux.txt` 存取。",
          outputFormat: "腳本的標準輸出需與 `expected` 完全相符。"
        },
        en: {
          title: "Shell Scripting Lab",
          body: "This is an Advanced Mode problem. Upload a ZIP file containing executable shell scripts (e.g. `solve.sh`).\n\nThe judge container extracts the ZIP into `/workspace/submission/`, then iterates `/workspace/testcases/<ordinal>/`, piping `stdin` into `bash /workspace/submission/solve.sh` and comparing stdout to `expected`.\n\nThis problem exists to demonstrate the Advanced Mode ZIP upload view and the TA-provided judge image flow.",
          inputFormat:
            "Each testcase provides a `stdin` file as standard input. Some testcases additionally ship auxiliary files; the script can open them via relative paths like `./aux.txt`.",
          outputFormat: "The script\u2019s standard output must match `expected` byte-for-byte."
        }
      },
      advancedTestcases: [
        {
          stdin: "hello\nworld\n",
          expected: "HELLO\nWORLD\n",
          files: {
            "notes.txt": "uppercase each line using tr or awk"
          }
        },
        {
          stdin: "3\n1\n2\n",
          expected: "6\n",
          files: {
            "aux.txt": "sum the numbers from stdin, first line is count"
          }
        }
      ]
    }
  ];

  validateProblemDefinitions(problemDefs);

  for (const def of problemDefs) {
    const mode = def.mode ?? "standard";
    const sharedFields = {
      defaultTitle: def.defaultTitle,
      difficulty: def.difficulty,
      summary: def.summary,
      ...("submissionType" in def && { submissionType: def.submissionType }),
      judgeConfig: def.judgeConfig ?? undefined,
      status: def.status ?? "published",
      mode,
      samples: def.samples ? (def.samples as unknown as object) : undefined,
      advancedImageRef: def.advancedImageRef ?? null,
      advancedImageSource: def.advancedImageSource ?? null,
      advancedResourceLimits: def.advancedResourceLimits
        ? (def.advancedResourceLimits as unknown as object)
        : undefined
    };

    const problem = await prisma.problem.upsert({
      create: {
        authorId: def.authorId,
        id: def.id,
        memoryLimitMb: def.memoryLimitMb,
        timeLimitMs: def.timeLimitMs,
        visibility: def.visibility,
        ...sharedFields
      },
      update: sharedFields,
      where: { id: def.id }
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
          title: stmt.title
        },
        update: {
          bodyMarkdown: stmt.body,
          inputFormat: stmt.inputFormat ?? "",
          outputFormat: stmt.outputFormat ?? "",
          title: stmt.title
        },
        where: {
          problemId_locale: {
            locale,
            problemId: problem.id
          }
        }
      });
    }

    // Upsert testcase sets (standard mode only — advanced mode uses
    // AdvancedTestcase rows via a different pipeline).
    if (def.testcases) {
      for (const [setName, setDef] of Object.entries(def.testcases)) {
        const testcaseSet = await prisma.testcaseSet.upsert({
          create: {
            name: setName,
            problemId: problem.id,
            weight: 1
          },
          update: {},
          where: {
            problemId_name: {
              name: setName,
              problemId: problem.id
            }
          }
        });

        // Delete existing testcases and re-create for idempotency
        await prisma.testcase.deleteMany({
          where: { testcaseSetId: testcaseSet.id }
        });

        for (const [index, tc] of setDef.cases.entries()) {
          await prisma.testcase.create({
            data: {
              expectedStdout: tc.expectedStdout,
              ordinal: index + 1,
              stdin: tc.stdin,
              testcaseSetId: testcaseSet.id
            }
          });
        }
      }
    }

    // Upsert workspace files (Phase 1 redesign: starter code + read-only
    // helper + hidden test scaffolding for Standard Mode problems that
    // benefit from demonstrating the editable-region UI).
    if (def.workspaceFiles && def.workspaceFiles.length > 0) {
      await prisma.problemWorkspaceFile.deleteMany({
        where: { problemId: problem.id }
      });
      await prisma.problemWorkspaceFile.createMany({
        data: def.workspaceFiles.map((wf) => ({
          problemId: problem.id,
          language: wf.language,
          path: wf.path,
          content: wf.content,
          visibility: wf.visibility,
          editableRegions: wf.editableRegions ?? undefined,
          description: wf.description ?? "",
          orderIndex: wf.orderIndex ?? 0
        }))
      });
    }

    // Upsert advanced-mode testcases.
    if (def.advancedTestcases && def.advancedTestcases.length > 0) {
      await prisma.advancedTestcase.deleteMany({
        where: { problemId: problem.id }
      });
      await prisma.advancedTestcase.createMany({
        data: def.advancedTestcases.map((tc, index) => ({
          problemId: problem.id,
          ordinal: index + 1,
          stdin: tc.stdin,
          expected: tc.expected,
          files: tc.files
        }))
      });
    }

    const testcaseSetCount = def.testcases ? Object.keys(def.testcases).length : 0;
    const extras: string[] = [];
    if (def.samples?.length) extras.push(`${def.samples.length} samples`);
    if (def.workspaceFiles?.length) extras.push(`${def.workspaceFiles.length} workspace files`);
    if (def.advancedTestcases?.length)
      extras.push(`${def.advancedTestcases.length} advanced testcases`);
    const extrasLabel = extras.length ? `, ${extras.join(", ")}` : "";
    console.log(
      `  Problem: ${def.id} [${mode}] (${Object.keys(def.statements).join(", ")} statements, ${testcaseSetCount} testcase sets${extrasLabel})`
    );
  }
}

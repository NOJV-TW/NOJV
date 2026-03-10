import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/nojv"
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  const passwordHash = bcrypt.hashSync("password123", 10);

  // --- Users ---
  const admin = await prisma.user.upsert({
    create: {
      name: "Admin",
      email: "admin@nojv.local",
      handle: "admin",
      id: "usr_admin",
      locale: "zh-TW",
      platformRole: "admin"
    },
    update: {},
    where: { id: "usr_admin" }
  });

  const teacher = await prisma.user.upsert({
    create: {
      name: "Teacher",
      email: "teacher@nojv.local",
      handle: "teacher",
      id: "usr_teacher",
      locale: "zh-TW",
      platformRole: "teacher"
    },
    update: {},
    where: { id: "usr_teacher" }
  });

  const taStudent = await prisma.user.upsert({
    create: {
      name: "TA Student",
      email: "ta-student@nojv.local",
      handle: "ta-student",
      id: "usr_ta_student",
      locale: "zh-TW",
      platformRole: "student"
    },
    update: {},
    where: { id: "usr_ta_student" }
  });

  const student = await prisma.user.upsert({
    create: {
      name: "Student",
      email: "student@nojv.local",
      handle: "student",
      id: "usr_student",
      locale: "zh-TW",
      platformRole: "student"
    },
    update: {},
    where: { id: "usr_student" }
  });

  const users = [admin, teacher, taStudent, student];

  // --- Credential Accounts ---
  for (const u of users) {
    await prisma.account.upsert({
      create: {
        id: `acct_${u.handle}`,
        accountId: u.id,
        providerId: "credential",
        userId: u.id,
        password: passwordHash
      },
      update: { password: passwordHash },
      where: { id: `acct_${u.handle}` }
    });
  }

  console.log(`  Users: ${users.length} upserted with credential accounts`);

  // --- Problems ---
  const problemDefs = [
    {
      authorId: teacher.id,
      defaultTitle: "Warmup Sum",
      difficulty: "easy",
      id: "problem_warmup-sum",
      memoryLimitMb: 256,
      slug: "warmup-sum",
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
      testcases: {
        sample: {
          isHidden: false,
          cases: [
            { stdin: "2 5", expectedStdout: "7" },
            { stdin: "0 0", expectedStdout: "0" },
            { stdin: "-3 7", expectedStdout: "4" }
          ]
        },
        hidden: {
          isHidden: true,
          cases: [
            { stdin: "1000000 999999", expectedStdout: "1999999" },
            { stdin: "-100 -200", expectedStdout: "-300" },
            { stdin: "2147483646 1", expectedStdout: "2147483647" }
          ]
        }
      }
    },
    {
      authorId: teacher.id,
      defaultTitle: "Graph Docking",
      difficulty: "medium",
      id: "problem_graph-docking",
      memoryLimitMb: 256,
      slug: "graph-docking",
      summary: "A medium problem used to show richer catalog metadata on the problem page.",
      timeLimitMs: 2000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Graph Docking",
          body: "為每艘船維護下一個可用碼頭。隱藏評審偏好使用 DSU 或貪心路徑壓縮方法。",
          inputFormat:
            "第一行一個整數 $N$（$1 \\le N \\le 10^6$），表示碼頭數量。接下來 $N$ 行，每行一個整數 $d_i$（$1 \\le d_i \\le N$），表示第 $i$ 艘船希望停靠的碼頭編號。",
          outputFormat: "一行，輸出無法成功停靠的船隻數量。"
        },
        en: {
          title: "Graph Docking",
          body: "Maintain the next available dock for each incoming ship. The hidden judge favors DSU or greedy path compression approaches.",
          inputFormat:
            "The first line contains an integer $N$ ($1 \\le N \\le 10^6$), the number of docks. The next $N$ lines each contain an integer $d_i$ ($1 \\le d_i \\le N$), the preferred dock for the $i$-th ship.",
          outputFormat: "A single line containing the number of ships that could not dock."
        }
      },
      testcases: {
        sample: {
          isHidden: false,
          cases: [
            { stdin: "4\n3\n4\n1\n1\n", expectedStdout: "2" },
            { stdin: "2\n1\n2\n", expectedStdout: "0" }
          ]
        },
        hidden: {
          isHidden: true,
          cases: [
            { stdin: "6\n5\n6\n3\n3\n2\n1\n", expectedStdout: "3" },
            { stdin: "1\n1\n", expectedStdout: "0" }
          ]
        }
      }
    },
    {
      authorId: teacher.id,
      defaultTitle: "Distributed Labyrinth",
      difficulty: "hard",
      id: "problem_distributed-labyrinth",
      memoryLimitMb: 512,
      slug: "distributed-labyrinth",
      summary:
        "A hard graph problem that showcases the catalog's ability to carry richer editorial metadata and higher-difficulty workloads.",
      timeLimitMs: 3000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Distributed Labyrinth",
          body: "在多層走廊中協調多個代理，同時保持最短路徑保證。一旦迷宮開始分支，需要高效的狀態壓縮和最短路徑推理。",
          inputFormat:
            "第一行兩個整數 $R$ 和 $C$（$1 \\le R, C \\le 1000$），表示迷宮的列數與行數。接下來 $R$ 行，每行 $C$ 個字元，`.` 表示通道，`#` 表示牆壁。起點為左上角 $(0,0)$，終點為右下角 $(R-1,C-1)$。",
          outputFormat: "一行，輸出從起點到終點的最短路徑長度。"
        },
        en: {
          title: "Distributed Labyrinth",
          body: "Coordinate multiple agents across layered corridors while preserving shortest-path guarantees. Efficient state compression and shortest-path reasoning are both required once the maze begins to branch.",
          inputFormat:
            "The first line contains two integers $R$ and $C$ ($1 \\le R, C \\le 1000$), the number of rows and columns. The next $R$ lines each contain $C$ characters: `.` for passage and `#` for wall. The start is at $(0,0)$ and the goal is at $(R-1,C-1)$.",
          outputFormat:
            "A single line containing the length of the shortest path from start to goal."
        }
      },
      testcases: {
        sample: {
          isHidden: false,
          cases: [
            { stdin: "3 3\n...\n.#.\n...\n", expectedStdout: "4" },
            { stdin: "2 2\n..\n..\n", expectedStdout: "2" }
          ]
        },
        hidden: {
          isHidden: true,
          cases: [
            { stdin: "5 5\n.....\n.###.\n.#.#.\n.###.\n.....\n", expectedStdout: "8" },
            { stdin: "1 1\n.\n", expectedStdout: "0" }
          ]
        }
      }
    },
    {
      authorId: teacher.id,
      defaultTitle: "Process Log Parser",
      difficulty: "medium",
      id: "problem_process-log-parser",
      memoryLimitMb: 256,
      slug: "process-log-parser",
      summary:
        "A private course problem for assignments where the public catalog should not reveal the prompt.",
      timeLimitMs: 1000,
      visibility: "private" as const,
      statements: {
        "zh-TW": {
          title: "Process Log Parser",
          body: "解析作業系統行程追蹤並輸出正規化的生命週期日誌。這是一個私有題目，僅供課程作業使用。",
          inputFormat:
            "第一行一個整數 $N$（$1 \\le N \\le 10^5$），表示事件數量。接下來 $N$ 行，每行格式為 `fork <parent> <child>`、`exit <pid>` 或 `wait <pid>`。",
          outputFormat:
            "每行一個事件的正規化描述：`fork` 事件輸出 `<parent>-><child> forked`，`exit` 事件輸出 `<pid> exited`，`wait` 事件輸出 `<pid> waited`。"
        },
        en: {
          title: "Process Log Parser",
          body: "Parse an operating-system process trace and emit a normalized lifecycle log. This private problem is meant for course-only usage.",
          inputFormat:
            "The first line contains an integer $N$ ($1 \\le N \\le 10^5$), the number of events. The next $N$ lines each contain an event in the form `fork <parent> <child>`, `exit <pid>`, or `wait <pid>`.",
          outputFormat:
            "One line per event: `fork` events produce `<parent>-><child> forked`, `exit` events produce `<pid> exited`, and `wait` events produce `<pid> waited`."
        }
      },
      testcases: {
        sample: {
          isHidden: false,
          cases: [
            {
              stdin: "3\nfork 1 2\nexit 2\nwait 1\n",
              expectedStdout: "1->2 forked\n2 exited\n1 waited\n"
            }
          ]
        },
        hidden: {
          isHidden: true,
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
      authorId: teacher.id,
      defaultTitle: "Fork Bomb Safeguard",
      difficulty: "hard",
      id: "problem_fork-bomb-safeguard",
      memoryLimitMb: 512,
      slug: "fork-bomb-safeguard",
      summary: "A private exam problem that should only surface inside a course assessment.",
      timeLimitMs: 2000,
      visibility: "private" as const,
      statements: {
        "zh-TW": {
          title: "Fork Bomb Safeguard",
          body: "計算在爆發約束下行程樹的最小成本隔離策略。這個題目在課程考試中保持私有。",
          inputFormat:
            "第一行一個整數 $N$（$2 \\le N \\le 10^5$），表示行程數量。接下來 $N-1$ 行，每行兩個整數 $u$ 和 $v$，表示行程 $u$ fork 了行程 $v$。",
          outputFormat: "一行，輸出最小隔離成本。"
        },
        en: {
          title: "Fork Bomb Safeguard",
          body: "Compute the minimum cost isolation strategy for a process tree under burst constraints. This problem stays private to the course exam.",
          inputFormat:
            "The first line contains an integer $N$ ($2 \\le N \\le 10^5$), the number of processes. The next $N-1$ lines each contain two integers $u$ and $v$, indicating process $u$ forked process $v$.",
          outputFormat: "A single line containing the minimum isolation cost."
        }
      },
      testcases: {
        sample: {
          isHidden: false,
          cases: [
            { stdin: "4\n1 2\n1 3\n3 4\n", expectedStdout: "7" },
            { stdin: "2\n1 2\n", expectedStdout: "3" }
          ]
        },
        hidden: {
          isHidden: true,
          cases: [
            { stdin: "5\n1 2\n1 3\n3 4\n3 5\n", expectedStdout: "11" },
            { stdin: "3\n1 2\n2 3\n", expectedStdout: "6" }
          ]
        }
      }
    },
    {
      authorId: teacher.id,
      defaultTitle: "Add Two Numbers",
      difficulty: "easy",
      id: "problem_add-two-numbers",
      memoryLimitMb: 256,
      slug: "add-two-numbers",
      submissionType: "function" as const,
      judgeType: "standard" as const,
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
      testcases: {
        sample: {
          isHidden: false,
          cases: [
            { stdin: "1 2", expectedStdout: "3" },
            { stdin: "0 0", expectedStdout: "0" },
            { stdin: "-1 1", expectedStdout: "0" }
          ]
        },
        hidden: {
          isHidden: true,
          cases: [
            { stdin: "1000000 999999", expectedStdout: "1999999" },
            { stdin: "-500 -700", expectedStdout: "-1200" },
            { stdin: "2147483646 1", expectedStdout: "2147483647" }
          ]
        }
      }
    },
    {
      authorId: teacher.id,
      defaultTitle: "Float Compare",
      difficulty: "easy",
      id: "problem_float-compare",
      memoryLimitMb: 256,
      slug: "float-compare",
      submissionType: "full_source" as const,
      judgeType: "checker" as const,
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
`,
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
      testcases: {
        sample: {
          isHidden: false,
          cases: [
            { stdin: "1 3", expectedStdout: "0.333333" },
            { stdin: "1 7", expectedStdout: "0.142857" }
          ]
        },
        hidden: {
          isHidden: true,
          cases: [
            { stdin: "2 3", expectedStdout: "0.666667" },
            { stdin: "355 113", expectedStdout: "3.141593" }
          ]
        }
      }
    },
    {
      authorId: teacher.id,
      defaultTitle: "Guess the Number",
      difficulty: "medium",
      id: "problem_guess-the-number",
      memoryLimitMb: 256,
      slug: "guess-the-number",
      submissionType: "full_source" as const,
      judgeType: "interactive" as const,
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
`,
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
      testcases: {
        sample: {
          isHidden: false,
          cases: [
            { stdin: "42", expectedStdout: "" },
            { stdin: "500000", expectedStdout: "" }
          ]
        },
        hidden: {
          isHidden: true,
          cases: [
            { stdin: "1", expectedStdout: "" },
            { stdin: "1000000", expectedStdout: "" },
            { stdin: "314159", expectedStdout: "" }
          ]
        }
      }
    }
  ];

  for (const def of problemDefs) {
    const problem = await prisma.problem.upsert({
      create: {
        authorId: def.authorId,
        defaultTitle: def.defaultTitle,
        difficulty: def.difficulty,
        id: def.id,
        memoryLimitMb: def.memoryLimitMb,
        slug: def.slug,
        summary: def.summary,
        timeLimitMs: def.timeLimitMs,
        visibility: def.visibility,
        ...("submissionType" in def && { submissionType: def.submissionType }),
        ...("judgeType" in def && { judgeType: def.judgeType }),
        ...("checkerScript" in def && { checkerScript: def.checkerScript }),
        ...("interactorScript" in def && { interactorScript: def.interactorScript })
      },
      update: {
        defaultTitle: def.defaultTitle,
        difficulty: def.difficulty,
        summary: def.summary,
        ...("submissionType" in def && { submissionType: def.submissionType }),
        ...("judgeType" in def && { judgeType: def.judgeType }),
        ...("checkerScript" in def && { checkerScript: def.checkerScript }),
        ...("interactorScript" in def && { interactorScript: def.interactorScript })
      },
      where: { slug: def.slug }
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

    // Upsert testcase sets
    for (const [setName, setDef] of Object.entries(def.testcases)) {
      const testcaseSet = await prisma.testcaseSet.upsert({
        create: {
          isHidden: setDef.isHidden,
          name: setName,
          problemId: problem.id,
          weight: 1
        },
        update: {
          isHidden: setDef.isHidden
        },
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

    console.log(
      `  Problem: ${def.slug} (${Object.keys(def.statements).join(", ")} statements, ${Object.keys(def.testcases).length} testcase sets)`
    );
  }

  // --- Problem Templates (for function-mode problems) ---
  const addProblem = await prisma.problem.findUnique({ where: { slug: "add-two-numbers" } });
  if (addProblem) {
    await prisma.problemTemplate.upsert({
      create: {
        driverCode: "# __USER_CODE__\na, b = map(int, input().split())\nprint(add(a, b))\n",
        insertionMarker: "# __USER_CODE__",
        language: "python",
        problemId: addProblem.id,
        templateCode: "def add(a, b):\n    # Write your solution here\n    pass\n"
      },
      update: {
        driverCode: "# __USER_CODE__\na, b = map(int, input().split())\nprint(add(a, b))\n",
        templateCode: "def add(a, b):\n    # Write your solution here\n    pass\n"
      },
      where: {
        problemId_language: {
          language: "python",
          problemId: addProblem.id
        }
      }
    });

    await prisma.problemTemplate.upsert({
      create: {
        driverCode:
          "#include <iostream>\nusing namespace std;\n// __USER_CODE__\nint main() {\n    int a, b;\n    cin >> a >> b;\n    cout << add(a, b) << endl;\n    return 0;\n}\n",
        insertionMarker: "// __USER_CODE__",
        language: "cpp",
        problemId: addProblem.id,
        templateCode:
          "int add(int a, int b) {\n    // Write your solution here\n    return 0;\n}\n"
      },
      update: {
        driverCode:
          "#include <iostream>\nusing namespace std;\n// __USER_CODE__\nint main() {\n    int a, b;\n    cin >> a >> b;\n    cout << add(a, b) << endl;\n    return 0;\n}\n",
        templateCode:
          "int add(int a, int b) {\n    // Write your solution here\n    return 0;\n}\n"
      },
      where: {
        problemId_language: {
          language: "cpp",
          problemId: addProblem.id
        }
      }
    });

    console.log(`  Templates: 2 upserted for add-two-numbers (python, cpp)`);
  }

  // --- Contests ---
  const springQualifier = await prisma.contest.upsert({
    create: {
      endsAt: new Date("2026-03-15T18:00:00+08:00"),
      frozenBoard: true,
      id: "contest_spring-qualifier-2026",
      slug: "spring-qualifier-2026",
      startsAt: new Date("2026-03-15T14:00:00+08:00"),
      summary: "Qualifier contest with a frozen board in the final hour.",
      title: "Spring Qualifier 2026",
      visibility: "published"
    },
    update: {},
    where: { slug: "spring-qualifier-2026" }
  });

  // Link problems to contests
  const contestProblemLinks = [
    { contestId: springQualifier.id, problemSlug: "warmup-sum", ordinal: 1, points: 100 },
    { contestId: springQualifier.id, problemSlug: "graph-docking", ordinal: 2, points: 300 }
  ];

  for (const link of contestProblemLinks) {
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: link.problemSlug }
    });

    await prisma.contestProblem.upsert({
      create: {
        contestId: link.contestId,
        ordinal: link.ordinal,
        points: link.points,
        problemId: problem.id
      },
      update: {
        ordinal: link.ordinal,
        points: link.points
      },
      where: {
        contestId_problemId: {
          contestId: link.contestId,
          problemId: problem.id
        }
      }
    });
  }

  console.log(`  Contests: 1 upserted with problem links`);

  // --- Courses ---
  const osLabCourse = await prisma.course.upsert({
    create: {
      description:
        "A course-managed OJ space for systems programming. Teachers own the course, TAs manage operations, and students join by QR code, join code, or manual enrollment.",
      id: "course_os-lab-spring-2026",
      locale: "zh-TW",
      ownerId: teacher.id,
      slug: "os-lab-spring-2026",
      title: "Operating Systems Lab",
      visibility: "invite_only"
    },
    update: {},
    where: { slug: "os-lab-spring-2026" }
  });

  // Course memberships
  const osLabMemberships = [
    {
      courseId: osLabCourse.id,
      userId: teacher.id,
      role: "teacher" as const,
      joinedVia: "manual_invite" as const
    },
    {
      courseId: osLabCourse.id,
      userId: taStudent.id,
      role: "ta" as const,
      joinedVia: "manual_invite" as const
    },
    {
      courseId: osLabCourse.id,
      userId: student.id,
      role: "student" as const,
      joinedVia: "join_code" as const
    }
  ];

  for (const mem of osLabMemberships) {
    await prisma.courseMembership.upsert({
      create: {
        addedByUserId: mem.role === "teacher" ? mem.userId : teacher.id,
        courseId: mem.courseId,
        joinedAt: new Date(),
        joinedVia: mem.joinedVia,
        role: mem.role,
        status: "active",
        userId: mem.userId
      },
      update: {},
      where: {
        courseId_userId: {
          courseId: mem.courseId,
          userId: mem.userId
        }
      }
    });
  }

  // Course join tokens
  const joinTokens = [
    {
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      label: "Course QR",
      method: "qr_code" as const,
      token: "oslab-qr-2026"
    },
    {
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      label: "Course code",
      method: "join_code" as const,
      token: "OSLAB2026"
    },
    {
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      label: "Manual roster sync",
      method: "manual_invite" as const,
      token: "teacher-managed-oslab"
    }
  ];

  for (const jt of joinTokens) {
    await prisma.courseJoinToken.upsert({
      create: jt,
      update: {},
      where: { token: jt.token }
    });
  }

  // Course problems
  const osLabProblemSlugs = [
    "warmup-sum",
    "graph-docking",
    "process-log-parser",
    "fork-bomb-safeguard"
  ];

  for (const slug of osLabProblemSlugs) {
    const problem = await prisma.problem.findUniqueOrThrow({ where: { slug } });
    await prisma.courseProblem.upsert({
      create: {
        addedByUserId: teacher.id,
        courseId: osLabCourse.id,
        problemId: problem.id
      },
      update: {},
      where: {
        courseId_problemId: {
          courseId: osLabCourse.id,
          problemId: problem.id
        }
      }
    });
  }

  // Course assessments
  const hw1 = await prisma.courseAssessment.upsert({
    create: {
      closesAt: new Date("2026-03-25T15:00:00.000Z"),
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      dueAt: new Date("2026-03-23T15:00:00.000Z"),
      opensAt: new Date("2026-03-17T09:00:00.000Z"),
      scoreboardMode: "hidden",
      slug: "hw1-process-trace",
      status: "published",
      summary:
        "Coursework-oriented assignment with a visible deadline and a private systems problem.",
      title: "Homework 1: Process Trace",
      type: "assignment"
    },
    update: {},
    where: {
      courseId_slug: {
        courseId: osLabCourse.id,
        slug: "hw1-process-trace"
      }
    }
  });

  const midterm = await prisma.courseAssessment.upsert({
    create: {
      closesAt: new Date("2026-04-02T12:00:00.000Z"),
      courseId: osLabCourse.id,
      createdByUserId: teacher.id,
      dueAt: new Date("2026-04-02T12:00:00.000Z"),
      opensAt: new Date("2026-04-02T09:00:00.000Z"),
      scoreboardMode: "live",
      slug: "midterm-systems-lab",
      status: "published",
      summary:
        "Exam-style assessment with contest-grade pacing, live ranking, and tighter shell policy.",
      title: "Midterm Systems Lab",
      type: "exam"
    },
    update: {},
    where: {
      courseId_slug: {
        courseId: osLabCourse.id,
        slug: "midterm-systems-lab"
      }
    }
  });

  // Assessment problem links
  const assessmentProblemLinks = [
    { assessmentId: hw1.id, problemSlug: "warmup-sum", ordinal: 1 },
    { assessmentId: hw1.id, problemSlug: "process-log-parser", ordinal: 2 },
    { assessmentId: midterm.id, problemSlug: "graph-docking", ordinal: 1 },
    { assessmentId: midterm.id, problemSlug: "fork-bomb-safeguard", ordinal: 2 }
  ];

  for (const link of assessmentProblemLinks) {
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: link.problemSlug }
    });

    await prisma.courseAssessmentProblem.upsert({
      create: {
        assessmentId: link.assessmentId,
        ordinal: link.ordinal,
        points: 100,
        problemId: problem.id
      },
      update: {
        ordinal: link.ordinal
      },
      where: {
        assessmentId_problemId: {
          assessmentId: link.assessmentId,
          problemId: problem.id
        }
      }
    });
  }

  console.log(`  Courses: 1 upserted with memberships, join tokens, problems, and assessments`);

  // Seed announcements
  await prisma.announcement.deleteMany();
  await prisma.announcement.createMany({
    data: [
      {
        title: "系統上線公告",
        content: "NOJV 線上評測系統已正式上線，歡迎使用！",
        pinned: true
      },
      {
        title: "新功能：課程管理",
        content: "教師現在可以建立課程、新增作業與考試。學生可以透過加入碼加入課程。",
        pinned: false
      },
      {
        title: "系統維護通知",
        content: "預計於本週六 22:00-24:00 進行系統維護，届時服務將暫停。",
        pinned: false
      }
    ]
  });
  console.log("Seeded announcements");

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/nojv"
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // --- Users ---
  const amelia = await prisma.user.upsert({
    create: {
      name: "Amelia Chen",
      email: "amelia.chen@nojv.local",
      handle: "teacher_amelia",
      id: "usr_teacher_amelia",
      locale: "zh-TW",
      platformRole: "teacher"
    },
    update: {},
    where: { id: "usr_teacher_amelia" }
  });

  const lin = await prisma.user.upsert({
    create: {
      name: "Lin Carter",
      email: "lin.carter@nojv.local",
      handle: "teacher_lin",
      id: "usr_teacher_lin",
      locale: "en",
      platformRole: "teacher"
    },
    update: {},
    where: { id: "usr_teacher_lin" }
  });

  const ren = await prisma.user.upsert({
    create: {
      name: "Ren Wu",
      email: "ren.wu@nojv.local",
      handle: "ta_ren",
      id: "usr_ta_ren",
      locale: "zh-TW",
      platformRole: "ta"
    },
    update: {},
    where: { id: "usr_ta_ren" }
  });

  const alice = await prisma.user.upsert({
    create: {
      name: "Alice Huang",
      email: "alice.huang@nojv.local",
      handle: "stu_alice",
      id: "usr_student_alice",
      locale: "zh-TW",
      platformRole: "student"
    },
    update: {},
    where: { id: "usr_student_alice" }
  });

  const bob = await prisma.user.upsert({
    create: {
      name: "Bob Lin",
      email: "bob.lin@nojv.local",
      handle: "stu_bob",
      id: "usr_student_bob",
      locale: "zh-TW",
      platformRole: "student"
    },
    update: {},
    where: { id: "usr_student_bob" }
  });

  const maya = await prisma.user.upsert({
    create: {
      name: "Maya Su",
      email: "maya.su@nojv.local",
      handle: "stu_maya",
      id: "usr_student_maya",
      locale: "en",
      platformRole: "student"
    },
    update: {},
    where: { id: "usr_student_maya" }
  });

  const admin = await prisma.user.upsert({
    create: {
      name: "Ops Admin",
      email: "ops.admin@nojv.local",
      handle: "ops_admin",
      id: "usr_admin_ops",
      locale: "zh-TW",
      platformRole: "admin"
    },
    update: {},
    where: { id: "usr_admin_ops" }
  });

  console.log(`  Users: ${[amelia, lin, ren, alice, bob, maya, admin].length} upserted`);

  // --- Problems ---
  const problemDefs = [
    {
      authorId: amelia.id,
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
          body: "實作經典的暖身題。從標準輸入讀取兩個整數，並將它們的總和加上換行符號後輸出。"
        },
        en: {
          title: "Warmup Sum",
          body: "Implement the classic warmup judge task. Read exactly two integers from standard input and print their sum followed by a newline."
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
      authorId: amelia.id,
      defaultTitle: "Graph Docking",
      difficulty: "medium",
      id: "problem_graph-docking",
      memoryLimitMb: 256,
      slug: "graph-docking",
      summary:
        "A medium problem used to show richer catalog metadata on the problem page.",
      timeLimitMs: 2000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "Graph Docking",
          body: "為每艘船維護下一個可用碼頭。隱藏評審偏好使用 DSU 或貪心路徑壓縮方法。"
        },
        en: {
          title: "Graph Docking",
          body: "Maintain the next available dock for each incoming ship. The hidden judge favors DSU or greedy path compression approaches."
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
      authorId: amelia.id,
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
          body: "在多層走廊中協調多個代理，同時保持最短路徑保證。一旦迷宮開始分支，需要高效的狀態壓縮和最短路徑推理。"
        },
        en: {
          title: "Distributed Labyrinth",
          body: "Coordinate multiple agents across layered corridors while preserving shortest-path guarantees. Efficient state compression and shortest-path reasoning are both required once the maze begins to branch."
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
      authorId: amelia.id,
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
          body: "解析作業系統行程追蹤並輸出正規化的生命週期日誌。這是一個私有題目，僅供課程作業使用。"
        },
        en: {
          title: "Process Log Parser",
          body: "Parse an operating-system process trace and emit a normalized lifecycle log. This private problem is meant for course-only usage."
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
              expectedStdout:
                "1->2 forked\n2->3 forked\n3 exited\n2 waited\n1 exited\n"
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
      authorId: amelia.id,
      defaultTitle: "Fork Bomb Safeguard",
      difficulty: "hard",
      id: "problem_fork-bomb-safeguard",
      memoryLimitMb: 512,
      slug: "fork-bomb-safeguard",
      summary:
        "A private exam problem that should only surface inside a course assessment.",
      timeLimitMs: 2000,
      visibility: "private" as const,
      statements: {
        "zh-TW": {
          title: "Fork Bomb Safeguard",
          body: "計算在爆發約束下行程樹的最小成本隔離策略。這個題目在課程考試中保持私有。"
        },
        en: {
          title: "Fork Bomb Safeguard",
          body: "Compute the minimum cost isolation strategy for a process tree under burst constraints. This problem stays private to the course exam."
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
      authorId: amelia.id,
      defaultTitle: "Add Two Numbers",
      difficulty: "easy",
      id: "problem_add-two-numbers",
      memoryLimitMb: 256,
      slug: "add-two-numbers",
      submissionType: "function" as const,
      judgeType: "standard" as const,
      summary:
        "Write a function that adds two integers.",
      timeLimitMs: 1000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "兩數相加",
          body: "撰寫一個函式，接收兩個整數並回傳它們的總和。"
        },
        en: {
          title: "Add Two Numbers",
          body: "Write a function that takes two integers and returns their sum."
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
      authorId: amelia.id,
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
      summary:
        "Compute the result with floating-point precision.",
      timeLimitMs: 1000,
      visibility: "public" as const,
      statements: {
        "zh-TW": {
          title: "浮點數比較",
          body: "計算結果並以浮點數精度輸出。答案與預期值的絕對差必須小於 1e-6。"
        },
        en: {
          title: "Float Compare",
          body: "Compute the result and output it with floating-point precision. Your answer must be within 1e-6 absolute difference of the expected value."
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
        ...("checkerScript" in def && { checkerScript: def.checkerScript })
      },
      update: {
        defaultTitle: def.defaultTitle,
        difficulty: def.difficulty,
        summary: def.summary,
        ...("submissionType" in def && { submissionType: def.submissionType }),
        ...("judgeType" in def && { judgeType: def.judgeType }),
        ...("checkerScript" in def && { checkerScript: def.checkerScript })
      },
      where: { slug: def.slug }
    });

    // Upsert statements for each locale
    for (const [locale, stmt] of Object.entries(def.statements)) {
      await prisma.problemStatementI18n.upsert({
        create: {
          bodyMarkdown: stmt.body,
          locale,
          problemId: problem.id,
          title: stmt.title
        },
        update: {
          bodyMarkdown: stmt.body,
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

    console.log(`  Problem: ${def.slug} (${Object.keys(def.statements).join(", ")} statements, ${Object.keys(def.testcases).length} testcase sets)`);
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
        driverCode: "#include <iostream>\nusing namespace std;\n// __USER_CODE__\nint main() {\n    int a, b;\n    cin >> a >> b;\n    cout << add(a, b) << endl;\n    return 0;\n}\n",
        insertionMarker: "// __USER_CODE__",
        language: "cpp",
        problemId: addProblem.id,
        templateCode: "int add(int a, int b) {\n    // Write your solution here\n    return 0;\n}\n"
      },
      update: {
        driverCode: "#include <iostream>\nusing namespace std;\n// __USER_CODE__\nint main() {\n    int a, b;\n    cin >> a >> b;\n    cout << add(a, b) << endl;\n    return 0;\n}\n",
        templateCode: "int add(int a, int b) {\n    // Write your solution here\n    return 0;\n}\n"
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
      summary:
        "Qualifier contest with a frozen board in the final hour.",
      title: "Spring Qualifier 2026",
      visibility: "published"
    },
    update: {},
    where: { slug: "spring-qualifier-2026" }
  });

  const systemsLabMidterm = await prisma.contest.upsert({
    create: {
      endsAt: new Date("2026-03-22T21:00:00+08:00"),
      frozenBoard: false,
      id: "contest_systems-lab-midterm",
      slug: "systems-lab-midterm",
      startsAt: new Date("2026-03-22T18:00:00+08:00"),
      summary:
        "Assignment-flavored contest where participants submit through a contest-specific scoring surface.",
      title: "Systems Lab Midterm",
      visibility: "published"
    },
    update: {},
    where: { slug: "systems-lab-midterm" }
  });

  // Link problems to contests
  const contestProblemLinks = [
    { contestId: springQualifier.id, problemSlug: "warmup-sum", ordinal: 1, points: 100 },
    { contestId: springQualifier.id, problemSlug: "graph-docking", ordinal: 2, points: 300 },
    { contestId: systemsLabMidterm.id, problemSlug: "warmup-sum", ordinal: 1, points: 100 },
    {
      contestId: systemsLabMidterm.id,
      problemSlug: "distributed-labyrinth",
      ordinal: 2,
      points: 500
    }
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

  console.log(`  Contests: 2 upserted with problem links`);

  // --- Courses ---
  const osLabCourse = await prisma.course.upsert({
    create: {
      description:
        "A course-managed OJ space for systems programming. Teachers own the course, TAs manage operations, and students join by QR code, join code, or manual enrollment.",
      id: "course_os-lab-spring-2026",
      locale: "zh-TW",
      ownerId: amelia.id,
      slug: "os-lab-spring-2026",
      title: "Operating Systems Lab",
      visibility: "invite_only"
    },
    update: {},
    where: { slug: "os-lab-spring-2026" }
  });

  const algoStudioCourse = await prisma.course.upsert({
    create: {
      description:
        "An algorithm design studio where the teacher curates a mixed shelf of public catalog problems and course-private derivatives.",
      id: "course_algorithm-studio-2026",
      locale: "en",
      ownerId: lin.id,
      slug: "algorithm-studio-2026",
      title: "Algorithm Studio",
      visibility: "invite_only"
    },
    update: {},
    where: { slug: "algorithm-studio-2026" }
  });

  // Course memberships
  const osLabMemberships = [
    { courseId: osLabCourse.id, userId: amelia.id, role: "teacher" as const, joinedVia: "manual_invite" as const },
    { courseId: osLabCourse.id, userId: ren.id, role: "ta" as const, joinedVia: "manual_invite" as const },
    { courseId: osLabCourse.id, userId: alice.id, role: "student" as const, joinedVia: "join_code" as const },
    { courseId: osLabCourse.id, userId: bob.id, role: "student" as const, joinedVia: "qr_code" as const }
  ];

  const algoStudioMemberships = [
    { courseId: algoStudioCourse.id, userId: lin.id, role: "teacher" as const, joinedVia: "manual_invite" as const },
    { courseId: algoStudioCourse.id, userId: maya.id, role: "student" as const, joinedVia: "qr_code" as const }
  ];

  for (const mem of [...osLabMemberships, ...algoStudioMemberships]) {
    await prisma.courseMembership.upsert({
      create: {
        addedByUserId: mem.role === "teacher" ? mem.userId : (mem.courseId === osLabCourse.id ? amelia.id : lin.id),
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
    { courseId: osLabCourse.id, createdByUserId: amelia.id, label: "Course QR", method: "qr_code" as const, token: "oslab-qr-2026" },
    { courseId: osLabCourse.id, createdByUserId: amelia.id, label: "Course code", method: "join_code" as const, token: "OSLAB2026" },
    { courseId: osLabCourse.id, createdByUserId: amelia.id, label: "Manual roster sync", method: "manual_invite" as const, token: "teacher-managed-oslab" },
    { courseId: algoStudioCourse.id, createdByUserId: lin.id, label: "Studio QR", method: "qr_code" as const, token: "algo-studio-qr" },
    { courseId: algoStudioCourse.id, createdByUserId: lin.id, label: "Studio code", method: "join_code" as const, token: "ALGOSTUDIO" },
    { courseId: algoStudioCourse.id, createdByUserId: lin.id, label: "Manual roster sync", method: "manual_invite" as const, token: "teacher-managed-algo" }
  ];

  for (const jt of joinTokens) {
    await prisma.courseJoinToken.upsert({
      create: jt,
      update: {},
      where: { token: jt.token }
    });
  }

  // Course problems
  const osLabProblemSlugs = ["warmup-sum", "graph-docking", "process-log-parser", "fork-bomb-safeguard"];
  const algoStudioProblemSlugs = ["warmup-sum", "distributed-labyrinth"];

  for (const slug of osLabProblemSlugs) {
    const problem = await prisma.problem.findUniqueOrThrow({ where: { slug } });
    await prisma.courseProblem.upsert({
      create: {
        addedByUserId: amelia.id,
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

  for (const slug of algoStudioProblemSlugs) {
    const problem = await prisma.problem.findUniqueOrThrow({ where: { slug } });
    await prisma.courseProblem.upsert({
      create: {
        addedByUserId: lin.id,
        courseId: algoStudioCourse.id,
        problemId: problem.id
      },
      update: {},
      where: {
        courseId_problemId: {
          courseId: algoStudioCourse.id,
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
      createdByUserId: amelia.id,
      dueAt: new Date("2026-03-23T15:00:00.000Z"),
      opensAt: new Date("2026-03-17T09:00:00.000Z"),
      scoreboardMode: "hidden",
      slug: "hw1-process-trace",
      status: "published",
      summary: "Coursework-oriented assignment with a visible deadline and a private systems problem.",
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
      createdByUserId: amelia.id,
      dueAt: new Date("2026-04-02T12:00:00.000Z"),
      opensAt: new Date("2026-04-02T09:00:00.000Z"),
      scoreboardMode: "live",
      slug: "midterm-systems-lab",
      status: "published",
      summary: "Exam-style assessment with contest-grade pacing, live ranking, and tighter shell policy.",
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

  const hw2 = await prisma.courseAssessment.upsert({
    create: {
      closesAt: new Date("2026-04-12T15:00:00.000Z"),
      courseId: algoStudioCourse.id,
      createdByUserId: lin.id,
      dueAt: new Date("2026-04-10T15:00:00.000Z"),
      opensAt: new Date("2026-04-01T09:00:00.000Z"),
      scoreboardMode: "hidden",
      slug: "hw2-graph-state",
      status: "published",
      summary: "Algorithm homework with a longer open window and no live ranking pressure.",
      title: "Homework 2: Graph State Compression",
      type: "assignment"
    },
    update: {},
    where: {
      courseId_slug: {
        courseId: algoStudioCourse.id,
        slug: "hw2-graph-state"
      }
    }
  });

  // Assessment problem links
  const assessmentProblemLinks = [
    { assessmentId: hw1.id, problemSlug: "warmup-sum", ordinal: 1 },
    { assessmentId: hw1.id, problemSlug: "process-log-parser", ordinal: 2 },
    { assessmentId: midterm.id, problemSlug: "graph-docking", ordinal: 1 },
    { assessmentId: midterm.id, problemSlug: "fork-bomb-safeguard", ordinal: 2 },
    { assessmentId: hw2.id, problemSlug: "warmup-sum", ordinal: 1 },
    { assessmentId: hw2.id, problemSlug: "distributed-labyrinth", ordinal: 2 }
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

  console.log(`  Courses: 2 upserted with memberships, join tokens, problems, and assessments`);
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

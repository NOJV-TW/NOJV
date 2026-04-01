import { describe, expect, it } from "vitest";

import {
  seedProblems,
  validateProblemDefinitions,
  validateTemplateDefinitions
} from "../../../packages/db/prisma/seeds/problems";

function createMockPrisma() {
  const captured = {
    problemUpserts: [] as any[],
    templateUpserts: [] as any[]
  };

  const problemBySlug = new Map<string, { id: string; slug: string }>();

  const prisma = {
    problem: {
      upsert: async (args: any) => {
        captured.problemUpserts.push(args);
        const record = {
          id: String(args.create.id),
          slug: String(args.create.slug)
        };
        problemBySlug.set(record.slug, record);
        return record;
      },
      findUnique: async (args: any) => {
        const slug = String(args.where.slug);
        return problemBySlug.get(slug) ?? null;
      }
    },
    problemStatementI18n: {
      upsert: async () => ({})
    },
    testcaseSet: {
      upsert: async (args: any) => ({
        id: `${String(args.create.problemId)}:${String(args.create.name)}`
      })
    },
    testcase: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    },
    problemTemplate: {
      upsert: async (args: any) => {
        captured.templateUpserts.push(args);
        return {};
      }
    }
  };

  return { prisma: prisma as any, captured };
}

describe("problem seed hardening", () => {
  it("rejects interactive problems without interactor scripts", () => {
    expect(() =>
      validateProblemDefinitions([
        {
          authorId: "teacher",
          defaultTitle: "Broken Interactive",
          difficulty: "hard",
          id: "problem_broken-interactive",
          memoryLimitMb: 256,
          slug: "broken-interactive",
          summary: "broken",
          timeLimitMs: 1000,
          visibility: "public",
          judgeType: "interactive",
          statements: {
            "zh-TW": { title: "壞題", body: "壞題" },
            en: { title: "Broken", body: "Broken" }
          },
          testcases: {
            sample: {
              isHidden: false,
              cases: [{ stdin: "1", expectedStdout: "" }]
            },
            hidden: {
              isHidden: true,
              cases: [{ stdin: "2", expectedStdout: "" }]
            }
          }
        }
      ])
    ).toThrow(/Interactive judge requires interactorScript/);
  });

  it("rejects templates whose insertion marker does not appear exactly once", () => {
    const problems = [
      {
        authorId: "teacher",
        defaultTitle: "Function Task",
        difficulty: "hard",
        id: "problem_function-task",
        memoryLimitMb: 256,
        slug: "function-task",
        summary: "function",
        timeLimitMs: 1000,
        visibility: "public" as const,
        submissionType: "function" as const,
        statements: {
          "zh-TW": { title: "函式題", body: "函式題" },
          en: { title: "Function", body: "Function" }
        },
        testcases: {
          sample: {
            isHidden: false,
            cases: [{ stdin: "1", expectedStdout: "1" }]
          },
          hidden: {
            isHidden: true,
            cases: [{ stdin: "2", expectedStdout: "2" }]
          }
        }
      }
    ];

    expect(() =>
      validateTemplateDefinitions(problems, [
        {
          slug: "function-task",
          templates: [
            {
              language: "python",
              insertionMarker: "# __USER_CODE__",
              driverCode: "print('no marker here')",
              templateCode: "def solve():\n    return 1\n"
            }
          ]
        }
      ])
    ).toThrow(/Template marker must appear exactly once/);
  });

  it("seeds hardened non-basic-I/O problems and templates", async () => {
    const { prisma, captured } = createMockPrisma();

    await seedProblems(prisma, "teacher_1");

    const creates = captured.problemUpserts.map((entry) => entry.create);
    const dhcp = creates.find((entry) => entry.slug === "stateful-dhcp-parser");
    const memory = creates.find((entry) => entry.slug === "memory-leak-forensics");
    const noisy = creates.find((entry) => entry.slug === "noisy-oracle-hunt");

    expect(dhcp).toBeDefined();
    expect(dhcp.submissionType).toBe("function");
    expect(memory).toBeDefined();
    expect(memory.submissionType).toBe("function");
    expect(noisy).toBeDefined();
    expect(noisy.judgeType).toBe("interactive");
    expect(String(noisy.interactorScript)).toContain("lie_period = 5");

    expect(
      captured.templateUpserts.some((entry) =>
        String(entry.create.templateCode).includes("parse_dhcp_options")
      )
    ).toBe(true);
    expect(
      captured.templateUpserts.some((entry) =>
        String(entry.create.templateCode).includes("analyze_trace")
      )
    ).toBe(true);
  });
});

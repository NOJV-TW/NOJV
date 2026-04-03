import { describe, expect, it, vi } from "vitest";

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

  const problemById = new Map<string, { id: string }>();

  const prisma = {
    problem: {
      upsert: async (args: any) => {
        captured.problemUpserts.push(args);
        const record = {
          id: String(args.create.id)
        };
        problemById.set(record.id, record);
        return record;
      },
      findUnique: async (args: any) => {
        const id = String(args.where.id);
        return problemById.get(id) ?? null;
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
          summary: "broken",
          timeLimitMs: 1000,
          visibility: "public",
          judgeConfig: { type: "interactive" },
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
          problemId: "problem_function-task",
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
    const dhcp = creates.find((entry) => entry.id === "problem_stateful-dhcp-parser");
    const memory = creates.find((entry) => entry.id === "problem_memory-leak-forensics");
    const noisy = creates.find((entry) => entry.id === "problem_noisy-oracle-hunt");

    expect(dhcp).toBeDefined();
    expect(dhcp.submissionType).toBe("function");
    expect(memory).toBeDefined();
    expect(memory.submissionType).toBe("function");
    expect(noisy).toBeDefined();
    expect(noisy.judgeConfig?.type).toBe("interactive");
    expect(String(noisy.judgeConfig?.interactorScript)).toContain("lie_period = 5");

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

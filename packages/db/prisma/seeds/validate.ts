import { seedProblems } from "./problems";

function createMockPrisma() {
  const problemById = new Map<string, { id: string }>();

  return {
    problem: {
      upsert: async (args: { create: { id: string } }) => {
        const record = { id: String(args.create.id) };
        problemById.set(record.id, record);
        return record;
      },
      findUnique: async (args: { where: { id: string } }) => {
        const id = String(args.where.id);
        return problemById.get(id) ?? null;
      }
    },
    problemStatementI18n: {
      upsert: async () => ({})
    },
    testcaseSet: {
      upsert: async (args: { create: { problemId: string; name: string } }) => ({
        id: `${String(args.create.problemId)}:${String(args.create.name)}`
      })
    },
    testcase: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    },
    problemWorkspaceFile: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 })
    }
  };
}

async function main() {
  const prisma = createMockPrisma() as never;

  await seedProblems(prisma, "seed_validation_teacher");

  console.log("Seed dry-run validation succeeded.");
}

main().catch((error) => {
  console.error("Seed dry-run validation failed:", error);
  process.exit(1);
});

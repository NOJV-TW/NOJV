import { seedProblems, type SeedStorageClient } from "./problems";

function createMockPrisma() {
  const problemById = new Map<string, { id: string; displayId: number | null }>();

  const tx = {
    $executeRaw: async () => 1,
    problem: {
      aggregate: async () => ({ _max: { displayId: null } }),
      upsert: async (args: { create: { id: string; displayId: number | null } }) => {
        const record = { id: String(args.create.id), displayId: args.create.displayId };
        problemById.set(record.id, record);
        return record;
      },
      findUnique: async (args: { where: { id: string } }) => {
        const id = String(args.where.id);
        return problemById.get(id) ?? null;
      },
    },
    problemStatement: {
      upsert: async () => ({}),
    },
    testcaseSet: {
      upsert: async (args: { create: { problemId: string; name: string } }) => ({
        id: `${String(args.create.problemId)}:${String(args.create.name)}`,
      }),
    },
    testcase: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({}),
      createMany: async () => ({ count: 0 }),
    },
    problemWorkspaceFile: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
  };
  return {
    ...tx,
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  };
}

const stubStorage: SeedStorageClient = {
  send: async () => ({}),
};
const validationDigest = `sha256:${"0".repeat(64)}`;

async function main() {
  const prisma = createMockPrisma() as never;

  await seedProblems(prisma, "seed_validation_teacher", {
    advancedDemoImages: {
      run: `registry.invalid/demo/run:validation@${validationDigest}`,
      grade: `registry.invalid/demo/grade:validation@${validationDigest}`,
    },
    storage: stubStorage,
  });

  console.log("Seed dry-run validation succeeded.");
}

try {
  await main();
} catch (error) {
  console.error("Seed dry-run validation failed:", error);
  process.exit(1);
}

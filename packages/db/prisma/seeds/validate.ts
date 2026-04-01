import { seedProblems } from "./problems";

function createMockPrisma() {
  const problemBySlug = new Map<string, { id: string; slug: string }>();

  return {
    problem: {
      upsert: async (args: { create: { id: string; slug: string } }) => {
        const record = {
          id: String(args.create.id),
          slug: String(args.create.slug)
        };
        problemBySlug.set(record.slug, record);
        return record;
      },
      findUnique: async (args: { where: { slug: string } }) => {
        const slug = String(args.where.slug);
        return problemBySlug.get(slug) ?? null;
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
    problemTemplate: {
      upsert: async () => ({})
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

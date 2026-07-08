import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { problemMiniSelect } from "./selects";

type TxClient = TransactionClient;

export const problemRepo = {
  findById(id: string) {
    return prisma.problem.findUnique({ where: { id } });
  },

  findDetailById(id: string) {
    return prisma.problem.findUnique({
      include: {
        _count: {
          select: { submissions: true },
        },
        author: { select: { username: true } },
        statement: true,
        workspaceFiles: {
          orderBy: [{ language: "asc" }, { orderIndex: "asc" }, { path: "asc" }],
        },
        testcaseSets: {
          include: {
            _count: { select: { testcases: true } },
            testcases: {
              orderBy: { ordinal: "asc" },
              take: 10,
            },
          },
          orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }],
        },
      },
      where: { id },
    });
  },

  delete(id: string) {
    return prisma.problem.delete({ where: { id } });
  },

  hasContextLinks(id: string) {
    return prisma.problem
      .findFirst({
        where: {
          id,
          OR: [
            { contestLinks: { some: {} } },
            { examLinks: { some: {} } },
            { assessmentLinks: { some: {} } },
          ],
        },
        select: { id: true },
      })
      .then((row) => row !== null);
  },

  countPublic() {
    return prisma.problem.count({ where: { visibility: "public", status: "published" } });
  },

  count(where: Prisma.ProblemWhereInput = {}) {
    return prisma.problem.count({ where });
  },

  countAll() {
    return prisma.problem.count();
  },

  listWithCounts(opts: {
    where: Prisma.ProblemWhereInput;
    skip: number;
    take: number;
    sort?: "asc" | "desc" | undefined;
  }) {
    return prisma.problem.findMany({
      include: {
        _count: { select: { submissions: true, workspaceFiles: true } },
      },
      orderBy: { displayId: opts.sort ?? "asc" },
      skip: opts.skip,
      take: opts.take,
      where: opts.where,
    });
  },

  listEditable(userId: string, sort: "asc" | "desc" = "asc") {
    return prisma.problem.findMany({
      include: {
        _count: { select: { workspaceFiles: true } },
      },
      orderBy: { displayId: sort },
      where: {
        OR: [
          { authorId: userId },
          {
            assessmentLinks: {
              some: {
                assessment: {
                  course: {
                    memberships: {
                      some: {
                        userId,
                        role: { in: ["teacher", "ta"] },
                        status: "active",
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    });
  },

  findByIds(ids: string[]) {
    return prisma.problem.findMany({
      where: { id: { in: ids } },
      select: problemMiniSelect,
    });
  },

  findScoringInputsByIds(ids: string[]) {
    return prisma.problem.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        type: true,
        advancedConfig: true,
        testcaseSets: { select: { weight: true } },
      },
    });
  },

  async updateAdvancedRequiredPaths(id: string, paths: string[]): Promise<void> {
    await prisma.problem.update({
      where: { id },
      data: { advancedRequiredPaths: paths },
    });
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.problem.findUnique({ where: { id } });
      },

      findMany(where: Prisma.ProblemWhereInput) {
        return tx.problem.findMany({ where });
      },

      create(data: Prisma.ProblemUncheckedCreateInput) {
        return tx.problem.create({ data });
      },

      update(id: string, data: Prisma.ProblemUpdateInput) {
        return tx.problem.update({
          data,
          where: { id },
        });
      },

      lockForUpdate(problemId: string) {
        return tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${problemId} FOR UPDATE`;
      },

      // Serializes concurrent publishes so max(displayId)+1 can't collide.
      // $executeRaw (not $queryRaw) — the function returns void, which
      // $queryRaw cannot deserialize.
      acquireDisplayIdLock() {
        return tx.$executeRaw`SELECT pg_advisory_xact_lock(4711)`;
      },

      maxDisplayId() {
        return tx.problem.aggregate({ _max: { displayId: true } });
      },
    };
  },
};

export const problemStatementRepo = {
  fullTextSearch(query: string) {
    return prisma.$queryRaw<{ problemId: string }[]>`
      SELECT DISTINCT "problemId" FROM "ProblemStatement"
      WHERE to_tsvector('english', coalesce("bodyMarkdown", ''))
      @@ plainto_tsquery('english', ${query})
      UNION
      SELECT "id" AS "problemId" FROM "Problem"
      WHERE to_tsvector('english', "title") @@ plainto_tsquery('english', ${query})
    `;
  },

  likeSearch(query: string) {
    const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return prisma.$queryRaw<{ problemId: string }[]>`
      SELECT DISTINCT "problemId" FROM "ProblemStatement"
      WHERE coalesce("bodyMarkdown", '') ILIKE ${pattern}
      UNION
      SELECT "id" AS "problemId" FROM "Problem"
      WHERE coalesce("title", '') ILIKE ${pattern}
    `;
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.ProblemStatementUncheckedCreateInput) {
        return tx.problemStatement.create({ data });
      },

      upsert(
        problemId: string,
        createData: Prisma.ProblemStatementUncheckedCreateInput,
        updateData: Prisma.ProblemStatementUncheckedUpdateInput,
      ) {
        return tx.problemStatement.upsert({
          create: createData,
          update: updateData,
          where: { problemId },
        });
      },
    };
  },
};

export const problemWorkspaceFileRepo = {
  findByProblemId(problemId: string) {
    return prisma.problemWorkspaceFile.findMany({
      where: { problemId },
      orderBy: [
        { language: "asc" as const },
        { orderIndex: "asc" as const },
        { path: "asc" as const },
      ],
    });
  },

  findOne(
    problemId: string,
    language: Prisma.ProblemWorkspaceFileCreateInput["language"],
    path: string,
  ) {
    return prisma.problemWorkspaceFile.findUnique({
      where: { problemId_language_path: { problemId, language, path } },
    });
  },

  withTx(tx: TxClient) {
    return {
      deleteByProblemId(problemId: string) {
        return tx.problemWorkspaceFile.deleteMany({ where: { problemId } });
      },

      createMany(data: Prisma.ProblemWorkspaceFileCreateManyInput[]) {
        return tx.problemWorkspaceFile.createMany({ data });
      },

      upsertOne(input: {
        id: string;
        problemId: string;
        language: Prisma.ProblemWorkspaceFileCreateInput["language"];
        path: string;
        contentKey: string;
        visibility: Prisma.ProblemWorkspaceFileCreateInput["visibility"];
        orderIndex: number;
      }) {
        return tx.problemWorkspaceFile.upsert({
          where: {
            problemId_language_path: {
              problemId: input.problemId,
              language: input.language,
              path: input.path,
            },
          },
          create: {
            id: input.id,
            problemId: input.problemId,
            language: input.language,
            path: input.path,
            contentKey: input.contentKey,
            visibility: input.visibility,
            orderIndex: input.orderIndex,
          },
          update: {
            contentKey: input.contentKey,
            visibility: input.visibility,
            orderIndex: input.orderIndex,
          },
        });
      },
    };
  },
};

export const testcaseSetRepo = {
  findByProblemId(problemId: string) {
    return prisma.testcaseSet.findMany({
      where: { problemId },
      include: { testcases: { orderBy: { ordinal: "asc" } } },
      orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }],
    });
  },

  findById(id: string) {
    return prisma.testcaseSet.findUnique({
      where: { id },
      include: { testcases: { orderBy: { ordinal: "asc" } } },
    });
  },

  update(id: string, data: Prisma.TestcaseSetUpdateInput) {
    return prisma.testcaseSet.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.testcaseSet.delete({ where: { id } });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.TestcaseSetUncheckedCreateInput) {
        return tx.testcaseSet.create({ data });
      },

      findByProblemId(problemId: string) {
        return tx.testcaseSet.findMany({
          where: { problemId },
          include: { testcases: { orderBy: { ordinal: "asc" } } },
          orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }],
        });
      },

      countByProblem(problemId: string) {
        return tx.testcaseSet.count({ where: { problemId } });
      },

      maxOrdinalByProblem(problemId: string) {
        return tx.testcaseSet.aggregate({ where: { problemId }, _max: { ordinal: true } });
      },

      deleteByProblemId(problemId: string) {
        return tx.testcaseSet.deleteMany({ where: { problemId } });
      },
    };
  },
};

export const testcaseRepo = {
  findById(id: string) {
    return prisma.testcase.findUnique({
      where: { id },
      include: { testcaseSet: { select: { problemId: true } } },
    });
  },

  update(id: string, data: Prisma.TestcaseUpdateInput) {
    return prisma.testcase.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.testcase.delete({ where: { id } });
  },

  withTx(tx: TxClient) {
    return {
      createMany(data: Prisma.TestcaseCreateManyInput[]) {
        return tx.testcase.createMany({ data });
      },
    };
  },
};

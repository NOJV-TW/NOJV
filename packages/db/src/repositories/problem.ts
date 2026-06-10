import { prisma } from "../client";
import type { Prisma, SubtaskScoringStrategy } from "../../generated/prisma/client";
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
        statements: true,
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

  findRecommendations(opts: { excludeIds?: string[]; tags?: string[]; take: number }) {
    return prisma.problem.findMany({
      where: {
        visibility: "public",
        status: "published",
        ...(opts.excludeIds && opts.excludeIds.length > 0
          ? { id: { notIn: opts.excludeIds } }
          : {}),
        ...(opts.tags && opts.tags.length > 0 ? { tags: { hasSome: opts.tags } } : {}),
      },
      select: {
        id: true,
        displayId: true,
        title: true,
        tags: true,
        difficulty: true,
      },
      take: opts.take,
    });
  },

  findByIds(ids: string[]) {
    return prisma.problem.findMany({
      where: { id: { in: ids } },
      select: problemMiniSelect,
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
    };
  },
};

export const problemStatementRepo = {
  fullTextSearch(query: string) {
    return prisma.$queryRaw<{ problemId: string }[]>`
      SELECT DISTINCT "problemId" FROM "ProblemStatementI18n"
      WHERE to_tsvector('english', coalesce("title", '') || ' ' || coalesce("bodyMarkdown", ''))
      @@ plainto_tsquery('english', ${query})
    `;
  },

  likeSearch(query: string) {
    return prisma.problemStatementI18n.findMany({
      select: { problemId: true },
      where: {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { bodyMarkdown: { contains: query, mode: "insensitive" } },
        ],
      },
    });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.ProblemStatementI18nUncheckedCreateInput) {
        return tx.problemStatementI18n.create({ data });
      },

      upsert(
        problemId: string,
        locale: string,
        createData: Prisma.ProblemStatementI18nUncheckedCreateInput,
        updateData: Prisma.ProblemStatementI18nUncheckedUpdateInput,
      ) {
        return tx.problemStatementI18n.upsert({
          create: createData,
          update: updateData,
          where: { problemId_locale: { locale, problemId } },
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

  async updateScoringStrategy(setId: string, strategy: SubtaskScoringStrategy): Promise<void> {
    await prisma.testcaseSet.update({
      where: { id: setId },
      data: { scoringStrategy: strategy },
    });
  },

  delete(id: string) {
    return prisma.testcaseSet.delete({ where: { id } });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.TestcaseSetUncheckedCreateInput) {
        return tx.testcaseSet.create({ data });
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

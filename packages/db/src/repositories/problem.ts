import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { SupportedLanguage } from "../../generated/prisma/enums";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export const problemRepo = {
  findBySlug(slug: string) {
    return prisma.problem.findUnique({ where: { slug } });
  },

  findIdBySlug(slug: string) {
    return prisma.problem.findUnique({
      where: { slug },
      select: { id: true }
    });
  },

  findDifficultyById(id: string) {
    return prisma.problem.findUnique({
      select: { difficulty: true },
      where: { id }
    });
  },

  /** Fetch full problem page data with statements, templates, testcase sets. */
  findDetailBySlug(slug: string) {
    return prisma.problem.findUnique({
      include: {
        _count: {
          select: { submissions: true }
        },
        author: { select: { username: true } },
        statements: true,
        templates: { orderBy: { language: "asc" } },
        testcaseSets: {
          include: {
            _count: { select: { testcases: true } },
            testcases: {
              orderBy: { ordinal: "asc" },
              take: 10
            }
          },
          orderBy: { createdAt: "asc" }
        }
      },
      where: { slug }
    });
  },

  /** Count public problems. */
  countPublic() {
    return prisma.problem.count({ where: { visibility: "public" } });
  },

  count(where: Prisma.ProblemWhereInput = {}) {
    return prisma.problem.count({ where });
  },

  countAll() {
    return prisma.problem.count();
  },

  /** List problems with submission counts (for problem list page). */
  listWithCounts(opts: { where: Prisma.ProblemWhereInput; skip: number; take: number }) {
    return prisma.problem.findMany({
      include: {
        _count: { select: { submissions: true } }
      },
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
      where: opts.where
    });
  },

  /** List problems editable by a user (authored or via course TA/teacher). */
  listEditable(userId: string) {
    return prisma.problem.findMany({
      orderBy: { createdAt: "desc" },
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
                        status: "active"
                      }
                    }
                  }
                }
              }
            }
          }
        ]
      }
    });
  },

  /** Find recommended problems for dashboard. */
  findRecommendations(opts: { excludeIds?: string[]; tags?: string[]; take: number }) {
    return prisma.problem.findMany({
      where: {
        visibility: "public",
        ...(opts.excludeIds && opts.excludeIds.length > 0
          ? { id: { notIn: opts.excludeIds } }
          : {}),
        ...(opts.tags && opts.tags.length > 0 ? { tags: { hasSome: opts.tags } } : {})
      },
      select: {
        slug: true,
        defaultTitle: true,
        difficulty: true,
        tags: true
      },
      take: opts.take
    });
  },

  /** Find problems by IDs (admin stats). */
  findByIds(ids: string[]) {
    return prisma.problem.findMany({
      where: { id: { in: ids } },
      select: { id: true, slug: true, defaultTitle: true }
    });
  },

  // ── Transaction variants ──

  withTx(tx: TxClient) {
    return {
      findBySlug(slug: string) {
        return tx.problem.findUnique({ where: { slug } });
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
          where: { id }
        });
      },

      /** Lock problem row for update. */
      lockForUpdate(problemId: string) {
        return tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${problemId} FOR UPDATE`;
      }
    };
  }
};

export const problemStatementRepo = {
  /** Full-text search for problem IDs via raw SQL. */
  fullTextSearch(query: string) {
    return prisma.$queryRaw<{ problemId: string }[]>`
      SELECT DISTINCT "problemId" FROM "ProblemStatementI18n"
      WHERE to_tsvector('english', coalesce("title", '') || ' ' || coalesce("bodyMarkdown", ''))
      @@ plainto_tsquery('english', ${query})
    `;
  },

  /** LIKE-based search for problem IDs. */
  likeSearch(query: string) {
    return prisma.problemStatementI18n.findMany({
      select: { problemId: true },
      where: {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { bodyMarkdown: { contains: query, mode: "insensitive" } }
        ]
      }
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
        updateData: Prisma.ProblemStatementI18nUncheckedUpdateInput
      ) {
        return tx.problemStatementI18n.upsert({
          create: createData,
          update: updateData,
          where: { problemId_locale: { locale, problemId } }
        });
      }
    };
  }
};

export const problemTemplateRepo = {
  withTx(tx: TxClient) {
    return {
      findByProblemAndLanguage(problemId: string, language: SupportedLanguage) {
        return tx.problemTemplate.findFirst({
          where: { problemId, language },
          select: { id: true }
        });
      },

      deleteByProblemId(problemId: string) {
        return tx.problemTemplate.deleteMany({ where: { problemId } });
      },

      createMany(data: Prisma.ProblemTemplateCreateManyInput[]) {
        return tx.problemTemplate.createMany({ data });
      },

      findByProblemId(problemId: string) {
        return tx.problemTemplate.findMany({
          orderBy: { language: "asc" },
          where: { problemId }
        });
      }
    };
  }
};

export const testcaseSetRepo = {
  findByProblemSlug(problemSlug: string) {
    return prisma.testcaseSet.findMany({
      where: { problem: { slug: problemSlug } },
      include: { testcases: { orderBy: { ordinal: "asc" } } },
      orderBy: { createdAt: "asc" }
    });
  },

  findById(id: string) {
    return prisma.testcaseSet.findUnique({
      where: { id },
      include: { testcases: { orderBy: { ordinal: "asc" } } }
    });
  },

  update(id: string, data: { name?: string; weight?: number; isHidden?: boolean }) {
    return prisma.testcaseSet.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.testcaseSet.delete({ where: { id } });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.TestcaseSetUncheckedCreateInput) {
        return tx.testcaseSet.create({ data });
      }
    };
  }
};

export const testcaseRepo = {
  update(id: string, data: { stdin?: string; expectedStdout?: string }) {
    return prisma.testcase.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.testcase.delete({ where: { id } });
  },

  withTx(tx: TxClient) {
    return {
      createMany(data: Prisma.TestcaseCreateManyInput[]) {
        return tx.testcase.createMany({ data });
      }
    };
  }
};

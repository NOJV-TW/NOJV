import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export const userRepo = {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
  },

  /** List users with filtering and pagination (admin panel). */
  listPaginated(opts: { where: Prisma.UserWhereInput; skip: number; take: number }) {
    return prisma.user.findMany({
      where: opts.where,
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        platformRole: true,
        disabled: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: opts.take,
      skip: opts.skip
    });
  },

  count(where: Prisma.UserWhereInput = {}) {
    return prisma.user.count({ where });
  },

  countAll() {
    return prisma.user.count();
  },

  /** Group users by platform role (admin stats). */
  groupByRole() {
    return prisma.user.groupBy({
      by: ["platformRole"],
      _count: { _all: true }
    });
  },

  update(id: string, data: Prisma.UserUpdateInput) {
    return prisma.user.update({
      where: { id },
      data
    });
  },

  findDisabledStatus(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: { disabled: true }
    });
  },

  // ── Transaction variants ──

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.user.findUnique({ where: { id } });
      },

      create(data: Prisma.UserCreateInput) {
        return tx.user.create({ data });
      },

      update(id: string, data: Prisma.UserUpdateInput) {
        return tx.user.update({ data, where: { id } });
      }
    };
  }
};

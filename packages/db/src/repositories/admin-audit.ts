import { prisma } from "../client";
import type { AdminAuditAction, Prisma } from "../../generated/prisma/client";

export interface AdminAuditLogCreateInput {
  actorId: string | null;
  actorName: string;
  action: AdminAuditAction;
  targetType?: string | null;
  targetId?: string | null;
  summary: string;
}

export const adminAuditLogRepo = {
  create(input: AdminAuditLogCreateInput) {
    return prisma.adminAuditLog.create({
      data: {
        actorId: input.actorId,
        actorName: input.actorName,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        summary: input.summary,
      },
    });
  },

  listPaged(opts: { limit: number; cursor?: string; order?: "asc" | "desc" }) {
    const where: Prisma.AdminAuditLogWhereInput = {};
    const order = opts.order ?? "desc";
    return prisma.adminAuditLog.findMany({
      where,
      orderBy: [{ createdAt: order }, { id: order }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
  },
};

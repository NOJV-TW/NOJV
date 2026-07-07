import { adminAuditLogRepo, type AdminAuditLogCreateInput } from "@nojv/db";

export type AdminAuditAction = AdminAuditLogCreateInput["action"];

export interface RecordAdminAuditInput {
  actorId: string | null;
  actorName: string;
  action: AdminAuditAction;
  targetType?: string | null;
  targetId?: string | null;
  summary: string;
}

export async function recordAdminAudit(input: RecordAdminAuditInput): Promise<void> {
  await adminAuditLogRepo.create(input);
}

export async function listAdminAuditPaged(opts: { limit: number; cursor?: string }) {
  const rows = await adminAuditLogRepo.listPaged(opts);
  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
  const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
  return { items, nextCursor };
}

import type { PageServerLoad } from "./$types";
import { auditDomain } from "@nojv/application";

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ url }) => {
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const order: "asc" | "desc" = url.searchParams.get("order") === "asc" ? "asc" : "desc";

  const { items, nextCursor } = await auditDomain.listAdminAuditPaged({
    limit: PAGE_SIZE,
    order,
    ...(cursor ? { cursor } : {}),
  });

  return { entries: items, nextCursor, order };
};

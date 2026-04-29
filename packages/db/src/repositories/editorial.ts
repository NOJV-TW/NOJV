import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import { userPublicSelect } from "./selects";

export const editorialRepo = {
  /**
   * List live editorials for a problem (soft-deleted rows are filtered).
   */
  listByProblemId(problemId: string) {
    return prisma.editorial.findMany({
      where: { problemId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { user: { select: userPublicSelect } },
    });
  },

  /**
   * Paginated list of live editorials for a problem. `take` is clamped
   * by the caller; `skip` is the offset (page-based pagination).
   */
  listByProblemIdPaged(problemId: string, skip: number, take: number) {
    return prisma.editorial.findMany({
      where: { problemId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { user: { select: userPublicSelect } },
      skip,
      take,
    });
  },

  /**
   * Live count for a problem (soft-deleted rows are filtered). Used by
   * the paginated list page header.
   */
  countByProblemId(problemId: string) {
    return prisma.editorial.count({
      where: { problemId, deletedAt: null },
    });
  },

  /**
   * Find by id, including soft-deleted rows. Domain layer is responsible
   * for translating `deletedAt != null` into NotFoundError so the
   * caller can not distinguish "never existed" from "soft-deleted" for
   * unauthenticated probes.
   */
  findById(id: string) {
    return prisma.editorial.findUnique({
      where: { id },
      include: { user: { select: userPublicSelect } },
    });
  },

  upsert(
    userId: string,
    problemId: string,
    data: { content: string; language: Prisma.EditorialCreateInput["language"] },
  ) {
    // If a soft-deleted row exists with the same composite key, the
    // upsert reuses it: `update` clears `deletedAt` so the editorial is
    // effectively restored with new content. This keeps the composite
    // unique constraint race-safe.
    return prisma.editorial.upsert({
      where: {
        userId_problemId_language: {
          userId,
          problemId,
          language: data.language,
        },
      },
      create: { userId, problemId, content: data.content, language: data.language },
      update: { content: data.content, deletedAt: null },
    });
  },

  /**
   * Partial update of body / language. Returns the updated row.
   * Caller is expected to have already gated on ownership and existence.
   * Only the keys present in `data` are sent to Prisma — passing
   * `undefined` keys would trip `exactOptionalPropertyTypes`.
   */
  update(
    id: string,
    data: { content?: string; language?: Prisma.EditorialCreateInput["language"] },
  ) {
    const update: Prisma.EditorialUpdateInput = {};
    if (data.content !== undefined) update.content = data.content;
    if (data.language !== undefined) update.language = data.language;
    return prisma.editorial.update({
      where: { id },
      data: update,
      include: { user: { select: userPublicSelect } },
    });
  },

  /**
   * Soft-delete by setting `deletedAt`. Idempotent — re-deleting a
   * tombstoned row is allowed (the domain treats double-delete as 404).
   */
  softDelete(id: string, now = new Date()) {
    return prisma.editorial.update({
      where: { id },
      data: { deletedAt: now },
      include: { user: { select: userPublicSelect } },
    });
  },
};

import {
  durableWorkRepo,
  prismaAdapterClient,
  runTransaction,
  type TransactionClient,
} from "@nojv/db";
import {
  listImageObjectInventory,
  readImageObjectInventory,
  type StorageObjectPointer,
} from "@nojv/storage";
import { storage } from "./storage-singleton";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import {
  cancelPendingStorageWriteGuard,
  commitStoragePointerSwap,
  guardStorageObjectWrites,
  STORAGE_OBJECT_CLEANUP_KIND,
} from "./storage-object-lifecycle";
import { createHash } from "node:crypto";

export type UploadedImageKind = "problem" | "content" | "avatar";
export interface ImageInventoryItem {
  pointer: StorageObjectPointer;
  contentType: string;
}
export interface ImageOwner {
  kind: UploadedImageKind;
  userId?: string;
  problemId?: string;
}
export interface UploadedImagePointer {
  id: string;
  key: string;
  size: number;
  sha256: string;
}

export async function importUploadedImageInventory(
  tx: TransactionClient,
  owner: ImageOwner,
  inventory: readonly ImageInventoryItem[],
): Promise<void> {
  await tx.uploadedImage.createMany({
    data: inventory.map(({ pointer, contentType }) => ({
      ...pointer,
      ...owner,
      contentType,
      ready: true,
    })),
    skipDuplicates: true,
  });
}

export async function reserveUploadedImage(
  tx: TransactionClient,
  input: ImageOwner & ImageInventoryItem,
) {
  const row = await tx.uploadedImage.create({
    data: {
      ...input.pointer,
      kind: input.kind,
      userId: input.userId ?? null,
      problemId: input.problemId ?? null,
      contentType: input.contentType,
    },
  });
  await guardStorageObjectWrites([input.pointer], new Date(), tx);
  return row;
}

export async function finalizeUploadedImage(tx: TransactionClient, id: string): Promise<void> {
  const row = await tx.uploadedImage.findUnique({ where: { id } });
  if (!row || row.ready || row.cleanupStarted)
    throw new ConflictError("Image upload has expired.");
  await cancelPendingStorageWriteGuard(tx, row.key);
  await tx.uploadedImage.update({ where: { id }, data: { ready: true } });
}

export async function retireUploadedImages(
  tx: TransactionClient,
  rows: readonly UploadedImagePointer[],
  now = new Date(),
): Promise<void> {
  if (!rows.length) return;
  const ready = new Set(
    (
      await tx.uploadedImage.findMany({
        where: { id: { in: rows.map(({ id }) => id) }, ready: true },
        select: { id: true },
      })
    ).map(({ id }) => id),
  );
  await tx.uploadedImage.updateMany({
    where: { id: { in: rows.map(({ id }) => id) } },
    data: { ready: false },
  });
  await commitStoragePointerSwap(tx, {
    added: [],
    removed: rows.map(({ key, size, sha256 }) => ({ key, size, sha256 })),
    now,
  });
  const repo = durableWorkRepo.withTx(tx);
  for (const row of rows.filter(({ id }) => ready.has(id))) {
    await repo.reschedule({
      kind: STORAGE_OBJECT_CLEANUP_KIND,
      dedupeKey: createHash("sha256").update(row.key).digest("hex"),
      availableAt: now,
      now,
    });
  }
}

export const USER_CONTENT_IMAGE_BUDGET_BYTES = 50 * 1024 * 1024;

export function validateContentImage(body: Buffer, contentType: string): void {
  if (
    !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType) ||
    body.length === 0 ||
    body.length > 5 * 1024 * 1024
  ) {
    throw new ValidationError("Expected an image of at most 5 MiB.");
  }
}

export async function lockImageUser(tx: TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || user.disabled) throw new ForbiddenError("User is unavailable.");
  return user;
}

export async function ensureUserContentImageInventory(userId: string): Promise<void> {
  const user = await prismaAdapterClient.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User is unavailable.");
  if (user.imageInventoryComplete) return;
  const inventory = await listImageObjectInventory(storage(), `users/${userId}/images/`);
  await runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: userId } });
    if (!current) throw new NotFoundError("User is unavailable.");
    if (current.imageInventoryComplete) return;
    await importUploadedImageInventory(tx, { kind: "content", userId }, inventory);
    await tx.user.update({ where: { id: userId }, data: { imageInventoryComplete: true } });
  });
}

export function referencedProblemImageKeys(markdown: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const text of markdown) {
    for (const match of text.matchAll(
      /(?:^|[\s(["'=])\/api\/storage\/problem-images\/([^/\s)\]"'<>]+)\/([^/\s)\]"'<>?#]+)/g,
    )) {
      try {
        if (!match[1] || !match[2]) continue;
        const problemId = decodeURIComponent(match[1]);
        const filename = decodeURIComponent(match[2]);
        if (
          /^[A-Za-z0-9_-]+$/.test(problemId) &&
          /^[A-Za-z0-9_.-]+$/.test(filename) &&
          filename !== "." &&
          filename !== ".."
        ) {
          keys.add(`problems/${problemId}/images/${filename}`);
        }
      } catch {
        /* Invalid URL escapes do not identify a managed image. */
      }
    }
  }
  return [...keys];
}

export async function ensureProblemImageInventory(problemId: string): Promise<void> {
  const problem = await prismaAdapterClient.problem.findUnique({
    where: { id: problemId },
    include: {
      statement: true,
      testcaseSets: { select: { description: true } },
      workspaceFiles: { select: { description: true } },
    },
  });
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  if (problem.imageInventoryComplete) return;
  const markdown = [
    problem.statement?.bodyMarkdown ?? "",
    problem.statement?.inputFormat ?? "",
    problem.statement?.outputFormat ?? "",
    ...problem.testcaseSets.map(({ description }) => description),
    ...problem.workspaceFiles.map(({ description }) => description),
  ];
  const inventory = await listImageObjectInventory(storage(), `problems/${problemId}/images/`);
  const known = new Set(inventory.map(({ pointer }) => pointer.key));
  const references = await readImageObjectInventory(
    storage(),
    referencedProblemImageKeys(markdown).filter((key) => !known.has(key)),
  );
  await runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${problemId} FOR UPDATE`;
    const current = await tx.problem.findUnique({ where: { id: problemId } });
    if (!current) throw new NotFoundError(`Problem not found: ${problemId}`);
    if (current.imageInventoryComplete) return;
    await importUploadedImageInventory(tx, { kind: "problem", problemId }, [
      ...inventory,
      ...references,
    ]);
    await tx.problem.update({
      where: { id: problemId },
      data: { imageInventoryComplete: true },
    });
  });
}

export async function ensurePublicProblemImageInventories(
  problemIds: readonly string[],
): Promise<void> {
  for (const id of new Set(problemIds)) {
    const problem = await prismaAdapterClient.problem.findUnique({ where: { id } });
    if (problem?.visibility === "public" && problem.status === "published")
      await ensureProblemImageInventory(id);
  }
}

export function avatarImageUrl(userId: string, key: string): string {
  return `/api/storage/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(key.slice(`avatars/${userId}/`.length))}`;
}

export async function ensureUserAvatarInventory(
  userId: string,
): Promise<StorageObjectPointer[]> {
  const user = await prismaAdapterClient.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User is unavailable.");
  if (user.avatarInventoryComplete) return [];
  const inventory = await listImageObjectInventory(storage(), `avatars/${userId}/`);
  return runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: userId } });
    if (!current) throw new NotFoundError("User is unavailable.");
    if (current.avatarInventoryComplete) return [];
    const obsolete = [];
    for (const { pointer, contentType } of inventory) {
      const ready = current.image === avatarImageUrl(userId, pointer.key);
      const row = await tx.uploadedImage.create({
        data: { ...pointer, contentType, kind: "avatar", userId, ready },
      });
      if (!ready) obsolete.push(row);
    }
    await retireUploadedImages(tx, obsolete);
    await tx.user.update({ where: { id: userId }, data: { avatarInventoryComplete: true } });
    return obsolete.map(({ key, size, sha256 }) => ({ key, size, sha256 }));
  });
}

export async function ensureUserImagesForDeletion(userId: string): Promise<void> {
  if (!(await prismaAdapterClient.user.findUnique({ where: { id: userId } }))) return;
  await ensureUserContentImageInventory(userId);
  await ensureUserAvatarInventory(userId);
}

export async function ensureProblemImageDependents(problemId: string): Promise<void> {
  await ensureProblemImageInventory(problemId);
  const images = await prismaAdapterClient.uploadedImage.findMany({
    where: { problemId },
    select: { key: true },
  });
  const urls = images.flatMap(({ key }) => {
    const match = /^problems\/([^/]+)\/images\/([^/]+)$/.exec(key);
    if (!match?.[1] || !match[2]) return [];
    return [
      `/api/storage/problem-images/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`,
    ];
  });
  const queue = [problemId];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined) break;
    if (visited.has(id)) continue;
    visited.add(id);
    const dependents = await prismaAdapterClient.problem.findMany({
      where: {
        OR: [
          { forkedFromProblemId: id },
          ...urls.map((url) => ({
            imageInventoryComplete: false,
            OR: [
              {
                statement: {
                  is: {
                    OR: [
                      { bodyMarkdown: { contains: url } },
                      { inputFormat: { contains: url } },
                      { outputFormat: { contains: url } },
                    ],
                  },
                },
              },
              { testcaseSets: { some: { description: { contains: url } } } },
              { workspaceFiles: { some: { description: { contains: url } } } },
            ],
          })),
        ],
      },
      select: { id: true },
    });
    for (const dependent of dependents) {
      await ensureProblemImageInventory(dependent.id);
      queue.push(dependent.id);
    }
  }
}

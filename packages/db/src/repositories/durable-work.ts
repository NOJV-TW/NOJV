import { prisma } from "../client";
import { Prisma, type DurableWorkStatus } from "../../generated/prisma/client";

const MAX_KIND_LENGTH = 64;
const MAX_DEDUPE_KEY_LENGTH = 256;
const MAX_OWNER_LENGTH = 128;
const MAX_BATCH_SIZE = 100;
const MAX_LEASE_DURATION_MS = 60 * 60 * 1_000;
const MAX_ATTEMPTS = 100;

export interface DurableWorkRow {
  id: string;
  kind: string;
  dedupeKey: string;
  payload: Prisma.JsonValue;
  status: DurableWorkStatus;
  availableAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  attempt: number;
  maxAttempts: number;
  lastError: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DurableWorkEnqueueInput {
  kind: string;
  dedupeKey: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
  maxAttempts?: number;
}

export interface DurableWorkClaimInput {
  kinds: readonly string[];
  owner: string;
  limit: number;
  now: Date;
  leaseDurationMs: number;
}

export interface DurableWorkFence {
  id: string;
  owner: string;
  attempt: number;
  now: Date;
}

export interface DurableWorkRetryInput extends DurableWorkFence {
  retryAt: Date;
  error: string;
}

export type DurableWorkRetryDisposition = "retry" | "dead";

export class DurableWorkLeaseLostError extends Error {
  constructor(id: string, owner: string, attempt: number) {
    super(`Durable work lease lost: id=${id}, owner=${owner}, attempt=${String(attempt)}`);
    this.name = "DurableWorkLeaseLostError";
  }
}

function assertIdentifier(name: string, value: string, maxLength: number): void {
  if (value.length === 0 || value !== value.trim() || value.length > maxLength) {
    throw new RangeError(
      `${name} must be non-empty, trimmed, and at most ${String(maxLength)} characters.`,
    );
  }
}

function assertIntegerInRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
}

function assertValidDate(name: string, value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${name} must be a valid Date.`);
  }
}

function assertFence(input: DurableWorkFence): void {
  assertIdentifier("id", input.id, 256);
  assertIdentifier("owner", input.owner, MAX_OWNER_LENGTH);
  assertIntegerInRange("attempt", input.attempt, 1, MAX_ATTEMPTS);
  assertValidDate("now", input.now);
}

export const durableWorkRepo = {
  async enqueue(input: DurableWorkEnqueueInput): Promise<DurableWorkRow> {
    assertIdentifier("kind", input.kind, MAX_KIND_LENGTH);
    assertIdentifier("dedupeKey", input.dedupeKey, MAX_DEDUPE_KEY_LENGTH);
    if (input.availableAt) assertValidDate("availableAt", input.availableAt);
    const maxAttempts = input.maxAttempts ?? 8;
    assertIntegerInRange("maxAttempts", maxAttempts, 1, MAX_ATTEMPTS);

    try {
      return await prisma.durableWork.create({
        data: {
          kind: input.kind,
          dedupeKey: input.dedupeKey,
          payload: input.payload,
          maxAttempts,
          ...(input.availableAt ? { availableAt: input.availableAt } : {}),
        },
      });
    } catch (reason) {
      if (
        !(reason instanceof Prisma.PrismaClientKnownRequestError) ||
        reason.code !== "P2002"
      ) {
        throw reason;
      }
      const existing = await prisma.durableWork.findUnique({
        where: {
          kind_dedupeKey: { kind: input.kind, dedupeKey: input.dedupeKey },
        },
      });
      if (!existing) throw reason;
      return existing;
    }
  },

  async claimBatch(input: DurableWorkClaimInput): Promise<DurableWorkRow[]> {
    if (input.kinds.length === 0) {
      throw new RangeError("kinds must contain at least one registered durable work kind.");
    }
    const kinds = [...new Set(input.kinds)];
    for (const kind of kinds) assertIdentifier("kind", kind, MAX_KIND_LENGTH);
    assertIdentifier("owner", input.owner, MAX_OWNER_LENGTH);
    assertIntegerInRange("limit", input.limit, 1, MAX_BATCH_SIZE);
    assertIntegerInRange("leaseDurationMs", input.leaseDurationMs, 1, MAX_LEASE_DURATION_MS);
    assertValidDate("now", input.now);
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);

    return prisma.$queryRaw<DurableWorkRow[]>(Prisma.sql`
      WITH exhausted AS (
        UPDATE "DurableWork"
        SET
          "status" = 'dead',
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "completedAt" = ${input.now},
          "updatedAt" = ${input.now}
        WHERE
          "kind" IN (${Prisma.join(kinds)})
          AND "status" = 'leased'
          AND "leaseExpiresAt" <= ${input.now}
          AND "attempt" >= "maxAttempts"
      ),
      candidates AS (
        SELECT "id"
        FROM "DurableWork"
        WHERE
          "kind" IN (${Prisma.join(kinds)})
          AND "attempt" < "maxAttempts"
          AND (
            ("status" = 'pending' AND "availableAt" <= ${input.now})
            OR ("status" = 'leased' AND "leaseExpiresAt" <= ${input.now})
          )
        ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.limit}
      )
      UPDATE "DurableWork" AS work
      SET
        "status" = 'leased',
        "leaseOwner" = ${input.owner},
        "leaseExpiresAt" = ${leaseExpiresAt},
        "attempt" = work."attempt" + 1,
        "updatedAt" = ${input.now}
      FROM candidates
      WHERE work."id" = candidates."id"
      RETURNING work.*
    `);
  },

  async complete(input: DurableWorkFence): Promise<void> {
    assertFence(input);
    const result = await prisma.durableWork.updateMany({
      where: {
        id: input.id,
        status: "leased",
        leaseOwner: input.owner,
        attempt: input.attempt,
        leaseExpiresAt: { gt: input.now },
      },
      data: {
        status: "succeeded",
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: input.now,
        updatedAt: input.now,
      },
    });
    if (result.count !== 1) {
      throw new DurableWorkLeaseLostError(input.id, input.owner, input.attempt);
    }
  },

  async retryOrDead(input: DurableWorkRetryInput): Promise<DurableWorkRetryDisposition> {
    assertFence(input);
    assertValidDate("retryAt", input.retryAt);
    if (input.retryAt < input.now) {
      throw new RangeError("retryAt must not be earlier than now.");
    }
    if (input.error.length === 0) throw new RangeError("error must not be empty.");

    const rows = await prisma.$queryRaw<{ status: DurableWorkStatus }[]>(Prisma.sql`
      UPDATE "DurableWork"
      SET
        "status" = CASE
          WHEN "attempt" >= "maxAttempts" THEN 'dead'::"DurableWorkStatus"
          ELSE 'pending'::"DurableWorkStatus"
        END,
        "availableAt" = CASE
          WHEN "attempt" >= "maxAttempts" THEN "availableAt"
          ELSE ${input.retryAt}::timestamp(3)
        END,
        "leaseOwner" = NULL,
        "leaseExpiresAt" = NULL,
        "lastError" = ${input.error},
        "completedAt" = CASE
          WHEN "attempt" >= "maxAttempts" THEN ${input.now}::timestamp(3)
          ELSE NULL
        END,
        "updatedAt" = ${input.now}
      WHERE
        "id" = ${input.id}
        AND "status" = 'leased'
        AND "leaseOwner" = ${input.owner}
        AND "attempt" = ${input.attempt}
        AND "leaseExpiresAt" > ${input.now}
      RETURNING "status"
    `);
    const row = rows[0];
    if (!row) throw new DurableWorkLeaseLostError(input.id, input.owner, input.attempt);
    return row.status === "dead" ? "dead" : "retry";
  },
};

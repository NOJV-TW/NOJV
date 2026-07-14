import { isDeepStrictEqual } from "node:util";

import { prisma } from "../client";
import { Prisma, type DurableWorkStatus } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

const MAX_KIND_LENGTH = 64;
const MAX_DEDUPE_KEY_LENGTH = 256;
const MAX_OWNER_LENGTH = 128;
const MAX_BATCH_SIZE = 100;
const MAX_LEASE_DURATION_MS = 60 * 60 * 1_000;
const MAX_ATTEMPTS = 100;
const IMMEDIATELY_AVAILABLE_AT = new Date(0);

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
  result: Prisma.JsonValue | null;
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

export interface DurableWorkCompleteInput extends DurableWorkFence {
  result?: Prisma.InputJsonValue;
}

export interface DurableWorkKey {
  kind: string;
  dedupeKey: string;
}

export interface DurableWorkCancelInput extends DurableWorkKey {
  now: Date;
}

export interface DurableWorkRescheduleInput extends DurableWorkKey {
  availableAt: Date;
  now: Date;
}

export type DurableWorkRetryDisposition = "retry" | "dead";

export class DurableWorkLeaseLostError extends Error {
  constructor(id: string, owner: string, attempt: number) {
    super(`Durable work lease lost: id=${id}, owner=${owner}, attempt=${String(attempt)}`);
    this.name = "DurableWorkLeaseLostError";
  }
}

export class DurableWorkInvariantError extends Error {
  constructor(kind: string, dedupeKey: string, detail: string) {
    super(`Durable work invariant conflict: kind=${kind}, dedupeKey=${dedupeKey}, ${detail}`);
    this.name = "DurableWorkInvariantError";
  }
}

type DurableWorkClient = Pick<TransactionClient, "durableWork" | "$queryRaw">;

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

function assertKey(input: DurableWorkKey): void {
  assertIdentifier("kind", input.kind, MAX_KIND_LENGTH);
  assertIdentifier("dedupeKey", input.dedupeKey, MAX_DEDUPE_KEY_LENGTH);
}

function validatedEnqueueInput(input: DurableWorkEnqueueInput): {
  availableAt: Date;
  maxAttempts: number;
} {
  assertKey(input);
  if (input.availableAt) assertValidDate("availableAt", input.availableAt);
  const maxAttempts = input.maxAttempts ?? 8;
  assertIntegerInRange("maxAttempts", maxAttempts, 1, MAX_ATTEMPTS);
  return {
    maxAttempts,
    availableAt: input.availableAt ?? IMMEDIATELY_AVAILABLE_AT,
  };
}

function assertCanonicalEnqueue(
  existing: DurableWorkRow,
  input: DurableWorkEnqueueInput,
  maxAttempts: number,
): void {
  if (!isDeepStrictEqual(existing.payload, input.payload)) {
    throw new DurableWorkInvariantError(input.kind, input.dedupeKey, "payload differs");
  }
  if (existing.maxAttempts !== maxAttempts) {
    throw new DurableWorkInvariantError(input.kind, input.dedupeKey, "maxAttempts differs");
  }
  if (
    existing.availableAt.getTime() !== (input.availableAt ?? IMMEDIATELY_AVAILABLE_AT).getTime()
  ) {
    throw new DurableWorkInvariantError(input.kind, input.dedupeKey, "availableAt differs");
  }
}

function assertCanonicalIdentity(
  existing: DurableWorkRow,
  input: DurableWorkEnqueueInput,
  maxAttempts: number,
): void {
  if (!isDeepStrictEqual(existing.payload, input.payload)) {
    throw new DurableWorkInvariantError(input.kind, input.dedupeKey, "payload differs");
  }
  if (existing.maxAttempts !== maxAttempts) {
    throw new DurableWorkInvariantError(input.kind, input.dedupeKey, "maxAttempts differs");
  }
  if (input.availableAt && existing.availableAt.getTime() !== input.availableAt.getTime()) {
    throw new DurableWorkInvariantError(
      input.kind,
      input.dedupeKey,
      "availableAt must be changed with reschedule",
    );
  }
}

function createDurableWorkRepository(client: DurableWorkClient) {
  return {
    async enqueue(input: DurableWorkEnqueueInput): Promise<DurableWorkRow> {
      const { maxAttempts, availableAt } = validatedEnqueueInput(input);
      await client.durableWork.createMany({
        data: [
          {
            kind: input.kind,
            dedupeKey: input.dedupeKey,
            payload: input.payload,
            maxAttempts,
            availableAt,
          },
        ],
        skipDuplicates: true,
      });
      const existing = await client.durableWork.findUniqueOrThrow({
        where: { kind_dedupeKey: { kind: input.kind, dedupeKey: input.dedupeKey } },
      });
      assertCanonicalEnqueue(existing, input, maxAttempts);
      return existing;
    },

    async enqueueMany(inputs: readonly DurableWorkEnqueueInput[]): Promise<DurableWorkRow[]> {
      if (inputs.length === 0) return [];
      const validated = inputs.map((input) => ({ input, ...validatedEnqueueInput(input) }));
      const uniqueKeys = new Set(inputs.map((input) => `${input.kind}\0${input.dedupeKey}`));
      if (uniqueKeys.size !== inputs.length) {
        throw new RangeError("enqueueMany inputs must have unique kind and dedupeKey pairs.");
      }
      await client.durableWork.createMany({
        data: validated.map(({ input, maxAttempts, availableAt }) => ({
          kind: input.kind,
          dedupeKey: input.dedupeKey,
          payload: input.payload,
          maxAttempts,
          availableAt,
        })),
        skipDuplicates: true,
      });
      const rows = await client.durableWork.findMany({
        where: {
          OR: inputs.map(({ kind, dedupeKey }) => ({ kind, dedupeKey })),
        },
      });
      const byKey = new Map(rows.map((row) => [`${row.kind}\0${row.dedupeKey}`, row]));
      return validated.map(({ input, maxAttempts }) => {
        const row = byKey.get(`${input.kind}\0${input.dedupeKey}`);
        if (!row) {
          throw new Error(
            `Durable work disappeared after enqueue: kind=${input.kind}, dedupeKey=${input.dedupeKey}`,
          );
        }
        assertCanonicalEnqueue(row, input, maxAttempts);
        return row;
      });
    },

    async cancel(input: DurableWorkCancelInput): Promise<boolean> {
      assertKey(input);
      assertValidDate("now", input.now);
      const result = await client.durableWork.updateMany({
        where: {
          kind: input.kind,
          dedupeKey: input.dedupeKey,
          status: { in: ["pending", "leased"] },
        },
        data: {
          status: "cancelled",
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: input.now,
          updatedAt: input.now,
        },
      });
      return result.count === 1;
    },

    async reactivate(input: DurableWorkEnqueueInput): Promise<DurableWorkRow> {
      const { maxAttempts } = validatedEnqueueInput(input);
      const existing = await client.durableWork.findUnique({
        where: { kind_dedupeKey: { kind: input.kind, dedupeKey: input.dedupeKey } },
      });
      if (!existing || !["succeeded", "dead", "cancelled"].includes(existing.status)) {
        throw new DurableWorkInvariantError(
          input.kind,
          input.dedupeKey,
          "only terminal work can be reactivated",
        );
      }
      assertCanonicalIdentity(existing, input, maxAttempts);
      try {
        return await client.durableWork.update({
          where: {
            kind_dedupeKey: { kind: input.kind, dedupeKey: input.dedupeKey },
            status: { in: ["succeeded", "dead", "cancelled"] },
          },
          data: {
            status: "pending",
            attempt: 0,
            lastError: null,
            result: Prisma.DbNull,
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt: null,
          },
        });
      } catch (reason) {
        if (
          !(reason instanceof Prisma.PrismaClientKnownRequestError) ||
          reason.code !== "P2025"
        ) {
          throw reason;
        }
        throw new DurableWorkInvariantError(
          input.kind,
          input.dedupeKey,
          "only terminal work can be reactivated",
        );
      }
    },

    async reschedule(input: DurableWorkRescheduleInput): Promise<boolean> {
      assertKey(input);
      assertValidDate("availableAt", input.availableAt);
      assertValidDate("now", input.now);
      const result = await client.durableWork.updateMany({
        where: { kind: input.kind, dedupeKey: input.dedupeKey, status: "pending" },
        data: { availableAt: input.availableAt, updatedAt: input.now },
      });
      return result.count === 1;
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

      return client.$queryRaw<DurableWorkRow[]>(Prisma.sql`
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

    async complete(input: DurableWorkCompleteInput): Promise<void> {
      assertFence(input);
      const result = await client.durableWork.updateMany({
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
          result: input.result ?? Prisma.DbNull,
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

      const rows = await client.$queryRaw<{ status: DurableWorkStatus }[]>(Prisma.sql`
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
}

export const durableWorkRepo = {
  ...createDurableWorkRepository(prisma),
  withTx(tx: TransactionClient) {
    return createDurableWorkRepository(tx);
  },
};

CREATE TYPE "DurableWorkStatus" AS ENUM ('pending', 'leased', 'succeeded', 'dead', 'cancelled');

CREATE TABLE "DurableWork" (
  "id" TEXT NOT NULL,
  "kind" VARCHAR(64) NOT NULL,
  "dedupeKey" VARCHAR(256) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "DurableWorkStatus" NOT NULL DEFAULT 'pending',
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" VARCHAR(128),
  "leaseExpiresAt" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "lastError" TEXT,
  "result" JSONB,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DurableWork_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DurableWork_kind_dedupeKey_key" UNIQUE ("kind", "dedupeKey")
);

ALTER TABLE "DurableWork"
ADD CONSTRAINT "DurableWork_identifiers_chk"
CHECK (
  "kind" = BTRIM("kind")
  AND "kind" <> ''
  AND "dedupeKey" = BTRIM("dedupeKey")
  AND "dedupeKey" <> ''
  AND (
    "leaseOwner" IS NULL
    OR ("leaseOwner" = BTRIM("leaseOwner") AND "leaseOwner" <> '')
  )
);

ALTER TABLE "DurableWork"
ADD CONSTRAINT "DurableWork_attempts_chk"
CHECK (
  "attempt" >= 0
  AND "maxAttempts" BETWEEN 1 AND 100
  AND "attempt" <= "maxAttempts"
);

ALTER TABLE "DurableWork"
ADD CONSTRAINT "DurableWork_state_chk"
CHECK (
  (
    "status" = 'pending'
    AND "attempt" < "maxAttempts"
    AND "leaseOwner" IS NULL
    AND "leaseExpiresAt" IS NULL
    AND "completedAt" IS NULL
  )
  OR (
    "status" = 'leased'
    AND "attempt" BETWEEN 1 AND "maxAttempts"
    AND "leaseOwner" IS NOT NULL
    AND "leaseExpiresAt" IS NOT NULL
    AND "completedAt" IS NULL
  )
  OR (
    "status" IN ('succeeded', 'dead')
    AND "attempt" BETWEEN 1 AND "maxAttempts"
    AND "leaseOwner" IS NULL
    AND "leaseExpiresAt" IS NULL
    AND "completedAt" IS NOT NULL
  )
  OR (
    "status" = 'cancelled'
    AND "attempt" BETWEEN 0 AND "maxAttempts"
    AND "leaseOwner" IS NULL
    AND "leaseExpiresAt" IS NULL
    AND "completedAt" IS NOT NULL
  )
);

CREATE INDEX "DurableWork_status_availableAt_createdAt_idx"
ON "DurableWork"("status", "availableAt", "createdAt");

CREATE INDEX "DurableWork_status_leaseExpiresAt_idx"
ON "DurableWork"("status", "leaseExpiresAt");

CREATE INDEX "DurableWork_kind_status_availableAt_idx"
ON "DurableWork"("kind", "status", "availableAt");

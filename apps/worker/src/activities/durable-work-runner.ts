export interface ClaimedDurableWork {
  id: string;
  kind: string;
  payload: unknown;
  attempt: number;
}

export interface DurableWorkClaimOptions {
  kinds: readonly string[];
  owner: string;
  limit: number;
  now: Date;
  leaseDurationMs: number;
}

export interface DurableWorkFenceOptions {
  id: string;
  owner: string;
  attempt: number;
  now: Date;
}

export interface DurableWorkRetryOptions extends DurableWorkFenceOptions {
  retryAt: Date;
  error: string;
}

export interface DurableWorkBatchRepository {
  claimBatch(options: DurableWorkClaimOptions): Promise<readonly ClaimedDurableWork[]>;
  complete(options: DurableWorkFenceOptions): Promise<void>;
  retryOrDead(options: DurableWorkRetryOptions): Promise<"retry" | "dead">;
}

export interface DurableWorkHandlerContext {
  id: string;
  kind: string;
  attempt: number;
}

export type DurableWorkHandler = (
  payload: unknown,
  context: DurableWorkHandlerContext,
) => Promise<void>;

export type DurableWorkHandlerRegistry = Readonly<Record<string, DurableWorkHandler>>;

export type DurableWorkOutcome = "succeeded" | "retry" | "dead";

export interface DurableWorkBatchResult {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
}

export interface DurableWorkBatchDependencies {
  repository: DurableWorkBatchRepository;
  handlers: DurableWorkHandlerRegistry;
  ownerFactory: () => string;
  recordOutcome: (
    kind: string,
    outcome: DurableWorkOutcome,
    registeredKinds: ReadonlySet<string>,
  ) => void;
  clock?: () => Date;
  limit?: number;
  leaseDurationMs?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_LEASE_DURATION_MS = 60_000;
const DEFAULT_BASE_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 15 * 60_000;
const MAX_ERROR_LENGTH = 4_096;

function retryDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 30));
  return Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
}

function errorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return (message || "Unknown durable work handler failure").slice(0, MAX_ERROR_LENGTH);
}

export async function processDurableWorkBatch(
  dependencies: DurableWorkBatchDependencies,
): Promise<DurableWorkBatchResult> {
  const kinds = Object.keys(dependencies.handlers).sort();
  if (kinds.length === 0) {
    return { claimed: 0, succeeded: 0, retried: 0, dead: 0 };
  }

  const registeredKinds = new Set(kinds);
  const clock = dependencies.clock ?? (() => new Date());
  const claimNow = clock();
  const owner = dependencies.ownerFactory();
  const claimed = await dependencies.repository.claimBatch({
    kinds,
    owner,
    limit: dependencies.limit ?? DEFAULT_BATCH_SIZE,
    now: claimNow,
    leaseDurationMs: dependencies.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
  });
  const result: DurableWorkBatchResult = {
    claimed: claimed.length,
    succeeded: 0,
    retried: 0,
    dead: 0,
  };

  for (const work of claimed) {
    const handler = dependencies.handlers[work.kind];
    if (!handler) {
      throw new Error(`Repository returned unregistered durable work kind: ${work.kind}`);
    }
    try {
      await handler(work.payload, {
        id: work.id,
        kind: work.kind,
        attempt: work.attempt,
      });
    } catch (reason) {
      const baseDelayMs = dependencies.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
      const maxDelayMs = dependencies.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
      const failedAt = clock();
      const retryAt = new Date(
        failedAt.getTime() + retryDelayMs(work.attempt, baseDelayMs, maxDelayMs),
      );
      const disposition = await dependencies.repository.retryOrDead({
        id: work.id,
        owner,
        attempt: work.attempt,
        now: failedAt,
        retryAt,
        error: errorMessage(reason),
      });
      if (disposition === "dead") result.dead += 1;
      else result.retried += 1;
      dependencies.recordOutcome(work.kind, disposition, registeredKinds);
      continue;
    }

    await dependencies.repository.complete({
      id: work.id,
      owner,
      attempt: work.attempt,
      now: clock(),
    });
    result.succeeded += 1;
    dependencies.recordOutcome(work.kind, "succeeded", registeredKinds);
  }

  return result;
}

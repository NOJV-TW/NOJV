export interface RejudgeTarget {
  submissionId: string;
}

export class RejudgeBatchError extends Error {
  readonly failedSubmissionIds: readonly string[];

  constructor(failedSubmissionIds: readonly string[]) {
    super(`Rejudge failed for ${String(failedSubmissionIds.length)} submission(s)`);
    this.name = "RejudgeBatchError";
    this.failedSubmissionIds = failedSubmissionIds;
  }
}

export async function executeRejudgeBatches<T extends RejudgeTarget>(options: {
  targets: readonly T[];
  batchSize: number;
  execute: (target: T) => Promise<void>;
  isCancellation: (error: unknown) => boolean;
  onCompleted: () => void;
  onFailure: (target: T, error: unknown) => void;
}): Promise<void> {
  const failedSubmissionIds: string[] = [];

  for (let index = 0; index < options.targets.length; index += options.batchSize) {
    const batch = options.targets.slice(index, index + options.batchSize);
    const results = await Promise.allSettled(
      batch.map(async (target) => {
        await options.execute(target);
        options.onCompleted();
      }),
    );

    for (const [resultIndex, result] of results.entries()) {
      if (result.status === "fulfilled") continue;
      if (options.isCancellation(result.reason)) throw result.reason;

      const target = batch[resultIndex];
      if (!target) throw new Error("Rejudge batch result does not match its target");
      failedSubmissionIds.push(target.submissionId);
      options.onFailure(target, result.reason);
    }
  }

  if (failedSubmissionIds.length > 0) {
    throw new RejudgeBatchError(failedSubmissionIds);
  }
}

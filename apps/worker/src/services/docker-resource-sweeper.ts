import { sweepOrphanContainers } from "./docker-container";
import { sweepOrphanNetworks } from "./docker-network";

export const DOCKER_RESOURCE_SWEEP_INTERVAL_MS = 60_000;

interface DockerResourceSweepDependencies {
  sweepContainers: () => Promise<void>;
  sweepNetworks: () => Promise<void>;
}

export class DockerResourceSweeper {
  readonly done: Promise<void>;

  private readonly dependencies: DockerResourceSweepDependencies;
  private readonly intervalMs: number;
  private resolveDone!: () => void;
  private rejectDone!: (error: Error) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private started = false;
  private stopping = false;
  private settled = false;

  constructor(
    dependencies: DockerResourceSweepDependencies,
    intervalMs = DOCKER_RESOURCE_SWEEP_INTERVAL_MS,
  ) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
      throw new RangeError("Docker resource sweep interval must be a positive safe integer.");
    }
    this.dependencies = dependencies;
    this.intervalMs = intervalMs;
    this.done = new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("Docker resource sweeper has already started.");
    this.started = true;
    await this.sweepOnce();
    if (!this.stopping) this.scheduleNext();
  }

  async shutdown(): Promise<void> {
    if (this.stopping) {
      await this.inFlight?.catch(() => undefined);
      return;
    }
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inFlight?.catch(() => undefined);
    this.settleSuccess();
  }

  private async sweepOnce(): Promise<void> {
    await this.dependencies.sweepContainers();
    await this.dependencies.sweepNetworks();
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const operation = this.sweepOnce();
      this.inFlight = operation;
      void operation.then(
        () => {
          this.inFlight = null;
          if (!this.stopping) this.scheduleNext();
        },
        (error: unknown) => {
          this.inFlight = null;
          this.stopping = true;
          this.settleFailure(error);
        },
      );
    }, this.intervalMs);
  }

  private settleSuccess(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveDone();
  }

  private settleFailure(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectDone(
      error instanceof Error
        ? error
        : new Error("Docker resource sweep failed.", { cause: error }),
    );
  }
}

export function createDockerResourceSweeper(
  dependencies: DockerResourceSweepDependencies = {
    sweepContainers: sweepOrphanContainers,
    sweepNetworks: sweepOrphanNetworks,
  },
  intervalMs = DOCKER_RESOURCE_SWEEP_INTERVAL_MS,
): DockerResourceSweeper {
  return new DockerResourceSweeper(dependencies, intervalMs);
}

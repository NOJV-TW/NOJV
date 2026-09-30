import { readFileSync } from "node:fs";

import { metrics, type BatchObservableResult } from "@opentelemetry/api";
import type {
  ActivitySlotInfo,
  CustomSlotSupplier,
  SlotPermit,
  SlotReserveContext,
  SlotReleaseContext,
} from "@temporalio/worker";

import { createLogger } from "./logger.js";

const logger = createLogger("judge-slots");

export const NODE_CPU_TARGET = 0.8;
export const NODE_MEMORY_AVAILABLE_FLOOR = 0.2;
export const SAMPLE_INTERVAL_MS = 2_500;
const GROWTH_COOLDOWN_SAMPLES = 2;

export interface NodeLoad {
  cpu: number;
  memoryAvailable: number;
}

interface CpuCounters {
  busy: number;
  total: number;
}

function readCpuCounters(procRoot: string): CpuCounters {
  const line = readFileSync(`${procRoot}/stat`, "utf8").split("\n", 1)[0] ?? "";
  const fields = line.trim().split(/\s+/).slice(1, 9).map(Number);
  if (!line.startsWith("cpu ") || fields.length < 5 || fields.some((v) => !Number.isFinite(v)))
    throw new Error(`Unreadable ${procRoot}/stat cpu line.`);
  const total = fields.reduce((sum, value) => sum + value, 0);
  const idle = (fields[3] ?? 0) + (fields[4] ?? 0);
  return { busy: total - idle, total };
}

function readMemoryAvailable(procRoot: string): number {
  const text = readFileSync(`${procRoot}/meminfo`, "utf8");
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(text)?.[1]);
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  if (!(total > 0) || !Number.isFinite(available))
    throw new Error(`Unreadable ${procRoot}/meminfo.`);
  return available / total;
}

export function createNodeLoadReader(procRoot = "/proc"): () => NodeLoad {
  let previous = readCpuCounters(procRoot);
  readMemoryAvailable(procRoot);
  return () => {
    const current = readCpuCounters(procRoot);
    const total = current.total - previous.total;
    const cpu = total > 0 ? (current.busy - previous.busy) / total : 0;
    previous = current;
    return { cpu, memoryAvailable: readMemoryAvailable(procRoot) };
  };
}

export class NodeLoadSlotSupplier implements CustomSlotSupplier<ActivitySlotInfo> {
  readonly type = "custom";
  private budgetValue: number;
  private issued = 0;
  private usedValue = 0;
  private samplesSinceGrowth = GROWTH_COOLDOWN_SAMPLES;
  private readonly waiters: (() => void)[] = [];

  constructor(
    private readonly min: number,
    private readonly max: number,
  ) {
    this.budgetValue = min;
  }

  get budget(): number {
    return this.budgetValue;
  }

  get used(): number {
    return this.usedValue;
  }

  adjust(load: NodeLoad): void {
    const previous = this.budgetValue;
    this.samplesSinceGrowth += 1;
    if (load.cpu >= NODE_CPU_TARGET || load.memoryAvailable < NODE_MEMORY_AVAILABLE_FLOOR) {
      this.budgetValue = Math.max(this.min, Math.min(this.budgetValue, this.usedValue - 1));
    } else if (
      this.usedValue >= this.budgetValue &&
      this.budgetValue < this.max &&
      this.samplesSinceGrowth >= GROWTH_COOLDOWN_SAMPLES
    ) {
      this.budgetValue += 1;
      this.samplesSinceGrowth = 0;
      this.wake();
    }
    if (this.budgetValue !== previous)
      logger.info("judge slot budget changed", {
        budget: this.budgetValue,
        previous,
        used: this.usedValue,
        cpu: Number(load.cpu.toFixed(3)),
        memoryAvailable: Number(load.memoryAvailable.toFixed(3)),
      });
  }

  reserveSlot(_ctx: SlotReserveContext, abortSignal: AbortSignal): Promise<SlotPermit> {
    if (abortSignal.aborted) return Promise.reject(abortSignal.reason as Error);
    if (this.issued < this.budgetValue) {
      this.issued += 1;
      return Promise.resolve({});
    }
    return new Promise((resolve, reject) => {
      const waiter = () => {
        abortSignal.removeEventListener("abort", onAbort);
        this.issued += 1;
        resolve({});
      };
      const onAbort = () => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(abortSignal.reason as Error);
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  tryReserveSlot(): SlotPermit | null {
    if (this.issued >= this.budgetValue || this.waiters.length > 0) return null;
    this.issued += 1;
    return {};
  }

  markSlotUsed(): void {
    this.usedValue += 1;
  }

  releaseSlot(ctx: SlotReleaseContext<ActivitySlotInfo>): void {
    this.issued -= 1;
    if (ctx.slotInfo) this.usedValue -= 1;
    this.wake();
  }

  private wake(): void {
    while (this.issued < this.budgetValue && this.waiters.length > 0) this.waiters.shift()?.();
  }
}

export function startNodeLoadSlots(
  min: number,
  max: number,
  readLoad: () => NodeLoad = createNodeLoadReader(),
): { supplier: NodeLoadSlotSupplier; stop: () => void } {
  const supplier = new NodeLoadSlotSupplier(Math.min(min, max), max);
  let lastLoad: NodeLoad | null = null;
  const timer = setInterval(() => {
    try {
      lastLoad = readLoad();
      supplier.adjust(lastLoad);
    } catch (error) {
      logger.warn("node load sample failed", {
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }, SAMPLE_INTERVAL_MS);
  timer.unref();

  const meter = metrics.getMeter("nojv-judge");
  const budget = meter.createObservableGauge("judge_slot_budget");
  const used = meter.createObservableGauge("judge_slots_used");
  const cpu = meter.createObservableGauge("judge_node_cpu_utilization");
  const observe = (result: BatchObservableResult) => {
    result.observe(budget, supplier.budget);
    result.observe(used, supplier.used);
    if (lastLoad) result.observe(cpu, lastLoad.cpu);
  };
  meter.addBatchObservableCallback(observe, [budget, used, cpu]);

  return {
    supplier,
    stop: () => {
      clearInterval(timer);
      meter.removeBatchObservableCallback(observe, [budget, used, cpu]);
    },
  };
}

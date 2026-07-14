function seconds(value: number): number {
  return value * 1_000;
}

export const DURABLE_WORK_ACTIVITY_TIMEOUT_MS = seconds(120);
export const DURABLE_WORK_LEASE_DURATION_MS = seconds(180);
export const DURABLE_WORK_ACTIVITY_MAX_ATTEMPTS = 1;
export const DURABLE_WORK_ITEMS_PER_EXECUTION = 100;
export const DURABLE_WORK_CONCURRENCY = 8;

if (DURABLE_WORK_LEASE_DURATION_MS <= DURABLE_WORK_ACTIVITY_TIMEOUT_MS) {
  throw new Error("Durable work lease must outlive its non-retrying Temporal activity.");
}

if (DURABLE_WORK_CONCURRENCY > DURABLE_WORK_ITEMS_PER_EXECUTION) {
  throw new Error("Durable work concurrency cannot exceed the execution item bound.");
}

import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const registry = new Registry();

export const submissionJobsTotal = new Counter({
  name: "nojv_submission_jobs_total",
  help: "Total submission jobs processed",
  labelNames: ["status", "language"] as const,
  registers: [registry]
});

export const submissionDurationSeconds = new Histogram({
  name: "nojv_submission_duration_seconds",
  help: "Submission processing duration in seconds",
  labelNames: ["language", "verdict"] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry]
});

export const activeJobs = new Gauge({
  name: "nojv_active_jobs",
  help: "Number of currently processing jobs",
  registers: [registry]
});

export const queueDepth = new Gauge({
  name: "nojv_queue_depth",
  help: "Number of jobs waiting in queue",
  labelNames: ["queue"] as const,
  registers: [registry]
});

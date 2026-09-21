import { createHash } from "node:crypto";
import { open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { submissionDraftSchema } from "../packages/core/src/schemas/submission.js";
import { submissionResultVerdictSchema } from "../packages/core/src/types.js";

const nonnegative = z.number().finite().nonnegative();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const workload = z.enum(["short", "cpu-heavy", "memory-heavy"]);
const load = z.enum(["single", "steady", "burst"]);
const cache = z.enum(["cold", "warm"]);
const fixtureSchema = z
  .object({
    id: z.string().min(1),
    workload,
    cases: z.union([z.literal(20), z.literal(100)]),
    datasetSha256: sha256,
    expectedVerdict: submissionResultVerdictSchema.exclude(["system_error"]),
    payload: submissionDraftSchema.refine(
      (value) => !value.sampleOnly && !value.referenceSolution && !value.runCases,
      "Benchmark full submissions using student source files",
    ),
  })
  .strict();

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    target: z.url(),
    targetKind: z.enum(["isolated-test", "shared-server"]),
    sandboxImageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    backgroundServicesSha256: sha256,
    machineProfileSha256: sha256,
    dedicatedTestAccounts: z.literal(true),
    accounts: z
      .array(
        z
          .object({
            userId: z.string().min(1),
            tokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
          })
          .strict(),
      )
      .length(100),
    fixtures: z.array(fixtureSchema).length(6),
    maintenance: z
      .object({
        approvalReference: z.string().min(1),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        realJudgeDrained: z.literal(true),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ["userId", "tokenEnv"] as const) {
      if (new Set(value.accounts.map((account) => account[key])).size !== 100) {
        ctx.addIssue({
          code: "custom",
          message: `100 distinct account ${key} values required`,
        });
      }
    }
    if (
      new Set(value.fixtures.map((fixture) => `${fixture.workload}/${fixture.cases}`)).size !==
        6 ||
      new Set(value.fixtures.map((fixture) => fixture.id)).size !== 6
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Require one unique fixture for each workload and case count",
      });
    }
  });

export const trialSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.string().min(1),
    fixtureId: z.string().min(1),
    workload,
    cases: z.union([z.literal(20), z.literal(100)]),
    load,
    cache,
    repetition: z.number().int().min(1).max(3),
    fixedInputsSha256: sha256,
    cachePreparationEvidence: z.string().min(1),
    scheduledDurationMs: nonnegative,
    startedAt: nonnegative,
    finishedAt: nonnegative,
    submissions: z.array(
      z
        .object({
          accountIndex: z.number().int().min(0).max(99),
          submissionId: z.string().min(1).nullable(),
          requestedAt: nonnegative,
          acceptedAt: nonnegative.nullable(),
          completedAt: nonnegative.nullable(),
          verdict: submissionResultVerdictSchema.nullable(),
          expectedVerdict: submissionResultVerdictSchema.exclude(["system_error"]),
          queueMs: nonnegative.nullable(),
          cpuSeconds: nonnegative.nullable(),
          error: z
            .enum(["http_error", "transport_error", "invalid_response", "deadline"])
            .nullable(),
        })
        .strict(),
    ),
    httpLatencyMs: z.array(nonnegative),
    telemetry: z
      .object({
        evidenceReference: z.string().min(1),
        cleanupCompletedAt: nonnegative,
        webLatencyMs: z.array(nonnegative).min(1),
        dbLatencyMs: z.array(nonnegative).min(1),
        oomCount: nonnegative.int(),
        runtimeLeakCount: nonnegative.int(),
        starvationCount: nonnegative.int(),
        falseQueueFailureCount: nonnegative.int(),
        verdictFixturesPassed: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((trial, ctx) => {
    if (trial.finishedAt < trial.startedAt)
      ctx.addIssue({ code: "custom", message: "Trial ends before it starts" });
    if (trial.telemetry && trial.telemetry.cleanupCompletedAt < trial.startedAt)
      ctx.addIssue({ code: "custom", message: "Cleanup evidence predates trial" });
    for (const item of trial.submissions) {
      if (
        item.requestedAt < trial.startedAt ||
        item.requestedAt > trial.finishedAt ||
        (item.acceptedAt !== null && item.acceptedAt < item.requestedAt) ||
        (item.completedAt !== null &&
          (item.acceptedAt === null ||
            item.completedAt < item.acceptedAt ||
            item.completedAt > trial.finishedAt)) ||
        (item.queueMs !== null &&
          item.completedAt !== null &&
          item.acceptedAt !== null &&
          item.queueMs > item.completedAt - item.acceptedAt)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Inconsistent submission timestamps or queue duration",
        });
      }
    }
  });

export type Manifest = z.infer<typeof manifestSchema>;
export type Trial = z.infer<typeof trialSchema>;

export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * fraction;
  const lower = Math.floor(position);
  return (
    ordered[lower]! + (ordered[Math.ceil(position)]! - ordered[lower]!) * (position - lower)
  );
}

function distribution(values: number[]) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

export function summarizeTrial(trial: Trial) {
  const completed = trial.submissions.filter((item) => item.completedAt !== null);
  const drainMs =
    completed.length === trial.submissions.length && completed.length > 0 && trial.telemetry
      ? Math.max(
          trial.telemetry.cleanupCompletedAt,
          ...completed.map((item) => item.completedAt!),
        ) - trial.startedAt
      : null;
  return {
    drainMs,
    completed: completed.length,
    throughputPerSecond:
      drainMs !== null && drainMs > 0 ? (completed.length * 1000) / drainMs : null,
    queueMs: distribution(
      trial.submissions.flatMap((item) => (item.queueMs === null ? [] : [item.queueMs])),
    ),
    endToEndMs: distribution(completed.map((item) => item.completedAt! - item.requestedAt)),
    cpuSecondsPerSubmission:
      trial.submissions.length > 0 &&
      trial.submissions.every((item) => item.cpuSeconds !== null)
        ? trial.submissions.reduce((sum, item) => sum + item.cpuSeconds!, 0) /
          trial.submissions.length
        : null,
    webLatencyMs: distribution(trial.telemetry?.webLatencyMs ?? []),
    dbLatencyMs: distribution(trial.telemetry?.dbLatencyMs ?? []),
    observedHttpLatencyMs: distribution(trial.httpLatencyMs),
  };
}

function trialKey(trial: Trial) {
  return `${trial.workload}/${trial.cases}/${trial.load}/${trial.cache}/${trial.repetition}`;
}

export function compareTrials(baselineInput: unknown, candidateInput: unknown) {
  const baseline = z.array(trialSchema).parse(baselineInput);
  const candidate = z.array(trialSchema).parse(candidateInput);
  const failures: string[] = [];
  for (const [name, trials] of [
    ["baseline", baseline],
    ["candidate", candidate],
  ] as const) {
    const keys = new Set(trials.map(trialKey));
    if (trials.length !== 108 || keys.size !== 108)
      failures.push(
        `${name}: require all 108 unique trials (6 fixtures × 3 loads × 2 cache states × 3 repetitions)`,
      );
    if (new Set(trials.map((trial) => trial.revision)).size !== 1)
      failures.push(`${name}: mixed or missing revision`);
    for (const trial of trials) {
      const prefix = `${name}/${trialKey(trial)}`;
      const expectedCount = trial.load === "single" ? 1 : 100;
      const expectedDuration =
        trial.load === "single" ? 0 : trial.load === "burst" ? 60_000 : 600_000;
      if (trial.scheduledDurationMs !== expectedDuration)
        failures.push(`${prefix}: unexpected load duration`);
      if (
        trial.submissions.length !== expectedCount ||
        new Set(trial.submissions.map((item) => item.accountIndex)).size !== expectedCount
      )
        failures.push(`${prefix}: wrong submission/account count`);
      if (
        trial.load === "burst" &&
        (trial.scheduledDurationMs !== 60_000 ||
          trial.submissions.some(
            (item) => item.acceptedAt === null || item.acceptedAt - trial.startedAt > 60_000,
          ))
      )
        failures.push(`${prefix}: 100 accepted submissions within 60 seconds required`);
      if (
        trial.submissions.some(
          (item) =>
            item.error ||
            item.verdict !== item.expectedVerdict ||
            item.completedAt === null ||
            item.queueMs === null ||
            item.cpuSeconds === null,
        )
      )
        failures.push(`${prefix}: incomplete measurements or incorrect verdict`);
      const ids = trial.submissions.map((item) => item.submissionId);
      if (ids.includes(null) || new Set(ids).size !== ids.length)
        failures.push(`${prefix}: missing or duplicate submission IDs`);
      const telemetry = trial.telemetry;
      if (
        !telemetry ||
        !telemetry.verdictFixturesPassed ||
        telemetry.oomCount ||
        telemetry.runtimeLeakCount ||
        telemetry.starvationCount ||
        telemetry.falseQueueFailureCount
      )
        failures.push(`${prefix}: missing or failed runtime/correctness evidence`);
    }
  }
  const comparisons = [];
  for (const kind of workload.options)
    for (const cases of [20, 100])
      for (const temperature of cache.options)
        for (const shape of load.options) {
          const select = (trials: Trial[]) =>
            trials
              .filter(
                (trial) =>
                  trial.workload === kind &&
                  trial.cases === cases &&
                  trial.cache === temperature &&
                  trial.load === shape,
              )
              .sort((a, b) => a.repetition - b.repetition);
          const before = select(baseline);
          const after = select(candidate);
          const key = `${kind}/${cases}/${shape}/${temperature}`;
          if (before.length !== 3 || after.length !== 3) continue;
          if (
            new Set(
              [...before, ...after].map(
                (trial) =>
                  `${trial.fixedInputsSha256}/${trial.scheduledDurationMs}/${trial.fixtureId}`,
              ),
            ).size !== 1
          )
            failures.push(`${key}: fixed inputs or load duration differ`);
          const previous = before.map(summarizeTrial);
          const next = after.map(summarizeTrial);
          const baselineDrain = percentile(
            previous.flatMap((item) => (item.drainMs === null ? [] : [item.drainMs])),
            0.5,
          );
          const candidateDrain = percentile(
            next.flatMap((item) => (item.drainMs === null ? [] : [item.drainMs])),
            0.5,
          );
          const drainImprovement =
            baselineDrain && candidateDrain !== null
              ? 1 - candidateDrain / baselineDrain
              : null;
          const baselineSingleP95 = percentile(
            before.flatMap((trial) =>
              trial.submissions.flatMap((item) =>
                item.completedAt === null ? [] : [item.completedAt - item.requestedAt],
              ),
            ),
            0.95,
          );
          const candidateSingleP95 = percentile(
            after.flatMap((trial) =>
              trial.submissions.flatMap((item) =>
                item.completedAt === null ? [] : [item.completedAt - item.requestedAt],
              ),
            ),
            0.95,
          );
          const baselineWebP95 = percentile(
            before.flatMap((trial) => trial.telemetry?.webLatencyMs ?? []),
            0.95,
          );
          const candidateWebP95 = percentile(
            after.flatMap((trial) => trial.telemetry?.webLatencyMs ?? []),
            0.95,
          );
          if (
            shape === "burst" &&
            (drainImprovement === null || drainImprovement < 0.2 - Number.EPSILON)
          )
            failures.push(`${key}: burst median drain improvement below 20%`);
          if (
            shape === "single" &&
            (baselineSingleP95 === null ||
              candidateSingleP95 === null ||
              candidateSingleP95 > baselineSingleP95 * 1.1)
          )
            failures.push(`${key}: single submission p95 regressed over 10%`);
          if (
            baselineWebP95 === null ||
            candidateWebP95 === null ||
            candidateWebP95 > baselineWebP95 * 1.1
          )
            failures.push(`${key}: web p95 missing or regressed over 10%`);
          comparisons.push({ key, drainImprovement, baseline: previous, candidate: next });
        }
  return { passed: failures.length === 0, failures, comparisons };
}

export function assertTargetAuthorized(
  manifest: Manifest,
  now: number,
  requiredDurationMs: number,
) {
  const url = new URL(manifest.target);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Target must be a credential-free HTTP(S) origin");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (loopback && manifest.targetKind === "isolated-test") return;
  const maintenance = manifest.maintenance;
  if (
    (!loopback && url.protocol !== "https:") ||
    !maintenance ||
    now < Date.parse(maintenance.startsAt) ||
    now + requiredDurationMs > Date.parse(maintenance.endsAt)
  )
    throw new Error(
      "Remote/shared-server collection requires a maintenance authorization covering the entire trial after real judge drain (HTTPS outside loopback)",
    );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function fixedInputsHash(manifest: Manifest, fixtureId: string): string {
  const fixture = manifest.fixtures.find((item) => item.id === fixtureId);
  if (!fixture) throw new Error("Unknown fixture");
  return createHash("sha256")
    .update(
      canonical({
        fixture,
        image: manifest.sandboxImageDigest,
        background: manifest.backgroundServicesSha256,
        machine: manifest.machineProfileSha256,
      }),
    )
    .digest("hex");
}

export async function collectTrial(
  manifest: Manifest,
  options: {
    fixtureId: string;
    load: Trial["load"];
    cache: Trial["cache"];
    repetition: number;
    revision: string;
    cachePreparationEvidence: string;
    timeoutMs: number;
  },
) {
  const fixture = manifest.fixtures.find((item) => item.id === options.fixtureId);
  if (!fixture) throw new Error("Unknown fixture");
  const duration = options.load === "single" ? 0 : options.load === "burst" ? 60_000 : 600_000;
  const startedAt = Date.now();
  assertTargetAuthorized(manifest, startedAt, duration + options.timeoutMs);
  const accounts = manifest.accounts.slice(0, options.load === "single" ? 1 : 100);
  const tokens = accounts.map((account) => process.env[account.tokenEnv]);
  if (tokens.some((token) => !token) || new Set(tokens).size !== tokens.length)
    throw new Error(
      "Distinct API tokens must be available in the configured environment variables",
    );
  const httpLatencyMs: number[] = [];
  const submissions = await Promise.all(
    accounts.map(async (_, index): Promise<Trial["submissions"][number]> => {
      await delay(Math.max(0, startedAt + (index * duration) / accounts.length - Date.now()));
      const item: Trial["submissions"][number] = {
        accountIndex: index,
        submissionId: null,
        requestedAt: Date.now(),
        acceptedAt: null,
        completedAt: null,
        verdict: null,
        expectedVerdict: fixture.expectedVerdict,
        queueMs: null,
        cpuSeconds: null,
        error: null,
      };
      const deadline = item.requestedAt + options.timeoutMs;
      async function request(path: string, method: string, body?: unknown) {
        const begin = Date.now();
        const response = await fetch(new URL(path, manifest.target), {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - begin))),
          headers: {
            authorization: `Bearer ${tokens[index]!}`,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        httpLatencyMs.push(Date.now() - begin);
        if (!response.ok) {
          item.error = "http_error";
          return null;
        }
        try {
          return (await response.json()) as Record<string, unknown>;
        } catch {
          item.error = "invalid_response";
          return null;
        }
      }
      try {
        const accepted = await request("/api/submissions", "POST", fixture.payload);
        if (!accepted) return item;
        if (typeof accepted.submissionId !== "string" || !accepted.submissionId) {
          item.error = "invalid_response";
          return item;
        }
        item.submissionId = accepted.submissionId;
        item.acceptedAt = Date.now();
        while (Date.now() < deadline) {
          const result = await request(
            `/api/submissions/${encodeURIComponent(item.submissionId)}`,
            "GET",
          );
          if (!result) return item;
          const verdict = submissionResultVerdictSchema.safeParse(result.status);
          if (verdict.success) {
            item.verdict = verdict.data;
            item.completedAt = Date.now();
            return item;
          }
          if (
            !["pending_upload", "queued", "compiling", "running"].includes(
              String(result.status),
            )
          ) {
            item.error = "invalid_response";
            return item;
          }
          await delay(Math.min(1000, Math.max(1, deadline - Date.now())));
        }
        item.error = "deadline";
      } catch {
        item.error = "transport_error";
      }
      return item;
    }),
  );
  const { timeoutMs: _timeoutMs, ...identity } = options;
  return trialSchema.parse({
    schemaVersion: 1,
    ...identity,
    fixtureId: fixture.id,
    workload: fixture.workload,
    cases: fixture.cases,
    fixedInputsSha256: fixedInputsHash(manifest, fixture.id),
    scheduledDurationMs: duration,
    startedAt,
    finishedAt: Date.now(),
    submissions,
    httpLatencyMs,
    telemetry: null,
  });
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean" },
      validate: { type: "string" },
      compare: { type: "string" },
      candidate: { type: "string" },
      collect: { type: "string" },
      output: { type: "string" },
      fixture: { type: "string" },
      load: { type: "string" },
      cache: { type: "string" },
      repetition: { type: "string" },
      revision: { type: "string" },
      "cache-evidence": { type: "string" },
      "timeout-seconds": { type: "string", default: "1800" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Judge benchmark (no account creation or cache mutation)\n  --validate MANIFEST.json\n  --collect MANIFEST.json --fixture ID --load single|steady|burst --cache cold|warm --repetition 1|2|3 --revision SHA --cache-evidence RECORD --output TRIAL.json [--timeout-seconds 1800]\n  --compare BASELINE.json --candidate CANDIDATE.json --output REPORT.json\nComparison inputs are arrays of 108 telemetry-enriched trials. See docs/runbooks/testing.md.\n",
    );
    return;
  }
  if ([values.validate, values.compare, values.collect].filter(Boolean).length !== 1)
    throw new Error("Choose exactly one of --validate, --compare, --collect (or --help)");
  if (values.validate) {
    manifestSchema.parse(await readJson(values.validate));
    process.stdout.write("Manifest valid; no requests sent.\n");
    return;
  }
  if (!values.output) throw new Error("--output is required");
  if (values.compare) {
    if (!values.candidate) throw new Error("--candidate is required");
    const report = compareTrials(
      await readJson(values.compare),
      await readJson(values.candidate),
    );
    await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  const options = z
    .object({
      fixtureId: z.string().min(1),
      load,
      cache,
      repetition: z.coerce.number().int().min(1).max(3),
      revision: z.string().min(1),
      cachePreparationEvidence: z.string().min(1),
      timeoutMs: z.number().int().min(1000).max(7_200_000),
    })
    .parse({
      fixtureId: values.fixture,
      load: values.load,
      cache: values.cache,
      repetition: values.repetition,
      revision: values.revision,
      cachePreparationEvidence: values["cache-evidence"],
      timeoutMs: Number(values["timeout-seconds"]) * 1000,
    });
  const manifest = manifestSchema.parse(await readJson(values.collect!));
  const output = await open(values.output, "wx", 0o600);
  try {
    const trial = await collectTrial(manifest, options);
    await output.writeFile(`${JSON.stringify(trial, null, 2)}\n`);
  } finally {
    await output.close();
  }
  process.stdout.write(
    "Trial recorded. Queue/CPU/runtime telemetry is still required before comparison can pass.\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof z.ZodError ? "Invalid benchmark data; inspect the documented schema." : error instanceof Error ? error.message : "Benchmark failed"}\n`,
    );
    process.exitCode = 1;
  });
}

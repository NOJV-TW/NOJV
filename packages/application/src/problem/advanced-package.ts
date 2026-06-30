import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

import { load as loadYaml } from "js-yaml";
import { Open, type Entry as ZipEntry, type File as ZipFile } from "unzipper";

import {
  advancedConfigSchema,
  advancedPackageManifestSchema,
  advancedResultSchema,
  DEFAULT_LOCALE,
  parseRelativePath,
  validateAdvancedResultForMaxScore,
  type AdvancedConfig,
  type AdvancedPackageManifest,
  type AdvancedResult,
  type ImageRef,
} from "@nojv/core";
import { problemRepo, problemStatementRepo, runTransaction } from "@nojv/db";
import { deleteAdvancedImageTarball, uploadAdvancedImageTarball } from "@nojv/storage";

import { ConflictError, ValidationError } from "../shared/errors";
import { requireProblem } from "../shared/require";
import { storage } from "../shared/storage-singleton";

import { assertProblemEditAccess, type ProblemActorContext } from "./permissions";

const MAX_ADVANCED_PACKAGE_ENTRIES = 1_000;
const MAX_ADVANCED_PACKAGE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ADVANCED_IMAGE_TARBALL_BYTES = 512 * 1024 * 1024;
const MAX_ADVANCED_SAMPLE_FILES = 200;
const MAX_ADVANCED_SAMPLE_BYTES = 32 * 1024 * 1024;
const MAX_ADVANCED_SAMPLE_OUTPUT_FILES = 100_000;
const MAX_ADVANCED_SAMPLE_OUTPUT_BYTES = 1024 * 1024 * 1024;
const DOCKER_LOG_LIMIT = 20_000;
const SAMPLE_CPU_LIMIT = "1";
const SAMPLE_PIDS_LIMIT = 256;
const RUN_USER = "10001:10001";
const SERVICE_NETWORK_ALIAS = "service";
const SERVICE_PORT = 8888;
const SERVICE_READY_MARKER = "NOJV_SERVICE_READY";
const PROXY_IMAGE = "nojv-egress-proxy:local";
const PROXY_PORT = 8888;
const PROXY_READY_MARKER = "NOJV_PROXY_READY";

type AdvancedImageRole = "run" | "grade" | "service";

export interface AdvancedPackageIssue {
  code: string;
  phase: "parse" | "manifest" | "build" | "sample" | "publish" | "persist";
  file?: string;
  message: string;
  fix: string;
  logs?: string;
}

export class AdvancedPackageError extends Error {
  readonly issue: AdvancedPackageIssue;

  constructor(issue: AdvancedPackageIssue) {
    super(issue.message);
    this.name = "AdvancedPackageError";
    this.issue = issue;
  }
}

export interface AdvancedPackageImportResult {
  advancedConfig: AdvancedConfig;
  builtImages: AdvancedImageRole[];
  problem: AdvancedPackageManifest["problem"];
  requiredPaths: string[];
}

export type AdvancedPackagePublishTarget =
  { type: "tarball" } | { type: "registry"; registryPrefix: string };

export interface AdvancedPackageImportOptions {
  publishTarget?: AdvancedPackagePublishTarget;
}

function packageError(issue: AdvancedPackageIssue): never {
  throw new AdvancedPackageError(issue);
}

function isIgnoredZipJunk(path: string): boolean {
  return path.startsWith("__MACOSX/") || path.endsWith("/.DS_Store") || path === ".DS_Store";
}

function normalizePackagePath(path: string): string | null {
  if (isIgnoredZipJunk(path)) return null;
  try {
    return parseRelativePath(path);
  } catch (err) {
    packageError({
      code: "ADV_PACKAGE_BAD_PATH",
      phase: "parse",
      file: path,
      message: `Invalid package path "${path}".`,
      fix: err instanceof Error ? err.message : "Use relative paths without unsafe segments.",
    });
  }
}

async function readEntryBounded(entry: ZipFile, maxBytes: number): Promise<Buffer> {
  if (maxBytes <= 0) {
    throw new ConflictError(
      `Advanced package exceeds ${String(MAX_ADVANCED_PACKAGE_UNCOMPRESSED_BYTES)} bytes uncompressed.`,
    );
  }
  const stream: ZipEntry = entry.stream();
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const drainEntry = (): void => {
      try {
        void stream
          .autodrain()
          .promise()
          .catch(() => undefined);
      } catch {
        return;
      }
    };
    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        drainEntry();
        reject(
          new ConflictError(
            `Advanced package entry "${entry.path}" exceeds the uncompressed size limit.`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function extractPackage(zipBuffer: Buffer, dir: string): Promise<Set<string>> {
  let archive;
  try {
    archive = await Open.buffer(zipBuffer);
  } catch (err) {
    packageError({
      code: "ADV_PACKAGE_INVALID_ZIP",
      phase: "parse",
      message: "Advanced package is not a valid ZIP archive.",
      fix: err instanceof Error ? err.message : "Upload a standard .zip file.",
    });
  }

  const fileEntries = archive.files.filter((f) => f.type === "File");
  if (fileEntries.length > MAX_ADVANCED_PACKAGE_ENTRIES) {
    throw new ConflictError(
      `Advanced package has too many files (${String(fileEntries.length)} > ${String(MAX_ADVANCED_PACKAGE_ENTRIES)}).`,
    );
  }

  const paths = new Set<string>();
  let totalBytes = 0;
  for (const entry of fileEntries) {
    const relPath = normalizePackagePath(entry.path);
    if (relPath === null) continue;
    const buf = await readEntryBounded(
      entry,
      MAX_ADVANCED_PACKAGE_UNCOMPRESSED_BYTES - totalBytes,
    );
    totalBytes += buf.byteLength;
    const dest = join(dir, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    paths.add(relPath);
  }
  return paths;
}

async function readManifest(root: string): Promise<AdvancedPackageManifest> {
  let raw;
  try {
    raw = await readFile(join(root, "metadata.yaml"), "utf8");
  } catch {
    packageError({
      code: "ADV_MANIFEST_MISSING",
      phase: "manifest",
      file: "metadata.yaml",
      message: "Advanced package is missing metadata.yaml.",
      fix: "Add metadata.yaml at the ZIP root.",
    });
  }

  let yaml: unknown;
  try {
    yaml = loadYaml(raw);
  } catch (err) {
    packageError({
      code: "ADV_MANIFEST_YAML_INVALID",
      phase: "manifest",
      file: "metadata.yaml",
      message: "metadata.yaml is not valid YAML.",
      fix: err instanceof Error ? err.message : "Fix the YAML syntax.",
    });
  }

  const parsed = advancedPackageManifestSchema.safeParse(yaml);
  if (!parsed.success) {
    packageError({
      code: "ADV_MANIFEST_INVALID",
      phase: "manifest",
      file: "metadata.yaml",
      message: "metadata.yaml does not match the Advanced package schema.",
      fix: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; "),
    });
  }
  return parsed.data;
}

function assertPackageShape(paths: Set<string>, manifest: AdvancedPackageManifest): void {
  for (const file of ["run/Dockerfile", "grade/Dockerfile"]) {
    if (!paths.has(file)) {
      packageError({
        code: "ADV_PACKAGE_DOCKERFILE_MISSING",
        phase: "manifest",
        file,
        message: `Advanced package is missing ${file}.`,
        fix: `Add ${file}; run and grade images are both required.`,
      });
    }
  }

  const hasService = paths.has("service/Dockerfile");
  if (manifest.network.mode === "service" && !hasService) {
    packageError({
      code: "ADV_PACKAGE_SERVICE_MISSING",
      phase: "manifest",
      file: "service/Dockerfile",
      message: "network.mode is service, but service/Dockerfile is missing.",
      fix: "Add service/Dockerfile or change network.mode to none/allowlist.",
    });
  }
  if (manifest.network.mode !== "service" && hasService) {
    packageError({
      code: "ADV_PACKAGE_UNUSED_SERVICE",
      phase: "manifest",
      file: "service/Dockerfile",
      message: "service/Dockerfile is present, but network.mode is not service.",
      fix: "Remove service/ or set network.mode: service.",
    });
  }

  for (const sample of manifest.samples) {
    if (!paths.has(sample.submission)) {
      packageError({
        code: "ADV_SAMPLE_MISSING",
        phase: "manifest",
        file: sample.submission,
        message: `Declared sample "${sample.name}" is missing.`,
        fix: `Add ${sample.submission} or remove it from samples.`,
      });
    }
  }
}

function boundedLogAppend(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  return next.length > DOCKER_LOG_LIMIT ? next.slice(next.length - DOCKER_LOG_LIMIT) : next;
}

function runDocker(args: string[], failure: Omit<AdvancedPackageIssue, "logs">): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    child.stdout.on("data", (chunk: Buffer) => {
      logs = boundedLogAppend(logs, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      logs = boundedLogAppend(logs, chunk);
    });
    child.on("error", (err) => {
      reject(
        new AdvancedPackageError({
          ...failure,
          message: `${failure.message}: ${err.message}`,
          logs,
        }),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new AdvancedPackageError({
          ...failure,
          message: `${failure.message}: docker exited with code ${String(code)}`,
          logs,
        }),
      );
    });
  });
}

function runDockerText(
  args: string[],
  failure: Omit<AdvancedPackageIssue, "logs">,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    child.stdout.on("data", (chunk: Buffer) => {
      logs = boundedLogAppend(logs, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      logs = boundedLogAppend(logs, chunk);
    });
    child.on("error", (err) => {
      reject(
        new AdvancedPackageError({
          ...failure,
          message: `${failure.message}: ${err.message}`,
          logs,
        }),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(logs);
        return;
      }
      reject(
        new AdvancedPackageError({
          ...failure,
          message: `${failure.message}: docker exited with code ${String(code)}`,
          logs,
        }),
      );
    });
  });
}

interface DockerContainerOutcome {
  exitCode: number | null;
  logs: string;
  timedOut: boolean;
}

function runDockerContainer(
  args: string[],
  containerName: string,
  timeoutMs: number,
): Promise<DockerContainerOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      void runDocker(["rm", "-f", containerName], {
        code: "ADV_SAMPLE_CONTAINER_RM_FAILED",
        phase: "sample",
        message: `Failed to remove timed out sample container ${containerName}`,
        fix: "Remove the container manually and retry the upload.",
      }).catch(() => undefined);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      logs = boundedLogAppend(logs, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      logs = boundedLogAppend(logs, chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, logs, timedOut });
    });
  });
}

async function bestEffortRemoveImage(tag: string): Promise<void> {
  await runDocker(["image", "rm", tag], {
    code: "ADV_DOCKER_IMAGE_RM_FAILED",
    phase: "build",
    message: `Failed to remove temporary image ${tag}`,
    fix: "Remove the temporary image manually if disk pressure matters.",
  }).catch(() => undefined);
}

async function bestEffortRemoveContainer(containerName: string): Promise<void> {
  await runDocker(["rm", "-f", containerName], {
    code: "ADV_DOCKER_CONTAINER_RM_FAILED",
    phase: "sample",
    message: `Failed to remove container ${containerName}`,
    fix: "Remove the container manually if needed.",
  }).catch(() => undefined);
}

async function bestEffortRemoveNetwork(networkName: string): Promise<void> {
  await runDocker(["network", "rm", "-f", networkName], {
    code: "ADV_DOCKER_NETWORK_RM_FAILED",
    phase: "sample",
    message: `Failed to remove network ${networkName}`,
    fix: "Remove the network manually if needed.",
  }).catch(() => undefined);
}

async function buildImageTag(
  problemId: string,
  role: AdvancedImageRole,
  contextDir: string,
): Promise<string> {
  const tag = `nojv-advanced-${problemId}-${role}-${randomUUID()}:package`;
  await runDocker(["build", "--force-rm", "-t", tag, contextDir], {
    code: "ADV_IMAGE_BUILD_FAILED",
    phase: "build",
    file: `${role}/Dockerfile`,
    message: `Failed to build ${role} image`,
    fix: `Fix ${role}/Dockerfile or files under ${role}/.`,
  });
  return tag;
}

async function publishImageTarball(
  problemId: string,
  role: AdvancedImageRole,
  tag: string,
  outDir: string,
): Promise<string> {
  const tarPath = join(outDir, `${role}.tar`);
  await runDocker(["save", "-o", tarPath, tag], {
    code: "ADV_IMAGE_SAVE_FAILED",
    phase: "publish",
    file: `${role}/Dockerfile`,
    message: `Failed to save ${role} image`,
    fix: "Check local Docker disk space and retry.",
  });
  const size = (await stat(tarPath)).size;
  if (size > MAX_ADVANCED_IMAGE_TARBALL_BYTES) {
    throw new ConflictError(
      `${role} image tarball is too large (${String(Math.ceil(size / 1024 / 1024))} MB > ${String(MAX_ADVANCED_IMAGE_TARBALL_BYTES / 1024 / 1024)} MB).`,
    );
  }
  return await uploadAdvancedImageTarball(
    storage(),
    problemId,
    role,
    createReadStream(tarPath),
  );
}

function sanitizeImagePathSegment(value: string): string {
  const out = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "problem";
}

function registryImageRef(prefix: string, problemId: string, role: AdvancedImageRole): string {
  return `${prefix.replace(/\/+$/, "")}/${sanitizeImagePathSegment(problemId)}/${role}:${randomUUID()}`;
}

async function publishRegistryImage(
  problemId: string,
  role: AdvancedImageRole,
  tag: string,
  registryPrefix: string,
): Promise<string> {
  const ref = registryImageRef(registryPrefix, problemId, role);
  await runDocker(["tag", tag, ref], {
    code: "ADV_IMAGE_TAG_FAILED",
    phase: "publish",
    file: `${role}/Dockerfile`,
    message: `Failed to tag ${role} image for registry`,
    fix: `Check ADVANCED_IMAGE_REGISTRY (${registryPrefix}) and retry.`,
  });
  try {
    await runDocker(["push", ref], {
      code: "ADV_IMAGE_PUSH_FAILED",
      phase: "publish",
      file: `${role}/Dockerfile`,
      message: `Failed to push ${role} image to registry`,
      fix: "Make sure the web runtime's Docker client is authenticated to ADVANCED_IMAGE_REGISTRY.",
    });
    return ref;
  } finally {
    await bestEffortRemoveImage(ref);
  }
}

interface LocalImageTags {
  run: string;
  grade: string;
  service?: string;
}

interface ImageRefs {
  run: ImageRef;
  grade: ImageRef;
  service?: ImageRef;
}

async function readSampleEntryBounded(entry: ZipFile, remainingBytes: number): Promise<Buffer> {
  if (remainingBytes <= 0) {
    throw new ConflictError(
      `Advanced sample submission exceeds ${String(MAX_ADVANCED_SAMPLE_BYTES)} bytes uncompressed.`,
    );
  }
  const stream: ZipEntry = entry.stream();
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > remainingBytes) {
        settled = true;
        void stream
          .autodrain()
          .promise()
          .catch(() => undefined);
        reject(new ConflictError(`Advanced sample entry "${entry.path}" is too large.`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function extractSampleSubmission(
  sampleZipPath: string,
  submissionDir: string,
  requiredPaths: string[],
  sampleName: string,
): Promise<string[]> {
  let archive;
  try {
    archive = await Open.buffer(await readFile(sampleZipPath));
  } catch (err) {
    packageError({
      code: "ADV_SAMPLE_INVALID_ZIP",
      phase: "sample",
      file: sampleZipPath,
      message: `Sample "${sampleName}" is not a valid submission ZIP.`,
      fix: err instanceof Error ? err.message : "Upload a standard .zip sample submission.",
    });
  }

  const fileEntries = archive.files.filter((f) => f.type === "File");
  if (fileEntries.length > MAX_ADVANCED_SAMPLE_FILES) {
    throw new ConflictError(
      `Sample "${sampleName}" has too many files (${String(fileEntries.length)} > ${String(MAX_ADVANCED_SAMPLE_FILES)}).`,
    );
  }

  const paths: string[] = [];
  let totalBytes = 0;
  await mkdir(submissionDir, { recursive: true });
  for (const entry of fileEntries) {
    const relPath = normalizePackagePath(entry.path);
    if (relPath === null) continue;
    const buf = await readSampleEntryBounded(entry, MAX_ADVANCED_SAMPLE_BYTES - totalBytes);
    totalBytes += buf.byteLength;
    const dest = join(submissionDir, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    paths.push(relPath);
  }

  for (const path of requiredPaths) {
    if (!paths.includes(path)) {
      packageError({
        code: "ADV_SAMPLE_REQUIRED_PATH_MISSING",
        phase: "sample",
        file: sampleZipPath,
        message: `Sample "${sampleName}" is missing required path "${path}".`,
        fix: `Add ${path} to the sample submission ZIP or remove it from student.requiredPaths.`,
      });
    }
  }

  return paths;
}

async function copyRegularTree(
  srcDir: string,
  destDir: string,
  counters = { files: 0, bytes: 0 },
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  let entries;
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    const info = await lstat(src);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      await copyRegularTree(src, dest, counters);
      continue;
    }
    if (!info.isFile()) continue;
    counters.files += 1;
    counters.bytes += info.size;
    if (
      counters.files > MAX_ADVANCED_SAMPLE_OUTPUT_FILES ||
      counters.bytes > MAX_ADVANCED_SAMPLE_OUTPUT_BYTES
    ) {
      throw new ConflictError("Advanced sample run output exceeded the file/size limit.");
    }
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
}

function sampleContainerName(problemId: string, sampleName: string, phase: string): string {
  return `nojv-adv-sample-${sanitizeImagePathSegment(problemId).slice(0, 24)}-${sanitizeImagePathSegment(sampleName).slice(0, 24)}-${phase}-${randomUUID().slice(0, 8)}`;
}

function sampleNetworkName(problemId: string, sampleName: string, kind: string): string {
  return `nojv-adv-sample-${sanitizeImagePathSegment(problemId).slice(0, 26)}-${sanitizeImagePathSegment(sampleName).slice(0, 20)}-${kind}-${randomUUID().slice(0, 8)}`;
}

function buildSampleRunArgs(params: {
  containerName: string;
  networkArgs: string[];
  workspaceDir: string;
  imageRef: string;
  submissionId: string;
  memoryMb: number;
  language: string;
  extraEnv?: Record<string, string>;
}): string[] {
  return [
    "run",
    "--rm",
    "--name",
    params.containerName,
    ...params.networkArgs,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    RUN_USER,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,size=64m",
    "-v",
    `${params.workspaceDir}:/workspace`,
    "--cpus",
    SAMPLE_CPU_LIMIT,
    "--memory",
    `${String(params.memoryMb)}m`,
    "--memory-swap",
    `${String(params.memoryMb)}m`,
    "--pids-limit",
    String(SAMPLE_PIDS_LIMIT),
    "--env",
    `SUBMISSION_ID=${params.submissionId}`,
    "--env",
    `LANGUAGE=${params.language}`,
    ...Object.entries(params.extraEnv ?? {}).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
    "--workdir",
    "/workspace",
    params.imageRef,
  ];
}

function buildSampleGradeArgs(params: {
  containerName: string;
  workspaceDir: string;
  imageRef: string;
  submissionId: string;
  memoryMb: number;
  language: string;
}): string[] {
  return [
    "run",
    "--rm",
    "--name",
    params.containerName,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,size=64m",
    "-v",
    `${params.workspaceDir}:/workspace`,
    "-v",
    `${join(params.workspaceDir, "run-output")}:/workspace/run-output:ro`,
    "--cpus",
    SAMPLE_CPU_LIMIT,
    "--memory",
    `${String(params.memoryMb)}m`,
    "--memory-swap",
    `${String(params.memoryMb)}m`,
    "--pids-limit",
    String(SAMPLE_PIDS_LIMIT),
    "--env",
    `SUBMISSION_ID=${params.submissionId}`,
    "--env",
    `LANGUAGE=${params.language}`,
    "--workdir",
    "/workspace",
    params.imageRef,
  ];
}

function runStatusFromOutcome(outcome: DockerContainerOutcome): {
  state: "exited" | "timed_out" | "oom_killed";
  exitCode: number | null;
} {
  if (outcome.timedOut) return { state: "timed_out", exitCode: outcome.exitCode };
  if (outcome.exitCode === 137) return { state: "oom_killed", exitCode: outcome.exitCode };
  return { state: "exited", exitCode: outcome.exitCode };
}

async function waitForContainerLog(
  containerName: string,
  marker: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const logs = await runDockerText(["logs", containerName], {
      code: "ADV_SAMPLE_CONTAINER_LOG_FAILED",
      phase: "sample",
      message: `Failed to read sample container logs for ${containerName}`,
      fix: "Check Docker daemon access and retry.",
    }).catch(() => "");
    if (logs.includes(marker)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  packageError({
    code: "ADV_SAMPLE_SERVICE_NOT_READY",
    phase: "sample",
    message: `Container ${containerName} did not print ${marker}.`,
    fix: `Print ${marker} after the service/proxy is ready, then retry the upload.`,
  });
}

async function createSampleNetworks(
  problemId: string,
  sampleName: string,
): Promise<{
  internal: string;
  egress: string;
}> {
  const internal = sampleNetworkName(problemId, sampleName, "internal");
  const egress = sampleNetworkName(problemId, sampleName, "egress");
  await runDocker(["network", "create", "--internal", internal], {
    code: "ADV_SAMPLE_NETWORK_FAILED",
    phase: "sample",
    message: "Failed to create the sample internal Docker network.",
    fix: "Check Docker daemon access and retry.",
  });
  try {
    await runDocker(["network", "create", egress], {
      code: "ADV_SAMPLE_NETWORK_FAILED",
      phase: "sample",
      message: "Failed to create the sample egress Docker network.",
      fix: "Check Docker daemon access and retry.",
    });
    return { internal, egress };
  } catch (err) {
    await bestEffortRemoveNetwork(internal);
    throw err;
  }
}

async function startSampleService(params: {
  problemId: string;
  sampleName: string;
  internalNetwork: string;
  egressNetwork: string;
  imageRef: string;
  memoryMb: number;
}): Promise<string> {
  const containerName = sampleContainerName(params.problemId, params.sampleName, "svc");
  await runDocker(
    [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "--network",
      params.internalNetwork,
      "--network-alias",
      SERVICE_NETWORK_ALIAS,
      "--env",
      `PORT=${String(SERVICE_PORT)}`,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,exec,nosuid,nodev,size=64m",
      "--memory",
      `${String(params.memoryMb)}m`,
      "--memory-swap",
      `${String(params.memoryMb)}m`,
      "--cpus",
      SAMPLE_CPU_LIMIT,
      "--pids-limit",
      String(SAMPLE_PIDS_LIMIT),
      params.imageRef,
    ],
    {
      code: "ADV_SAMPLE_SERVICE_START_FAILED",
      phase: "sample",
      message: "Failed to start the sample service container.",
      fix: "Fix service/Dockerfile or service.py and retry.",
    },
  );
  try {
    await runDocker(["network", "connect", params.egressNetwork, containerName], {
      code: "ADV_SAMPLE_SERVICE_NETWORK_FAILED",
      phase: "sample",
      message: "Failed to connect sample service to the egress network.",
      fix: "Check Docker network permissions and retry.",
    });
    await waitForContainerLog(containerName, SERVICE_READY_MARKER, 5_000);
    return containerName;
  } catch (err) {
    await bestEffortRemoveContainer(containerName);
    throw err;
  }
}

async function startSampleProxy(params: {
  problemId: string;
  sampleName: string;
  internalNetwork: string;
  egressNetwork: string;
  allowlist: string[];
}): Promise<string> {
  const containerName = sampleContainerName(params.problemId, params.sampleName, "proxy");
  await runDocker(
    [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "--network",
      params.internalNetwork,
      "--user",
      RUN_USER,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,exec,nosuid,nodev,size=16m",
      "--memory",
      "128m",
      "--memory-swap",
      "128m",
      "--cpus",
      "0.25",
      "--pids-limit",
      "128",
      "--env",
      `NOJV_ALLOWLIST=${params.allowlist
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",")}`,
      "--env",
      `NOJV_PROXY_PORT=${String(PROXY_PORT)}`,
      PROXY_IMAGE,
    ],
    {
      code: "ADV_SAMPLE_PROXY_START_FAILED",
      phase: "sample",
      message: "Failed to start the sample egress proxy.",
      fix: `Build ${PROXY_IMAGE} or switch network.mode to none/service.`,
    },
  );
  try {
    await runDocker(["network", "connect", params.egressNetwork, containerName], {
      code: "ADV_SAMPLE_PROXY_NETWORK_FAILED",
      phase: "sample",
      message: "Failed to connect sample egress proxy to the egress network.",
      fix: "Check Docker network permissions and retry.",
    });
    await waitForContainerLog(containerName, PROXY_READY_MARKER, 3_000);
    return containerName;
  } catch (err) {
    await bestEffortRemoveContainer(containerName);
    throw err;
  }
}

async function runOneSample(params: {
  problemId: string;
  root: string;
  sample: AdvancedPackageManifest["samples"][number];
  manifest: AdvancedPackageManifest;
  images: LocalImageTags;
}): Promise<void> {
  const sampleRoot = await mkdtemp(join(tmpdir(), "nojv-advanced-sample-"));
  const submissionId = `sample-${randomUUID()}`;
  const runDir = join(sampleRoot, "run");
  const gradeDir = join(sampleRoot, "grade");
  const submissionDir = join(runDir, "submission");
  const runOutputDir = join(runDir, "output");
  const gradeRunOutputDir = join(gradeDir, "run-output");
  const gradeOutputDir = join(gradeDir, "output");
  const startedContainers: string[] = [];
  let networks: { internal: string; egress: string } | undefined;

  try {
    const sampleZipPath = join(params.root, params.sample.submission);
    const submissionFiles = await extractSampleSubmission(
      sampleZipPath,
      submissionDir,
      params.manifest.student.requiredPaths,
      params.sample.name,
    );

    await mkdir(runOutputDir, { mode: 0o777, recursive: true });
    await chmod(runDir, 0o777);
    await chmod(runOutputDir, 0o777);
    await writeFile(
      join(runDir, "meta.json"),
      JSON.stringify(
        {
          submissionId,
          language: "advanced-sample",
          submissionFiles,
          resourceLimits: {
            totalTimeMs: params.manifest.resources.timeLimitMs,
            memoryMb: params.manifest.resources.memoryLimitMb,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    let networkArgs: string[] = ["--network", "none"];
    let extraEnv: Record<string, string> | undefined;
    if (params.manifest.network.mode === "service") {
      if (!params.images.service) {
        packageError({
          code: "ADV_SAMPLE_SERVICE_IMAGE_MISSING",
          phase: "sample",
          message: "network.mode is service, but the service image was not built.",
          fix: "Add service/Dockerfile and retry.",
        });
      }
      networks = await createSampleNetworks(params.problemId, params.sample.name);
      const serviceContainer = await startSampleService({
        problemId: params.problemId,
        sampleName: params.sample.name,
        internalNetwork: networks.internal,
        egressNetwork: networks.egress,
        imageRef: params.images.service,
        memoryMb: params.manifest.resources.memoryLimitMb,
      });
      startedContainers.push(serviceContainer);
      networkArgs = ["--network", networks.internal];
      extraEnv = { NOJV_SERVICE_HOST: `${SERVICE_NETWORK_ALIAS}:${String(SERVICE_PORT)}` };
    } else if (params.manifest.network.mode === "allowlist") {
      networks = await createSampleNetworks(params.problemId, params.sample.name);
      const proxyContainer = await startSampleProxy({
        problemId: params.problemId,
        sampleName: params.sample.name,
        internalNetwork: networks.internal,
        egressNetwork: networks.egress,
        allowlist: params.manifest.network.allowlist,
      });
      startedContainers.push(proxyContainer);
      networkArgs = ["--network", networks.internal];
      const proxyUrl = `http://${proxyContainer}:${String(PROXY_PORT)}`;
      extraEnv = {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        NO_PROXY: "",
        no_proxy: "",
      };
    }

    const runContainer = sampleContainerName(params.problemId, params.sample.name, "run");
    const runOutcome = await runDockerContainer(
      buildSampleRunArgs({
        containerName: runContainer,
        networkArgs,
        workspaceDir: runDir,
        imageRef: params.images.run,
        submissionId,
        memoryMb: params.manifest.resources.memoryLimitMb,
        language: "advanced-sample",
        ...(extraEnv ? { extraEnv } : {}),
      }),
      runContainer,
      params.manifest.resources.timeLimitMs + 30_000,
    );

    await mkdir(gradeRunOutputDir, { recursive: true });
    await mkdir(gradeOutputDir, { mode: 0o777, recursive: true });
    await copyRegularTree(runOutputDir, gradeRunOutputDir);
    await writeFile(
      join(gradeDir, "meta.json"),
      JSON.stringify(
        {
          submissionId,
          language: "advanced-sample",
          runStatus: runStatusFromOutcome(runOutcome),
        },
        null,
        2,
      ),
      "utf8",
    );
    await chmod(gradeDir, 0o777);
    await chmod(gradeOutputDir, 0o777);

    const gradeContainer = sampleContainerName(params.problemId, params.sample.name, "grade");
    const gradeOutcome = await runDockerContainer(
      buildSampleGradeArgs({
        containerName: gradeContainer,
        workspaceDir: gradeDir,
        imageRef: params.images.grade,
        submissionId,
        memoryMb: params.manifest.resources.memoryLimitMb,
        language: "advanced-sample",
      }),
      gradeContainer,
      params.manifest.resources.timeLimitMs + 30_000,
    );

    if (gradeOutcome.timedOut) {
      packageError({
        code: "ADV_SAMPLE_GRADE_TIMEOUT",
        phase: "sample",
        file: params.sample.submission,
        message: `Sample "${params.sample.name}" grade phase timed out.`,
        fix: "Fix grade/ so it writes result.json before the package time limit.",
        logs: gradeOutcome.logs,
      });
    }

    let result: AdvancedResult;
    try {
      const raw = await readFile(join(gradeOutputDir, "result.json"), "utf8");
      const json: unknown = JSON.parse(raw);
      const parsed = advancedResultSchema.safeParse(json);
      if (!parsed.success) {
        packageError({
          code: "ADV_SAMPLE_RESULT_INVALID",
          phase: "sample",
          file: params.sample.submission,
          message: `Sample "${params.sample.name}" wrote invalid result.json.`,
          fix: parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
            .join("; "),
          logs: gradeOutcome.logs,
        });
      }
      const issues = validateAdvancedResultForMaxScore(
        parsed.data,
        params.manifest.scoring.maxScore,
      );
      if (issues.length > 0) {
        packageError({
          code: "ADV_SAMPLE_RESULT_SCORE_INVALID",
          phase: "sample",
          file: params.sample.submission,
          message: `Sample "${params.sample.name}" wrote an invalid score/verdict combination.`,
          fix: issues.join("; "),
          logs: gradeOutcome.logs,
        });
      }
      result = parsed.data;
    } catch (err) {
      if (err instanceof AdvancedPackageError) throw err;
      packageError({
        code: "ADV_SAMPLE_RESULT_MISSING",
        phase: "sample",
        file: params.sample.submission,
        message: `Sample "${params.sample.name}" did not produce result.json.`,
        fix: "Fix grade/ so it writes /workspace/output/result.json.",
        logs: `${runOutcome.logs}\n${gradeOutcome.logs}`.trim(),
      });
    }

    if (
      result.verdict !== params.sample.expect.verdict ||
      result.score !== params.sample.expect.score
    ) {
      packageError({
        code: "ADV_SAMPLE_EXPECTATION_MISMATCH",
        phase: "sample",
        file: params.sample.submission,
        message: `Sample "${params.sample.name}" expected ${params.sample.expect.verdict}/${String(params.sample.expect.score)} but got ${result.verdict}/${String(result.score)}.`,
        fix: "Fix the sample expectation, the run image, or the grade image until they agree.",
        logs: `${runOutcome.logs}\n${gradeOutcome.logs}`.trim(),
      });
    }
  } finally {
    await Promise.all(startedContainers.map((name) => bestEffortRemoveContainer(name)));
    if (networks) {
      await Promise.all([
        bestEffortRemoveNetwork(networks.internal),
        bestEffortRemoveNetwork(networks.egress),
      ]);
    }
    await rm(sampleRoot, { force: true, recursive: true });
  }
}

async function validateSamples(params: {
  problemId: string;
  root: string;
  manifest: AdvancedPackageManifest;
  images: LocalImageTags;
}): Promise<void> {
  for (const sample of params.manifest.samples) {
    await runOneSample({
      problemId: params.problemId,
      root: params.root,
      manifest: params.manifest,
      images: params.images,
      sample,
    });
  }
}

function previousTarballKeys(config: unknown): string[] {
  const parsed = advancedConfigSchema.safeParse(config);
  if (!parsed.success) return [];
  const keys: string[] = [];
  if (parsed.data.run.imageSource === "tarball") keys.push(parsed.data.run.imageRef);
  if (parsed.data.grade.imageSource === "tarball") keys.push(parsed.data.grade.imageRef);
  const service = parsed.data.network.service;
  if (service?.imageSource === "tarball") keys.push(service.imageRef);
  return keys;
}

function buildRuntimeConfig(
  manifest: AdvancedPackageManifest,
  images: ImageRefs,
): AdvancedConfig {
  const network: AdvancedConfig["network"] =
    manifest.network.mode === "allowlist"
      ? { mode: "allowlist", allowlist: manifest.network.allowlist }
      : manifest.network.mode === "service"
        ? {
            mode: "service",
            service: images.service ?? { imageRef: "", imageSource: "tarball" },
          }
        : { mode: "none" };
  return advancedConfigSchema.parse({
    run: images.run,
    grade: images.grade,
    network,
    maxScore: manifest.scoring.maxScore,
  });
}

async function publishImages(params: {
  problemId: string;
  images: LocalImageTags;
  target: AdvancedPackagePublishTarget;
  buildDir: string;
  uploadedKeys: string[];
}): Promise<ImageRefs> {
  if (params.target.type === "registry") {
    const run = {
      imageRef: await publishRegistryImage(
        params.problemId,
        "run",
        params.images.run,
        params.target.registryPrefix,
      ),
      imageSource: "registry" as const,
    };
    const grade = {
      imageRef: await publishRegistryImage(
        params.problemId,
        "grade",
        params.images.grade,
        params.target.registryPrefix,
      ),
      imageSource: "registry" as const,
    };
    const service = params.images.service
      ? {
          imageRef: await publishRegistryImage(
            params.problemId,
            "service",
            params.images.service,
            params.target.registryPrefix,
          ),
          imageSource: "registry" as const,
        }
      : undefined;
    return { run, grade, ...(service ? { service } : {}) };
  }

  const runKey = await publishImageTarball(
    params.problemId,
    "run",
    params.images.run,
    params.buildDir,
  );
  params.uploadedKeys.push(runKey);
  const gradeKey = await publishImageTarball(
    params.problemId,
    "grade",
    params.images.grade,
    params.buildDir,
  );
  params.uploadedKeys.push(gradeKey);
  const serviceKey = params.images.service
    ? await publishImageTarball(
        params.problemId,
        "service",
        params.images.service,
        params.buildDir,
      )
    : undefined;
  if (serviceKey) params.uploadedKeys.push(serviceKey);
  return {
    run: { imageRef: runKey, imageSource: "tarball" },
    grade: { imageRef: gradeKey, imageSource: "tarball" },
    ...(serviceKey ? { service: { imageRef: serviceKey, imageSource: "tarball" } } : {}),
  };
}

export async function importAdvancedPackage(
  actor: ProblemActorContext,
  problemId: string,
  zipBuffer: Buffer,
  options: AdvancedPackageImportOptions = {},
): Promise<AdvancedPackageImportResult> {
  await assertProblemEditAccess(actor, problemId);

  const root = await mkdtemp(join(tmpdir(), "nojv-advanced-package-"));
  const uploadedKeys: string[] = [];
  const localTags: string[] = [];
  try {
    const paths = await extractPackage(zipBuffer, root);
    const manifest = await readManifest(root);
    assertPackageShape(paths, manifest);

    const buildDir = join(root, ".build");
    await mkdir(buildDir, { recursive: true });
    const runTag = await buildImageTag(problemId, "run", join(root, "run"));
    localTags.push(runTag);
    const gradeTag = await buildImageTag(problemId, "grade", join(root, "grade"));
    localTags.push(gradeTag);
    const serviceTag =
      manifest.network.mode === "service"
        ? await buildImageTag(problemId, "service", join(root, "service"))
        : undefined;
    if (serviceTag) localTags.push(serviceTag);

    const localImages = {
      run: runTag,
      grade: gradeTag,
      ...(serviceTag ? { service: serviceTag } : {}),
    };
    await validateSamples({
      problemId,
      root,
      manifest,
      images: localImages,
    });

    const target = options.publishTarget ?? { type: "tarball" };
    const imageRefs = await publishImages({
      problemId,
      images: localImages,
      target,
      buildDir,
      uploadedKeys,
    });
    const advancedConfig = buildRuntimeConfig(manifest, imageRefs);

    const problem = await problemRepo.findById(problemId);
    if (!problem) throw new ValidationError(`Problem not found: ${problemId}`);
    const oldKeys = previousTarballKeys(problem.advancedConfig);

    await runTransaction(async (tx) => {
      await requireProblem(tx, problemId);
      await problemRepo.withTx(tx).update(problemId, {
        type: "special_env",
        title: manifest.problem.title,
        difficulty: manifest.problem.difficulty,
        visibility: manifest.problem.visibility,
        tags: manifest.problem.tags,
        samples: manifest.problem.examples,
        advancedConfig,
        advancedRequiredPaths: manifest.student.requiredPaths,
        timeLimitMs: manifest.resources.timeLimitMs,
        memoryLimitMb: manifest.resources.memoryLimitMb,
      });
      await problemStatementRepo.withTx(tx).upsert(
        problemId,
        DEFAULT_LOCALE,
        {
          bodyMarkdown: manifest.problem.statement,
          inputFormat: manifest.problem.inputFormat,
          locale: DEFAULT_LOCALE,
          outputFormat: manifest.problem.outputFormat,
          problemId,
          title: manifest.problem.title,
        },
        {
          bodyMarkdown: manifest.problem.statement,
          inputFormat: manifest.problem.inputFormat,
          outputFormat: manifest.problem.outputFormat,
          title: manifest.problem.title,
        },
      );
    });

    await Promise.all(
      oldKeys.map((key) => deleteAdvancedImageTarball(storage(), key).catch(() => undefined)),
    );

    return {
      advancedConfig,
      builtImages: serviceTag ? ["run", "grade", "service"] : ["run", "grade"],
      problem: manifest.problem,
      requiredPaths: manifest.student.requiredPaths,
    };
  } catch (err) {
    await Promise.all(
      uploadedKeys.map((key) =>
        deleteAdvancedImageTarball(storage(), key).catch(() => undefined),
      ),
    );
    throw err;
  } finally {
    await Promise.all(localTags.map((tag) => bestEffortRemoveImage(tag)));
    await rm(root, { force: true, recursive: true });
  }
}

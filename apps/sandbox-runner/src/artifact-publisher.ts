import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export const ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;
export const ARTIFACT_MAX_ENTRIES = 4096;
export const PUBLISHED_ARTIFACT_SUBPATH = "published";
export const ARTIFACT_READY_FILE = ".nojv-artifact-ready.json";

export interface PublishedArtifact {
  published: true;
  bytes: number;
  files: number;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function directory(root: string) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Artifact root must be a real directory");
  return info;
}

async function readCommand(sourceDir: string): Promise<string[] | null> {
  let file;
  try {
    file = await open(
      path.join(sourceDir, "run-command.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 16_384 || (info.mode & 0o7000) !== 0)
      throw new Error("Invalid artifact run command file");
    const command: unknown = JSON.parse(await file.readFile("utf8"));
    if (
      !Array.isArray(command) ||
      command.length === 0 ||
      command.length > 64 ||
      !command.every(
        (value): value is string =>
          typeof value === "string" &&
          value.length > 0 &&
          value.length <= 4096 &&
          !value.includes("\0"),
      )
    )
      throw new Error("Invalid artifact run command");
    let artifactReference = false;
    for (const argument of command) {
      if (argument.split("/").includes(".."))
        throw new Error("Artifact command contains path traversal");
      if (!argument.startsWith("/")) continue;
      if (argument !== "/artifact" && !argument.startsWith("/artifact/"))
        throw new Error("Artifact command references an external path");
      artifactReference = true;
      const info = await lstat(path.join(sourceDir, path.relative("/artifact", argument)));
      if ((!info.isFile() && !info.isDirectory()) || info.isSymbolicLink())
        throw new Error("Artifact command references an invalid entry");
    }
    const executable = command[0];
    if (
      !executable ||
      (!executable.startsWith("/artifact/") &&
        !["java", "node", "python3"].includes(executable)) ||
      !artifactReference
    )
      throw new Error("Artifact command must run a published artifact");
    if (executable.startsWith("/artifact/")) {
      const info = await lstat(path.join(sourceDir, path.relative("/artifact", executable)));
      if (!info.isFile() || (info.mode & 0o111) === 0)
        throw new Error("Artifact executable has no execute permission");
    }
    return command;
  } finally {
    await file.close();
  }
}

export async function publishArtifact(
  options: {
    sourceDir?: string;
    targetDir?: string;
    maxBytes?: number;
    maxEntries?: number;
  } = {},
): Promise<PublishedArtifact | { published: false }> {
  const sourceDir = path.resolve(options.sourceDir ?? "/artifact");
  const targetDir = path.resolve(options.targetDir ?? "/artifact-output");
  const maxBytes = options.maxBytes ?? ARTIFACT_MAX_BYTES;
  const maxEntries = options.maxEntries ?? ARTIFACT_MAX_ENTRIES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > ARTIFACT_MAX_BYTES ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > ARTIFACT_MAX_ENTRIES
  )
    throw new Error("Invalid artifact publication bounds");
  if (sourceDir === targetDir || targetDir.startsWith(`${sourceDir}${path.sep}`))
    throw new Error("Artifact publication requires separate directories");
  await directory(sourceDir);
  await directory(targetDir);
  if (!(await readCommand(sourceDir))) return { published: false };
  const staging = path.join(targetDir, ".publishing");
  const published = path.join(targetDir, PUBLISHED_ARTIFACT_SUBPATH);
  for (const entry of await readdir(targetDir)) {
    if (entry !== "lost+found") throw new Error("Artifact destination must be empty");
    const info = await lstat(path.join(targetDir, entry));
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Artifact filesystem metadata must be a real directory");
  }
  await mkdir(staging, { mode: 0o700 });
  let bytes = 0;
  let files = 0;
  let entries = 0;
  const buffer = Buffer.alloc(64 * 1024);
  async function copyDirectory(relative: string): Promise<void> {
    const source = path.join(sourceDir, relative);
    const info = await directory(source);
    if (relative && (info.mode & 0o7000) !== 0)
      throw new Error("Artifact special permission bits are forbidden");
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const name = entry.name;
      if (
        name === ARTIFACT_READY_FILE ||
        name === ".publishing" ||
        name.includes("/") ||
        name === "." ||
        name === ".."
      )
        throw new Error("Reserved artifact path");
      if (++entries > maxEntries) throw new Error("Artifact entry limit exceeded");
      const child = path.join(relative, name);
      const inputPath = path.join(sourceDir, child);
      const outputPath = path.join(staging, child);
      if (entry.isDirectory()) {
        await mkdir(outputPath, { mode: 0o700 });
        await copyDirectory(child);
        continue;
      }
      if (!entry.isFile())
        throw new Error(
          "Artifact must contain only regular files and directories without hard links",
        );
      const input = await open(
        inputPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await input.stat();
        if (!before.isFile() || before.nlink !== 1)
          throw new Error("Artifact must contain regular files without hard links");
        if ((before.mode & 0o7000) !== 0)
          throw new Error("Artifact special permission bits are forbidden");
        if (before.size > maxBytes - bytes) throw new Error("Artifact byte limit exceeded");
        const output = await open(
          outputPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          (before.mode & 0o111) !== 0 ? 0o700 : 0o600,
        );
        let copied = 0;
        try {
          for (;;) {
            const read = await input.read(buffer, 0, buffer.length, null);
            if (read.bytesRead === 0) break;
            bytes += read.bytesRead;
            copied += read.bytesRead;
            if (bytes > maxBytes || copied > before.size)
              throw new Error("Artifact byte limit exceeded or file grew");
            let written = 0;
            while (written < read.bytesRead) {
              const result = await output.write(
                buffer,
                written,
                read.bytesRead - written,
                null,
              );
              if (result.bytesWritten === 0) throw new Error("Artifact write made no progress");
              written += result.bytesWritten;
            }
          }
          await output.sync();
        } finally {
          await output.close();
        }
        const after = await input.stat();
        if (
          copied !== before.size ||
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs ||
          after.nlink !== 1
        )
          throw new Error("Artifact changed during publication");
        files++;
      } finally {
        await input.close();
      }
    }
  }
  try {
    await copyDirectory("");
    await readCommand(staging);
    const result: PublishedArtifact = { published: true, bytes, files };
    const marker = await open(
      path.join(staging, ARTIFACT_READY_FILE),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await marker.writeFile(JSON.stringify(result));
      await marker.sync();
    } finally {
      await marker.close();
    }
    await rename(staging, published);
    return result;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

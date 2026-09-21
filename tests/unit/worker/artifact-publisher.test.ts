import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ARTIFACT_READY_FILE,
  publishArtifact,
} from "../../../apps/sandbox-runner/src/artifact-publisher";

let root: string;
let sourceDir: string;
let targetDir: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "nojv-artifact-"));
  sourceDir = path.join(root, "source");
  targetDir = path.join(root, "target");
  await mkdir(sourceDir);
  await mkdir(targetDir);
  await writeFile(path.join(sourceDir, "main"), "binary", { mode: 0o755 });
  await writeFile(path.join(sourceDir, "run-command.json"), JSON.stringify(["/artifact/main"]));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const publish = () => publishArtifact({ sourceDir, targetDir });

describe("bounded artifact publication", () => {
  it("rejects a FIFO run command without waiting for a writer", async () => {
    await rm(path.join(sourceDir, "run-command.json"));
    const run = promisify(execFile);
    await run("mkfifo", [path.join(sourceDir, "run-command.json")]);
    const script = `
      import { publishArtifact } from "./apps/sandbox-runner/src/artifact-publisher.ts";
      try {
        await publishArtifact(${JSON.stringify({ sourceDir, targetDir })});
        process.exitCode = 1;
      } catch (error) {
        process.stdout.write(error.message);
      }
    `;
    const result = await run(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { timeout: 2_000 },
    );
    expect(result.stdout).toContain("Invalid artifact run command file");
    expect(await readdir(targetDir)).toEqual([]);
  });

  it("publishes an atomic directory and readiness marker with normalized executable permissions", async () => {
    const result = await publish();
    expect(result).toEqual({ published: true, bytes: 24, files: 2 });
    expect(await readdir(targetDir)).toEqual(["published"]);
    expect(await readFile(path.join(targetDir, "published/main"), "utf8")).toBe("binary");
    expect((await lstat(path.join(targetDir, "published/main"))).mode & 0o777).toBe(0o700);
    expect((await lstat(path.join(targetDir, "published/run-command.json"))).mode & 0o777).toBe(
      0o600,
    );
    expect(
      JSON.parse(
        await readFile(path.join(targetDir, "published", ARTIFACT_READY_FILE), "utf8"),
      ),
    ).toEqual(result);
  });

  it("copies nested Java and interpreted artifacts without requiring every file executable", async () => {
    await mkdir(path.join(sourceDir, "classes"));
    await writeFile(path.join(sourceDir, "classes/Main.class"), "class");
    await writeFile(
      path.join(sourceDir, "run-command.json"),
      JSON.stringify(["java", "-cp", "/artifact/classes", "Main"]),
    );
    expect((await publish()).published).toBe(true);
  });

  it("reports a failed compile without publishing an artifact", async () => {
    await rm(path.join(sourceDir, "run-command.json"));
    expect(await publish()).toEqual({ published: false });
    expect(await readdir(targetDir)).toEqual([]);
  });

  it("publishes beside filesystem recovery metadata without traversing or exposing it", async () => {
    await mkdir(path.join(targetDir, "lost+found"));
    await writeFile(path.join(targetDir, "lost+found/recovered"), "private filesystem data");
    expect((await publish()).published).toBe(true);
    expect(await readdir(targetDir)).toEqual(["lost+found", "published"]);
    expect(await readdir(path.join(targetDir, "published"))).not.toContain("lost+found");
    expect(await readFile(path.join(targetDir, "lost+found/recovered"), "utf8")).toBe(
      "private filesystem data",
    );
  });

  it("rejects symlink or regular-file filesystem metadata at the PVC root", async () => {
    const metadata = path.join(targetDir, "lost+found");
    await symlink(sourceDir, metadata);
    await expect(publish()).rejects.toThrow("metadata must be a real directory");
    await rm(metadata);
    await writeFile(metadata, "not a directory");
    await expect(publish()).rejects.toThrow("metadata must be a real directory");
  });

  it("rejects symlinks, including intermediate directories, without exposing private files", async () => {
    await writeFile(path.join(root, "answer"), "secret");
    await symlink(root, path.join(sourceDir, "private"));
    await expect(publish()).rejects.toThrow("regular files");
    expect(await readdir(targetDir)).toEqual([]);
  });

  it("rejects hard-linked files and set-id permissions", async () => {
    await link(path.join(sourceDir, "main"), path.join(sourceDir, "duplicate"));
    await expect(publish()).rejects.toThrow("hard links");
    expect(await readdir(targetDir)).toEqual([]);
    await rm(path.join(sourceDir, "duplicate"));
    await chmod(path.join(sourceDir, "main"), 0o4755);
    await expect(publish()).rejects.toThrow("special permission");
    expect(await readdir(targetDir)).toEqual([]);
  });

  it("rejects sockets and removes partially copied output", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path.join(sourceDir, "socket"), resolve);
    });
    try {
      await expect(publish()).rejects.toThrow("regular files");
      expect(await readdir(targetDir)).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("enforces aggregate bytes and entry counts, cleaning all partial data", async () => {
    await writeFile(path.join(sourceDir, "large"), Buffer.alloc(256));
    await expect(publishArtifact({ sourceDir, targetDir, maxBytes: 128 })).rejects.toThrow(
      "byte limit",
    );
    expect(await readdir(targetDir)).toEqual([]);
    await expect(publishArtifact({ sourceDir, targetDir, maxEntries: 1 })).rejects.toThrow(
      "entry limit",
    );
    expect(await readdir(targetDir)).toEqual([]);
  });

  it.each([
    ["/etc/passwd"],
    ["sh", "-c", "/artifact/main"],
    ["/artifact/../main"],
    ["node", "/submission/main.js"],
    [],
    [42],
  ])("rejects invalid or escaping command %j", async (...command) => {
    await writeFile(path.join(sourceDir, "run-command.json"), JSON.stringify(command));
    await expect(publish()).rejects.toThrow();
    expect(await readdir(targetDir)).toEqual([]);
  });

  it("rejects a non-executable native binary", async () => {
    await chmod(path.join(sourceDir, "main"), 0o644);
    await expect(publish()).rejects.toThrow("execute permission");
  });

  it("rejects symlink destination roots and refuses to overwrite a published artifact", async () => {
    await rm(targetDir, { recursive: true });
    await symlink(sourceDir, targetDir);
    await expect(publish()).rejects.toThrow("real directory");
    await rm(targetDir);
    await mkdir(targetDir);
    await publish();
    await expect(publish()).rejects.toThrow("must be empty");
  });
});

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import type { Language, SandboxRequest } from "@nojv/core";

import { buildRunConfigMapData } from "../../../apps/worker/src/services/k8s-configmaps";
import { buildPayloadConfigMaps } from "../../../apps/worker/src/services/k8s-payload";
import { requireSandboxImage } from "./_sandbox-image";

const run = promisify(execFile);
const image = process.env.NOJV_TEST_SANDBOX_IMAGE ?? "nojv-sandbox:local";
const sources: Record<Language, string> = {
  c: `#include <stdio.h>
int main(void) { int x; if (scanf("%d", &x) != 1) return 1; printf("%d\\n", x + 1); }
`,
  cpp: `#include <iostream>
int main() { int x; std::cin >> x; std::cout << x + 1 << "\\n"; }
`,
  go: `package main
import "fmt"
func main() { var x int; fmt.Scan(&x); fmt.Println(x + 1) }
`,
  java: `import java.util.Scanner;
public class Main {
  public static void main(String[] args) { System.out.println(new Scanner(System.in).nextInt() + 1); }
}
`,
  javascript: `import fs from "node:fs";
console.log(Number(fs.readFileSync(0, "utf8")) + 1);
`,
  python: `import sys
print(int(sys.stdin.read()) + 1)
`,
  rust: `use std::io::{self, Read};
fn main() {
    let mut text = String::new(); io::stdin().read_to_string(&mut text).unwrap();
    println!("{}", text.trim().parse::<i32>().unwrap() + 1);
}
`,
  typescript: `import * as fs from "node:fs";
console.log(Number(fs.readFileSync(0, "utf8")) + 1);
`,
};

async function writeFiles(directory: string, files: Record<string, string>): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o755 });
  for (const [name, content] of Object.entries(files))
    await writeFile(path.join(directory, name), content, { mode: 0o644 });
}

async function artifactHashes(directory: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  async function visit(relative: string) {
    for (const entry of await readdir(path.join(directory, relative), {
      withFileTypes: true,
    })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(child);
      else
        hashes[child] = createHash("sha256")
          .update(await readFile(path.join(directory, child)))
          .digest("hex");
    }
  }
  await visit("");
  return hashes;
}

interface ContainerRecord {
  name: string;
  phase: string;
  id: string;
}
async function container(
  root: string,
  phase: string,
  mounts: string[],
  record: ContainerRecord[],
  caseIndex?: number,
) {
  const name = `nojv-prepared-test-${randomUUID()}`;
  const cidFile = path.join(root, `${name}.cid`);
  const args = [
    "run",
    "--rm",
    "--name",
    name,
    "--cidfile",
    cidFile,
    "--label",
    "nojv.test=prepared-artifact",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--user",
    "10001:10001",
    "--cpus",
    "1",
    "--memory",
    phase === "prepare" ? "512m" : "320m",
    "--memory-swap",
    phase === "prepare" ? "512m" : "320m",
    "--pids-limit",
    "256",
    "--tmpfs",
    `/tmp:rw,nosuid,nodev,size=${phase === "prepare" ? "256m" : "64m"},uid=10001,gid=10001`,
    "--tmpfs",
    "/workspace:rw,nosuid,nodev,size=128m,uid=10001,gid=10001",
    "--env",
    `SANDBOX_PHASE=${phase}`,
    "--env",
    "HOME=/tmp",
    "--env",
    "PYTHONDONTWRITEBYTECODE=1",
    ...(caseIndex === undefined ? [] : ["--env", `SANDBOX_CASE_INDEX=${caseIndex}`]),
    ...mounts,
    image,
    "node",
    "/runner/index.js",
  ];
  try {
    const output = await run("docker", args, { timeout: 150_000, maxBuffer: 8 * 1024 * 1024 });
    record.push({ name, phase, id: (await readFile(cidFile, "utf8")).trim() });
    return output;
  } finally {
    await run("docker", ["rm", "--force", name], { timeout: 10_000 }).catch(() => undefined);
  }
}

const bind = (source: string, target: string, readOnly = false) => [
  "--mount",
  `type=bind,source=${source},target=${target}${readOnly ? ",readonly" : ""}`,
];

describe("prepared artifact reuse in fresh Docker containers", () => {
  it.for(Object.entries(sources))(
    "publishes and reuses %s artifacts with fresh scratch and read-only outputs",
    { timeout: 240_000 },
    async ([language, source], ctx) => {
      if (!(await requireSandboxImage(ctx))) return;
      const root = await mkdtemp(path.join(os.tmpdir(), "nojv-prepared-integration-"));
      try {
        const payload = path.join(root, "payload");
        const artifact = path.join(root, "compiled");
        const target = path.join(root, "persistent-volume");
        await mkdir(payload);
        for (const directory of [artifact, target]) {
          await mkdir(directory);
          await chmod(directory, 0o777);
        }
        const request: SandboxRequest = {
          submissionId: `prepared-${language}`,
          sourceCode: source,
          language: language as Language,
          problemType: "full_source",
          judgeType: "standard",
          judgeConfig: {},
          limits: { timeoutMs: 10_000, memoryMb: 256 },
          testcases: [],
        };
        const maps = buildPayloadConfigMaps(
          "judge-prepared",
          "test",
          buildRunConfigMapData(request),
        );
        for (const map of maps) {
          for (const [key, value] of Object.entries(map.data ?? {}))
            await writeFile(path.join(payload, key), value, { mode: 0o644 });
          for (const [key, value] of Object.entries(map.binaryData ?? {}))
            await writeFile(path.join(payload, key), Buffer.from(value, "base64"), {
              mode: 0o644,
            });
        }
        const containers: ContainerRecord[] = [];
        const compile = await container(
          root,
          "prepare",
          [
            ...bind(payload, "/payload", true),
            ...bind(artifact, "/artifact"),
            "--tmpfs",
            "/submission:rw,nosuid,nodev,size=128m,uid=10001,gid=10001",
          ],
          containers,
        );
        const compileResult = JSON.parse(compile.stdout) as {
          runCommand?: string[];
          compilationError?: string;
        };
        expect(compileResult.compilationError, compile.stderr).toBeUndefined();
        expect(compileResult.runCommand).toBeDefined();
        const publish = await container(
          root,
          "publish-artifact",
          [...bind(artifact, "/artifact", true), ...bind(target, "/artifact-output")],
          containers,
        );
        expect(JSON.parse(publish.stdout)).toMatchObject({ published: true });
        const published = path.join(target, "published");
        const originalHashes = await artifactHashes(published);
        for (const [index, value] of [2, 9].entries()) {
          const submission = path.join(root, `submission-${index}`);
          await writeFiles(
            submission,
            buildRunConfigMapData({
              ...request,
              testcases: [{ index, input: `${value}\n`, weight: 1, isSample: false }],
            }),
          );
          const output = await container(
            root,
            "run-case",
            [...bind(published, "/artifact", true), ...bind(submission, "/submission", true)],
            containers,
            index,
          );
          const result = JSON.parse(output.stdout) as {
            rawRuns?: {
              index: number;
              stdout: string;
              exitCode: number;
              errorVerdict?: string;
            }[];
          };
          expect(result.rawRuns, output.stderr).toHaveLength(1);
          expect(result.rawRuns![0]).toMatchObject({
            index,
            stdout: `${value + 1}\n`,
            exitCode: 0,
          });
          expect(result.rawRuns![0]!.errorVerdict).toBeUndefined();
          expect(output.stderr).not.toContain("Compiling...");
        }
        expect(await artifactHashes(published)).toEqual(originalHashes);
        expect(containers.filter((entry) => entry.phase === "prepare")).toHaveLength(1);
        expect(containers.filter((entry) => entry.phase === "run-case")).toHaveLength(2);
        expect(new Set(containers.map((entry) => entry.id)).size).toBe(4);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import type { Language, SandboxRequest } from "@nojv/core";

import { buildRunConfigMapData } from "../../../apps/worker/src/services/k8s-configmaps";
import { buildPayloadConfigMaps } from "../../../apps/worker/src/services/k8s-payload";
import { buildJudgePayload } from "../../../apps/worker/src/services/stage-result";
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
) {
  const name = `nojv-compile-once-test-${randomUUID()}`;
  const cidFile = path.join(root, `${name}.cid`);
  const args = [
    "run",
    "--rm",
    "--name",
    name,
    "--cidfile",
    cidFile,
    "--label",
    "nojv.test=compile-once-run-case",
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

async function writePayload(directory: string, files: Record<string, string>): Promise<void> {
  for (const map of buildPayloadConfigMaps("judge-payload", "test", files)) {
    for (const [key, value] of Object.entries(map.data ?? {}))
      await writeFile(path.join(directory, key), value, { mode: 0o644 });
    for (const [key, value] of Object.entries(map.binaryData ?? {}))
      await writeFile(path.join(directory, key), Buffer.from(value, "base64"), { mode: 0o644 });
  }
}

describe("compile once, run every case in one container, judge in another", () => {
  it.for(Object.entries(sources))(
    "prepares %s once, runs the stage against the read-only artifact and judges it",
    { timeout: 240_000 },
    async ([language, source], ctx) => {
      if (!(await requireSandboxImage(ctx))) return;
      const root = await mkdtemp(path.join(os.tmpdir(), "nojv-compile-once-integration-"));
      try {
        const payload = path.join(root, "payload");
        const artifact = path.join(root, "compiled");
        const outputs = path.join(root, "outputs");
        const judgePayload = path.join(root, "judge-payload");
        const judgeArtifact = path.join(root, "judge-artifact");
        for (const directory of [payload, artifact, outputs, judgePayload, judgeArtifact]) {
          await mkdir(directory);
          await chmod(directory, 0o777);
        }
        const request: SandboxRequest = {
          submissionId: `compile-once-${language}`,
          sourceCode: source,
          language: language as Language,
          problemType: "full_source",
          judgeType: "standard",
          judgeConfig: {},
          limits: { timeoutMs: 10_000, memoryMb: 256 },
          testcases: [],
        };
        await writePayload(payload, buildRunConfigMapData(request, 1));
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
        const stageRequest: SandboxRequest = {
          ...request,
          testcases: [2, 9].map((value, index) => ({
            index,
            input: `${value}\n`,
            output: `${value + 1}\n`,
            weight: 1,
            isSample: false,
          })),
        };
        const submission = path.join(root, "submission");
        await writeFiles(submission, buildRunConfigMapData(stageRequest, 2));
        const runOutput = await container(
          root,
          "run-stage",
          [
            ...bind(artifact, "/artifact", true),
            ...bind(submission, "/submission", true),
            ...bind(outputs, "/outputs"),
          ],
          containers,
        );
        const result = JSON.parse(runOutput.stdout) as {
          rawRuns?: {
            index: number;
            stdout: string;
            exitCode: number;
            errorVerdict?: string;
          }[];
        };
        expect(result.rawRuns, runOutput.stderr).toHaveLength(2);
        for (const [index, value] of [2, 9].entries()) {
          expect(result.rawRuns![index]).toMatchObject({
            index,
            stdout: `${value + 1}\n`,
            exitCode: 0,
          });
          expect(result.rawRuns![index]!.errorVerdict).toBeUndefined();
        }
        expect(runOutput.stderr).not.toContain("Compiling...");

        await writePayload(judgePayload, buildJudgePayload(stageRequest));
        const judgeOutput = await container(
          root,
          "judge-stage",
          [
            ...bind(judgePayload, "/payload", true),
            ...bind(judgeArtifact, "/artifact"),
            ...bind(outputs, "/outputs", true),
            "--tmpfs",
            "/submission:rw,nosuid,nodev,size=128m,uid=10001,gid=10001",
          ],
          containers,
        );
        expect(JSON.parse(judgeOutput.stdout), judgeOutput.stderr).toEqual({
          validatorOutcomes: [
            { index: 0, verdict: "AC" },
            { index: 1, verdict: "AC" },
          ],
        });
        expect(containers.map((entry) => entry.phase)).toEqual([
          "prepare",
          "run-stage",
          "judge-stage",
        ]);
        expect(new Set(containers.map((entry) => entry.id)).size).toBe(3);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

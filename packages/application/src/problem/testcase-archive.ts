import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";

import { ZipArchive } from "archiver";

import { testcaseSetRepo } from "@nojv/db";

import { readTestcaseBlobs } from "./blobs";
import { assertProblemContentReadAccess, type ProblemActorContext } from "./permissions";

export function testcaseArchiveStem(
  subtask: number,
  testcase: number,
  caseCount: number,
): string {
  const caseWidth = Math.max(2, String(caseCount).length);
  return `${String(subtask).padStart(2, "0")}${String(testcase).padStart(caseWidth, "0")}`;
}

export async function exportTestcaseArchive(
  actor: ProblemActorContext,
  problemId: string,
): Promise<{ fileName: string; body: ReadableStream<Uint8Array> }> {
  const problem = await assertProblemContentReadAccess(actor, problemId);
  const sets = await testcaseSetRepo.findByProblemId(problemId);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const output = new PassThrough();
  const closed = new AbortController();
  output.once("close", () => closed.abort());
  archive.on("error", (err) => output.destroy(err));
  archive.pipe(output);

  const append = async (name: string, content: string) => {
    archive.append(content, { name });
    await once(archive, "entry", { signal: closed.signal });
  };

  void (async () => {
    try {
      for (const [setIndex, set] of sets.entries()) {
        for (const [caseIndex, testcase] of set.testcases.entries()) {
          const stem = testcaseArchiveStem(setIndex + 1, caseIndex + 1, set.testcases.length);
          const blobs = await readTestcaseBlobs(testcase);
          await append(`${stem}.in`, blobs.input);
          if (blobs.output !== undefined) await append(`${stem}.out`, blobs.output);
          for (const [name, content] of Object.entries(blobs.inputFiles ?? {})) {
            await append(`${stem}.files/${name}`, content);
          }
        }
      }
      await archive.finalize();
    } catch (err) {
      archive.abort();
      output.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return {
    fileName: `problem-${String(problem.displayId ?? problem.id)}-testcases.zip`,
    body: Readable.toWeb(output) as ReadableStream<Uint8Array>,
  };
}

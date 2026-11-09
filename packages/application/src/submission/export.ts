import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { safeRelativePath } from "@nojv/core";
import type { ActorContext } from "../shared/actor-context";
import { IntegrityError, NotFoundError } from "../shared/errors";
import { getSubmissionById, readSubmissionSources } from "./details";
import { listContextSubmissionsPaged } from "./history";

type Context = Parameters<typeof listContextSubmissionsPaged>[0]["context"];
type Page = Awaited<ReturnType<typeof listContextSubmissionsPaged>>;
type Row = Page["items"][number];

type CsvValue = string | number | null | undefined;

function csvCell(value: CsvValue): string {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^\s*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvLine(values: CsvValue[]): string {
  return values.map(csvCell).join(",") + "\r\n";
}

function rowCsv(row: Row): string {
  return csvLine([
    row.id,
    row.user.id,
    row.user.username,
    row.user.name,
    row.problem.id,
    row.problem.displayId,
    row.problem.title,
    row.createdAt,
    row.language,
    row.status,
    row.score,
    row.runtimeMs,
    row.memoryKb,
  ]);
}

function folderSegment(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value))
    throw new IntegrityError("Invalid export folder identifier.");
  return value;
}

export async function exportContextSubmissions(
  actor: ActorContext,
  context: Context,
  format: "csv" | "zip",
): Promise<{ fileName: string; body: ReadableStream<Uint8Array> }> {
  const first = await listContextSubmissionsPaged({ actor, context, limit: 50 });
  async function* rows() {
    let current = first;
    for (let page = 1; page <= first.totalPages; page++) {
      if (page > 1)
        current = await listContextSubmissionsPaged({
          actor,
          context,
          limit: 50,
          page,
          snapshot: first.snapshot,
        });
      yield* current.items;
    }
  }
  const fileName = `${context.type}-${folderSegment(context.id)}-submissions.${format}`;
  if (format === "csv") {
    async function* csv() {
      yield Buffer.from(
        "\uFEFF" +
          csvLine([
            "submission_id",
            "user_id",
            "username",
            "name",
            "problem_id",
            "problem_number",
            "problem_title",
            "submitted_at_utc",
            "language",
            "status",
            "score",
            "runtime_ms",
            "memory_kb",
          ]),
      );
      for await (const row of rows()) yield Buffer.from(rowCsv(row));
    }
    return {
      fileName,
      body: Readable.toWeb(Readable.from(csv())) as ReadableStream<Uint8Array>,
    };
  }

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = new PassThrough();
  const closed = new AbortController();
  output.once("close", () => {
    closed.abort();
    archive.abort();
  });
  archive.on("error", (err) => output.destroy(err));
  archive.on("warning", (err) => output.destroy(err));
  archive.pipe(output);

  void (async () => {
    try {
      for await (const row of rows()) {
        closed.signal.throwIfAborted();
        const prefix = [row.user.id, row.problem.id, row.id].map(folderSegment).join("/");
        const submission = await getSubmissionById(row.id);
        if (!submission) throw new NotFoundError("Submission not found.");
        const sources =
          submission.sourceStorage === null
            ? [
                {
                  path: "SOURCE_UNAVAILABLE.txt",
                  content: `Submission ${row.id} has no stored source files (status: ${row.status}). The source upload has not completed or failed.\n`,
                },
              ]
            : await readSubmissionSources(submission.sourceStorage);
        const names = new Set<string>();
        for (const source of sources) {
          closed.signal.throwIfAborted();
          const path = safeRelativePath.parse(source.path);
          if (names.has(path)) throw new IntegrityError("Duplicate submission source path.");
          names.add(path);
          archive.append(source.content, { name: `${prefix}/${path}` });
          await once(archive, "entry", { signal: closed.signal });
        }
      }
      await archive.finalize();
    } catch (err) {
      archive.abort();
      output.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return { fileName, body: Readable.toWeb(output) as ReadableStream<Uint8Array> };
}

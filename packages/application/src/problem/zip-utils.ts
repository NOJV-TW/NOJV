import { type Readable } from "node:stream";

import { type File as ZipFile } from "unzipper";

export async function readZipEntryBounded(
  entry: ZipFile,
  maxBytes: number,
  makeOverflowError: (path: string) => Error,
): Promise<Buffer> {
  if (maxBytes <= 0) {
    throw makeOverflowError(entry.path);
  }
  const stream = entry.stream();
  stream.once("pipe", (source: Readable) => {
    // unzipper's pipe() does not destroy the inflater when its output closes.
    stream.once("close", () => source.destroy());
  });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) throw makeOverflowError(entry.path);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

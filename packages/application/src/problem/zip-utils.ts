import { type Entry as ZipEntry, type File as ZipFile } from "unzipper";

export async function readZipEntryBounded(
  entry: ZipFile,
  maxBytes: number,
  makeOverflowError: (path: string) => Error,
): Promise<Buffer> {
  if (maxBytes <= 0) {
    throw makeOverflowError(entry.path);
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
    const onData = (chunk: Buffer): void => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        drainEntry();
        reject(makeOverflowError(entry.path));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    };
    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}

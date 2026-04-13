/**
 * Thin wrapper around `@nojv/storage` for testcase + workspace blobs.
 *
 * Owns a lazily-constructed S3 client so domain mutations don't have to
 * thread one through every call. Tests `vi.mock("@nojv/storage", ...)`
 * the underlying module to stub out network IO entirely.
 *
 * Best-effort cleanup helpers (`*Cleanup`) catch + warn on failure rather
 * than rethrowing — DB has already committed by the time they run, so
 * failing them would surface a "delete failed" error to the user even
 * though the user-visible state is correct. Orphan S3 objects are a
 * tolerable cost per the design doc (2026-04-13 testcase blob storage).
 */
import {
  createStorageClient,
  deleteBlob,
  deleteBlobsByPrefix,
  getText,
  problemPrefix,
  putText,
  testcaseInputFileKey,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey
} from "@nojv/storage";

// Inferred type of the storage client, avoiding a direct dep on
// @aws-sdk/client-s3 in @nojv/domain (the AWS SDK lives under @nojv/storage).
type StorageClient = ReturnType<typeof createStorageClient>;

let cachedClient: StorageClient | null = null;

function getClient(): StorageClient {
  cachedClient ??= createStorageClient();
  return cachedClient;
}

export interface TestcaseBlobInputs {
  problemId: string;
  testcaseId: string;
  input: string;
  output?: string | undefined;
  inputFiles?: Record<string, string> | undefined;
}

export interface TestcaseBlobKeys {
  inputKey: string;
  outputKey: string | null;
  inputFileKeys: Record<string, string> | null;
}

/**
 * Uploads input / output / aux files for a single testcase in parallel.
 * Returns the key columns to persist on the row. Caller MUST run this
 * BEFORE the DB INSERT so a failed S3 upload short-circuits the write.
 */
export async function writeTestcaseBlobs(input: TestcaseBlobInputs): Promise<TestcaseBlobKeys> {
  const client = getClient();
  const inputKey = testcaseInputKey(input.problemId, input.testcaseId);
  const outputKey =
    input.output !== undefined ? testcaseOutputKey(input.problemId, input.testcaseId) : null;
  const inputFileKeys =
    input.inputFiles && Object.keys(input.inputFiles).length > 0
      ? Object.fromEntries(
          Object.keys(input.inputFiles).map((name) => [
            name,
            testcaseInputFileKey(input.problemId, input.testcaseId, name)
          ])
        )
      : null;

  const uploads: Promise<unknown>[] = [putText(client, inputKey, input.input)];
  if (outputKey !== null && input.output !== undefined) {
    uploads.push(putText(client, outputKey, input.output));
  }
  if (input.inputFiles && inputFileKeys !== null) {
    for (const [name, content] of Object.entries(input.inputFiles)) {
      const fileKey = inputFileKeys[name];
      if (fileKey !== undefined) {
        uploads.push(putText(client, fileKey, content));
      }
    }
  }

  await Promise.all(uploads);
  return { inputKey, outputKey, inputFileKeys };
}

/**
 * Reads a testcase's input / expected output / aux files from S3 in parallel.
 * Returns the in-memory shape that judge-context callers used to read directly
 * from the DB row.
 */
export async function readTestcaseBlobs(row: {
  inputKey: string;
  outputKey: string | null;
  inputFileKeys: Record<string, string> | null;
}): Promise<{
  input: string;
  output: string | undefined;
  inputFiles: Record<string, string> | undefined;
}> {
  const client = getClient();
  const fileEntries = Object.entries(row.inputFileKeys ?? {});

  const [input, output, fileContents] = await Promise.all([
    getText(client, row.inputKey),
    row.outputKey ? getText(client, row.outputKey) : Promise.resolve(undefined),
    Promise.all(fileEntries.map(([, key]) => getText(client, key)))
  ]);

  let inputFiles: Record<string, string> | undefined;
  if (fileEntries.length > 0) {
    const built: Record<string, string> = {};
    fileEntries.forEach(([name], i) => {
      const content = fileContents[i];
      if (content !== undefined) {
        built[name] = content;
      }
    });
    inputFiles = built;
  }

  return { input, output, inputFiles };
}

/**
 * Overwrites a single field (input or output) of a testcase in place.
 * Keys are stable for the lifetime of the row, so no DB UPDATE is needed
 * — we just put the new bytes at the existing key.
 */
export async function overwriteTestcaseField(
  problemId: string,
  testcaseId: string,
  field: "input" | "output",
  content: string
): Promise<void> {
  const key =
    field === "input"
      ? testcaseInputKey(problemId, testcaseId)
      : testcaseOutputKey(problemId, testcaseId);
  await putText(getClient(), key, content);
}

/**
 * Best-effort delete of every S3 object that backs a problem. Used by
 * `deleteProblem`. DB cascade has already removed every row by the time
 * this runs; an S3 failure here only leaves orphan objects, which the
 * design accepts. This sweeps the entire `problems/{id}/` prefix and so
 * also removes markdown images and advanced-mode tarballs.
 */
export async function bestEffortDeleteProblemBlobs(problemId: string): Promise<void> {
  try {
    await deleteBlobsByPrefix(getClient(), problemPrefix(problemId));
  } catch (err) {
    console.warn(
      `[problem-blobs] orphan S3 blobs after problem delete: problemId=${problemId}`,
      err
    );
  }
}

/**
 * Best-effort delete of just the testcase + workspace blobs for a problem,
 * preserving any unrelated objects (markdown images, advanced-mode
 * tarballs). Used by the standard → advanced conversion path which drops
 * the standard-mode payloads but keeps everything else.
 */
export async function bestEffortDeleteProblemStandardBlobs(problemId: string): Promise<void> {
  const client = getClient();
  const prefixes = [`problems/${problemId}/testcases/`, `problems/${problemId}/workspace/`];
  for (const prefix of prefixes) {
    try {
      await deleteBlobsByPrefix(client, prefix);
    } catch (err) {
      console.warn(
        `[problem-blobs] orphan S3 blobs after standard-mode cleanup: problemId=${problemId} prefix=${prefix}`,
        err
      );
    }
  }
}

/**
 * Best-effort delete of every S3 object backing a single testcase. The key
 * layout puts input / output / aux files all under the testcase id prefix,
 * so a single prefix delete is enough.
 */
export async function bestEffortDeleteTestcaseBlobs(
  problemId: string,
  testcaseId: string
): Promise<void> {
  try {
    await deleteBlobsByPrefix(getClient(), `problems/${problemId}/testcases/${testcaseId}/`);
  } catch (err) {
    console.warn(
      `[problem-blobs] orphan S3 blobs after testcase delete: problemId=${problemId} testcaseId=${testcaseId}`,
      err
    );
  }
}

/**
 * Best-effort delete of a single workspace-file blob.
 */
export async function bestEffortDeleteWorkspaceBlob(
  problemId: string,
  fileId: string
): Promise<void> {
  try {
    await deleteBlob(getClient(), workspaceFileKey(problemId, fileId));
  } catch (err) {
    console.warn(
      `[problem-blobs] orphan S3 blob after workspace file delete: problemId=${problemId} fileId=${fileId}`,
      err
    );
  }
}

/**
 * Writes a single workspace file's content to S3. Returns the key that
 * goes on the DB row. Caller MUST run this BEFORE the DB INSERT.
 */
export async function writeWorkspaceFileBlob(
  problemId: string,
  fileId: string,
  content: string
): Promise<string> {
  const key = workspaceFileKey(problemId, fileId);
  await putText(getClient(), key, content);
  return key;
}

/**
 * Reads a single workspace file's content from S3.
 */
export async function readWorkspaceFileBlob(contentKey: string): Promise<string> {
  return getText(getClient(), contentKey);
}

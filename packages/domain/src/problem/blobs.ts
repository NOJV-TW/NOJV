import {
  checkerKey,
  createStorageClient,
  deleteBlob,
  deleteBlobsByPrefix,
  getText,
  interactorKey,
  problemPrefix,
  putText,
  testcaseInputFileKey,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
} from "@nojv/storage";

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

export async function writeTestcaseBlobs(input: TestcaseBlobInputs): Promise<TestcaseBlobKeys> {
  const client = getClient();
  const inputKey = testcaseInputKey(input.problemId, input.testcaseId);
  const outputKey =
    input.output === undefined ? null : testcaseOutputKey(input.problemId, input.testcaseId);
  const inputFileKeys =
    input.inputFiles && Object.keys(input.inputFiles).length > 0
      ? Object.fromEntries(
          Object.keys(input.inputFiles).map((name) => [
            name,
            testcaseInputFileKey(input.problemId, input.testcaseId, name),
          ]),
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
    Promise.all(fileEntries.map(([, key]) => getText(client, key))),
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

export async function overwriteTestcaseField(
  problemId: string,
  testcaseId: string,
  field: "input" | "output",
  content: string,
): Promise<void> {
  const key =
    field === "input"
      ? testcaseInputKey(problemId, testcaseId)
      : testcaseOutputKey(problemId, testcaseId);
  await putText(getClient(), key, content);
}

export async function bestEffortDeleteProblemBlobs(problemId: string): Promise<void> {
  try {
    await deleteBlobsByPrefix(getClient(), problemPrefix(problemId));
  } catch (err) {
    console.warn(
      `[problem-blobs] orphan S3 blobs after problem delete: problemId=${problemId}`,
      err,
    );
  }
}

export async function bestEffortDeleteProblemStandardBlobs(problemId: string): Promise<void> {
  const client = getClient();
  const prefixes = [`problems/${problemId}/testcases/`, `problems/${problemId}/workspace/`];
  for (const prefix of prefixes) {
    try {
      await deleteBlobsByPrefix(client, prefix);
    } catch (err) {
      console.warn(
        `[problem-blobs] orphan S3 blobs after standard-mode cleanup: problemId=${problemId} prefix=${prefix}`,
        err,
      );
    }
  }
}

export async function bestEffortDeleteTestcaseBlobs(
  problemId: string,
  testcaseId: string,
): Promise<void> {
  try {
    await deleteBlobsByPrefix(getClient(), `problems/${problemId}/testcases/${testcaseId}/`);
  } catch (err) {
    console.warn(
      `[problem-blobs] orphan S3 blobs after testcase delete: problemId=${problemId} testcaseId=${testcaseId}`,
      err,
    );
  }
}

export async function bestEffortDeleteWorkspaceBlob(
  problemId: string,
  fileId: string,
): Promise<void> {
  try {
    await deleteBlob(getClient(), workspaceFileKey(problemId, fileId));
  } catch (err) {
    console.warn(
      `[problem-blobs] orphan S3 blob after workspace file delete: problemId=${problemId} fileId=${fileId}`,
      err,
    );
  }
}

export async function writeWorkspaceFileBlob(
  problemId: string,
  fileId: string,
  content: string,
): Promise<string> {
  const key = workspaceFileKey(problemId, fileId);
  await putText(getClient(), key, content);
  return key;
}

export async function readWorkspaceFileBlob(contentKey: string): Promise<string> {
  return getText(getClient(), contentKey);
}

export async function readValidatorScriptBlob(key: string): Promise<string> {
  return getText(getClient(), key);
}

export async function writeCheckerScriptBlob(problemId: string, body: string): Promise<string> {
  const key = checkerKey(problemId);
  await putText(getClient(), key, body);
  return key;
}

export async function writeInteractorScriptBlob(
  problemId: string,
  body: string,
): Promise<string> {
  const key = interactorKey(problemId);
  await putText(getClient(), key, body);
  return key;
}

export async function bestEffortDeleteCheckerScriptBlob(problemId: string): Promise<void> {
  try {
    await deleteBlob(getClient(), checkerKey(problemId));
  } catch (err) {
    console.warn(`[problem-blobs] orphan checker script blob: problemId=${problemId}`, err);
  }
}

export async function bestEffortDeleteInteractorScriptBlob(problemId: string): Promise<void> {
  try {
    await deleteBlob(getClient(), interactorKey(problemId));
  } catch (err) {
    console.warn(`[problem-blobs] orphan interactor script blob: problemId=${problemId}`, err);
  }
}

export async function hydrateValidatorScripts(keys: {
  checkerKey?: string | null | undefined;
  interactorKey?: string | null | undefined;
}): Promise<{ checkerScript: string; interactorScript: string }> {
  const client = getClient();
  const [checkerScript, interactorScript] = await Promise.all([
    keys.checkerKey ? getText(client, keys.checkerKey) : Promise.resolve(""),
    keys.interactorKey ? getText(client, keys.interactorKey) : Promise.resolve(""),
  ]);
  return { checkerScript, interactorScript };
}

interface TestcaseRowLike {
  inputKey: string;
  outputKey: string | null;
}

interface TestcaseSetRowLike {
  testcases: readonly TestcaseRowLike[];
}

type HydratedTestcase<T extends TestcaseRowLike> = Omit<T, "inputKey" | "outputKey"> & {
  input: string;
  output: string | null;
};

type HydratedTestcaseSetOf<T extends TestcaseSetRowLike> = Omit<T, "testcases"> & {
  testcases: HydratedTestcase<T["testcases"][number]>[];
};

export async function hydrateTestcaseSets<T extends TestcaseSetRowLike>(
  sets: readonly T[],
): Promise<HydratedTestcaseSetOf<T>[]> {
  const client = getClient();
  return Promise.all(
    sets.map(async (set) => {
      const testcases = await Promise.all(
        set.testcases.map(async (tc) => {
          const [input, output] = await Promise.all([
            getText(client, tc.inputKey),
            tc.outputKey ? getText(client, tc.outputKey) : Promise.resolve(null),
          ]);
          return { ...tc, input, output } as HydratedTestcase<T["testcases"][number]>;
        }),
      );
      return { ...set, testcases };
    }),
  );
}

interface WorkspaceFileRowLike {
  contentKey: string;
}

type HydratedWorkspaceFileOf<T extends WorkspaceFileRowLike> = Omit<T, "contentKey"> & {
  content: string;
};

export async function hydrateWorkspaceFiles<T extends WorkspaceFileRowLike>(
  files: readonly T[],
): Promise<HydratedWorkspaceFileOf<T>[]> {
  const client = getClient();
  return Promise.all(
    files.map(async (f) => {
      const content = await getText(client, f.contentKey);
      return { ...f, content };
    }),
  );
}

import { randomUUID } from "node:crypto";

import {
  assertStorageObjectPointer,
  checkerKey,
  getVerifiedText,
  interactorKey,
  putImmutableText,
  storagePointerFor,
  testcaseInputFileKey,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
  type StorageObjectPointer,
} from "@nojv/storage";

import { storage } from "../shared/storage-singleton";
import { guardStorageObjectWrites } from "../shared/storage-object-lifecycle";

export interface TestcaseBlobInputs {
  problemId: string;
  testcaseId: string;
  input: string;
  output?: string | undefined;
  inputFiles?: Record<string, string> | undefined;
}

export interface TestcaseBlobPointers {
  inputStorage: StorageObjectPointer;
  outputStorage: StorageObjectPointer | null;
  inputFileStorage: Record<string, StorageObjectPointer> | null;
}

export async function writeTestcaseBlobs(
  input: TestcaseBlobInputs,
): Promise<TestcaseBlobPointers> {
  const client = storage();
  const version = randomUUID();
  const [inputStorage, outputStorage, inputFileEntries] = await Promise.all([
    putGuardedImmutableText(
      client,
      testcaseInputKey(input.problemId, input.testcaseId, version),
      input.input,
    ),
    input.output === undefined
      ? Promise.resolve(null)
      : putGuardedImmutableText(
          client,
          testcaseOutputKey(input.problemId, input.testcaseId, version),
          input.output,
        ),
    Promise.all(
      Object.entries(input.inputFiles ?? {}).map(
        async ([name, content]) =>
          [
            name,
            await putGuardedImmutableText(
              client,
              testcaseInputFileKey(input.problemId, input.testcaseId, version, name),
              content,
            ),
          ] as const,
      ),
    ),
  ]);
  return {
    inputStorage,
    outputStorage,
    inputFileStorage:
      inputFileEntries.length === 0 ? null : Object.fromEntries(inputFileEntries),
  };
}

export async function readTestcaseBlobs(row: {
  inputStorage: unknown;
  outputStorage: unknown;
  inputFileStorage: unknown;
}): Promise<{
  input: string;
  output: string | undefined;
  inputFiles: Record<string, string> | undefined;
}> {
  const inputStorage = assertStorageObjectPointer(row.inputStorage);
  const outputStorage =
    row.outputStorage === null ? null : assertStorageObjectPointer(row.outputStorage);
  const inputFileStorage = parsePointerMap(row.inputFileStorage);
  const fileEntries = Object.entries(inputFileStorage ?? {});
  const client = storage();
  const [input, output, files] = await Promise.all([
    getVerifiedText(client, inputStorage),
    outputStorage ? getVerifiedText(client, outputStorage) : Promise.resolve(undefined),
    Promise.all(
      fileEntries.map(
        async ([name, pointer]) => [name, await getVerifiedText(client, pointer)] as const,
      ),
    ),
  ]);
  return {
    input,
    output,
    inputFiles: files.length === 0 ? undefined : Object.fromEntries(files),
  };
}

export async function writeTestcaseField(
  problemId: string,
  testcaseId: string,
  field: "input" | "output",
  content: string,
): Promise<StorageObjectPointer> {
  const version = randomUUID();
  const key =
    field === "input"
      ? testcaseInputKey(problemId, testcaseId, version)
      : testcaseOutputKey(problemId, testcaseId, version);
  return putGuardedImmutableText(storage(), key, content);
}

export async function writeWorkspaceFileBlob(
  problemId: string,
  fileId: string,
  content: string,
): Promise<StorageObjectPointer> {
  return putGuardedImmutableText(
    storage(),
    workspaceFileKey(problemId, fileId, randomUUID()),
    content,
  );
}

export async function readWorkspaceFileBlob(pointer: unknown): Promise<string> {
  return getVerifiedText(storage(), assertStorageObjectPointer(pointer));
}

export async function readValidatorScriptBlob(pointer: unknown): Promise<string> {
  return getVerifiedText(storage(), assertStorageObjectPointer(pointer));
}

export async function writeCheckerScriptBlob(
  problemId: string,
  body: string,
): Promise<StorageObjectPointer> {
  const version = randomUUID();
  return putGuardedImmutableText(storage(), checkerKey(problemId, version), body);
}

export async function writeInteractorScriptBlob(
  problemId: string,
  body: string,
): Promise<StorageObjectPointer> {
  const version = randomUUID();
  return putGuardedImmutableText(storage(), interactorKey(problemId, version), body);
}

async function putGuardedImmutableText(
  client: Parameters<typeof putImmutableText>[0],
  key: string,
  content: string,
): Promise<StorageObjectPointer> {
  const pointer = storagePointerFor(key, Buffer.from(content, "utf8"));
  await guardStorageObjectWrites([pointer]);
  await putImmutableText(client, key, content);
  return pointer;
}

export async function hydrateValidatorScripts(pointers: {
  checkerStorage?: unknown;
  interactorStorage?: unknown;
}): Promise<{ checkerScript: string; interactorScript: string }> {
  const client = storage();
  const [checkerScript, interactorScript] = await Promise.all([
    pointers.checkerStorage
      ? getVerifiedText(client, assertStorageObjectPointer(pointers.checkerStorage))
      : Promise.resolve(""),
    pointers.interactorStorage
      ? getVerifiedText(client, assertStorageObjectPointer(pointers.interactorStorage))
      : Promise.resolve(""),
  ]);
  return { checkerScript, interactorScript };
}

interface TestcaseRowLike {
  inputStorage: unknown;
  outputStorage: unknown;
}

interface TestcaseSetRowLike {
  testcases: readonly TestcaseRowLike[];
}

type SummarizedTestcase<T extends TestcaseRowLike> = Omit<
  T,
  "inputStorage" | "outputStorage"
> & {
  inputSize: number;
  outputSize: number | null;
};

type SummarizedTestcaseSetOf<T extends TestcaseSetRowLike> = Omit<T, "testcases"> & {
  testcases: SummarizedTestcase<T["testcases"][number]>[];
};

export function summarizeTestcaseSets<T extends TestcaseSetRowLike>(
  sets: readonly T[],
): SummarizedTestcaseSetOf<T>[] {
  return sets.map((set) => ({
    ...set,
    testcases: set.testcases.map((tc) => {
      const { inputStorage, outputStorage, ...rest } = tc;
      return {
        ...rest,
        inputSize: assertStorageObjectPointer(inputStorage).size,
        outputSize:
          outputStorage === null ? null : assertStorageObjectPointer(outputStorage).size,
      } as SummarizedTestcase<T["testcases"][number]>;
    }),
  }));
}

interface WorkspaceFileRowLike {
  contentStorage: unknown;
}

type HydratedWorkspaceFileOf<T extends WorkspaceFileRowLike> = Omit<T, "contentStorage"> & {
  content: string;
};

export async function hydrateWorkspaceFiles<T extends WorkspaceFileRowLike>(
  files: readonly T[],
): Promise<HydratedWorkspaceFileOf<T>[]> {
  const client = storage();
  return Promise.all(
    files.map(async (file) => ({
      ...file,
      content: await getVerifiedText(client, assertStorageObjectPointer(file.contentStorage)),
    })),
  );
}

function parsePointerMap(value: unknown): Record<string, StorageObjectPointer> | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Persisted input-file storage pointer map is malformed");
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, pointer]) => [name, assertStorageObjectPointer(pointer)]),
  );
}

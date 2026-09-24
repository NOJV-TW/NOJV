import { assertStorageObjectPointer, type StorageObjectPointer } from "@nojv/storage";

export function optionalPointerSize(value: unknown): number {
  return value === null ? 0 : assertStorageObjectPointer(value).size;
}

export function testcaseStorageSize(testcase: {
  inputStorage: unknown;
  outputStorage: unknown;
  inputFileStorage: unknown;
}): number {
  const files = testcase.inputFileStorage;
  if (files !== null && (!files || typeof files !== "object" || Array.isArray(files))) {
    throw new Error("Persisted testcase input-file storage map is malformed");
  }
  return (
    assertStorageObjectPointer(testcase.inputStorage).size +
    optionalPointerSize(testcase.outputStorage) +
    Object.values((files ?? {}) as Record<string, unknown>).reduce(
      (total: number, pointer) => total + assertStorageObjectPointer(pointer).size,
      0,
    )
  );
}

export function testcaseStoragePointers(testcase: {
  inputStorage: unknown;
  outputStorage: unknown;
  inputFileStorage: unknown;
}): StorageObjectPointer[] {
  const files = testcase.inputFileStorage;
  if (files !== null && (!files || typeof files !== "object" || Array.isArray(files))) {
    throw new Error("Persisted testcase input-file storage map is malformed");
  }
  return [
    assertStorageObjectPointer(testcase.inputStorage),
    ...(testcase.outputStorage === null
      ? []
      : [assertStorageObjectPointer(testcase.outputStorage)]),
    ...Object.values((files ?? {}) as Record<string, unknown>).map(assertStorageObjectPointer),
  ];
}

export function problemStoragePointers(problem: {
  checkerStorage: unknown;
  interactorStorage: unknown;
  workspaceFiles: readonly { contentStorage: unknown }[];
  testcaseSets: readonly {
    testcases: readonly {
      inputStorage: unknown;
      outputStorage: unknown;
      inputFileStorage: unknown;
    }[];
  }[];
}): StorageObjectPointer[] {
  return [
    ...[problem.checkerStorage, problem.interactorStorage]
      .filter((pointer) => pointer !== null)
      .map(assertStorageObjectPointer),
    ...problem.workspaceFiles.map(({ contentStorage }) =>
      assertStorageObjectPointer(contentStorage),
    ),
    ...problem.testcaseSets.flatMap(({ testcases }) =>
      testcases.flatMap(testcaseStoragePointers),
    ),
  ];
}

export { createStorageClient } from "./client";
export {
  StorageIntegrityError,
  assertStorageObjectPointer,
  getVerifiedObject,
  getVerifiedText,
  isStorageObjectNotFoundError,
  putImmutableObject,
  putImmutableText,
  putObjectIfAbsent,
  storagePointerFor,
  type StorageObjectPointer,
} from "./object";
export {
  uploadProblemImage,
  uploadUserContentImage,
  downloadProblemImage,
  downloadRemoteImage,
  downloadUserContentImage,
  cacheRemoteImage,
} from "./images";
export { uploadUserAvatar, downloadUserAvatar, deleteUserAvatar } from "./avatar";
export {
  testcaseInputKey,
  testcaseOutputKey,
  testcaseInputFileKey,
  workspaceFileKey,
  checkerKey,
  interactorKey,
  submissionVerdictDetailKey,
} from "./keys";
export { getText, deleteBlob, deleteBlobsByPrefix, listByPrefix } from "./blobs";
export {
  putSubmissionSources,
  planSubmissionSources,
  putSubmissionSourcePlan,
  getSubmissionSources,
  getSubmissionSourcePointers,
  putVerdictDetail,
  getVerdictDetail,
} from "./submission";
export type { SubmissionSource, SubmissionSourcePlan } from "./submission";
export { getStorageEnv, storageEnvSchema, STORAGE_REQUIRED_IN_PRODUCTION } from "./env";

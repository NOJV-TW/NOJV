export { createStorageClient } from "./client";
export {
  StorageIntegrityError,
  assertStorageObjectPointer,
  getVerifiedObject,
  getVerifiedText,
  isStorageObjectPointer,
  isStorageObjectNotFoundError,
  putImmutableObject,
  putImmutableText,
  putObjectIfAbsent,
  storagePointerFor,
  type PutObjectIfAbsentResult,
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
  problemPrefix,
  submissionPrefix,
  submissionSourceKey,
  submissionSourceManifestKey,
  submissionVerdictDetailKey,
} from "./keys";
export {
  putText,
  getObject,
  getText,
  copyBlob,
  deleteBlob,
  deleteBlobsByPrefix,
  listByPrefix,
  sumSizesByPrefix,
} from "./blobs";
export {
  putSubmissionSources,
  planSubmissionSources,
  putSubmissionSourcePlan,
  getSubmissionSources,
  getSubmissionSourcePointers,
  putVerdictDetail,
  getVerdictDetail,
} from "./submission";
export type {
  SubmissionSource,
  SubmissionSourceManifest,
  SubmissionSourcePlan,
} from "./submission";
export { getStorageEnv, storageEnvSchema, STORAGE_REQUIRED_IN_PRODUCTION } from "./env";

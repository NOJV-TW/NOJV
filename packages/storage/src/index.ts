export { createStorageClient } from "./client";
export {
  uploadProblemImage,
  uploadUserContentImage,
  downloadProblemImage,
  downloadUserContentImage,
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
  submissionSourcePrefix,
  submissionSourceStagingPrefix,
  submissionSourceKey,
  submissionSourceStagingKey,
  submissionVerdictDetailKey,
} from "./keys";
export {
  putText,
  getText,
  copyBlob,
  deleteBlob,
  deleteBlobsByPrefix,
  listByPrefix,
  sumSizesByPrefix,
} from "./blobs";
export {
  putSubmissionSources,
  putSubmissionSourcesStaged,
  promoteSubmissionSources,
  getSubmissionSources,
  putVerdictDetail,
  getVerdictDetail,
  deleteSubmissionStaging,
  deleteSubmissionStorage,
} from "./submission";
export type { SubmissionSource } from "./submission";
export { getStorageEnv, storageEnvSchema, STORAGE_REQUIRED_IN_PRODUCTION } from "./env";

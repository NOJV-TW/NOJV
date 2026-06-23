import { openApiDocument as publicOpenApiDocument } from "./public-document";
import { accountPaths } from "./internal/paths/account";
import { clarificationsPaths } from "./internal/paths/clarifications";
import { contestsPaths } from "./internal/paths/contests";
import { editorialsPaths } from "./internal/paths/editorials";
import { eventsPaths } from "./internal/paths/events";
import { examsPaths } from "./internal/paths/exams";
import { gradingPaths } from "./internal/paths/grading";
import { notificationsPaths } from "./internal/paths/notifications";
import { plagiarismPaths } from "./internal/paths/plagiarism";
import { problemsPaths } from "./internal/paths/problems";
import { rejudgePaths } from "./internal/paths/rejudge";
import { systemPaths } from "./internal/paths/system";
import { uploadsPaths } from "./internal/paths/uploads";
import { withInternalAuthMetadata } from "./internal/auth-metadata";
import { internalSchemas } from "./internal/schemas";

const internalPaths = withInternalAuthMetadata({
  ...systemPaths,
  ...accountPaths,
  ...notificationsPaths,
  ...clarificationsPaths,
  ...editorialsPaths,
  ...plagiarismPaths,
  ...examsPaths,
  ...gradingPaths,
  ...uploadsPaths,
  ...eventsPaths,
  ...problemsPaths,
  ...contestsPaths,
  ...rejudgePaths,
});

export const internalOpenApiDocument = {
  ...publicOpenApiDocument,
  info: {
    ...publicOpenApiDocument.info,
    title: "NOJV Internal API",
    summary: "Internal API reference for NOJV maintainers",
    description:
      "Internal API documentation for NOJV maintainers. This document may include browser-session, admin, teacher, and operational endpoints that are not part of the public external API contract.",
  },
  tags: [
    { name: "System", description: "Health, documentation, and operational metadata." },
    { name: "Account", description: "User account settings APIs." },
    {
      name: "Problems Management",
      description: "Problem authoring and asset management APIs.",
    },
    {
      name: "Submissions",
      description: "Submission creation, status, source, and live update APIs.",
    },
    { name: "Rejudge", description: "Single-submission and batch rejudge APIs." },
    { name: "Contests", description: "Contest scoreboard and chart APIs." },
    {
      name: "Exams / Proctoring",
      description: "Exam session, heartbeat, and IP violation APIs.",
    },
    {
      name: "Clarifications",
      description: "Clarification board APIs for contests, exams, and assignments.",
    },
    { name: "Notifications", description: "Notification center APIs." },
    { name: "Editorials", description: "Editorial, report, and vote APIs." },
    { name: "Plagiarism", description: "Plagiarism report and flag APIs." },
    { name: "Grading", description: "Score override and grading feedback APIs." },
    { name: "Uploads", description: "Shared upload APIs." },
    { name: "Events", description: "Server-sent event APIs." },
  ],
  paths: {
    ...publicOpenApiDocument.paths,
    ...internalPaths,
  },
  components: {
    ...publicOpenApiDocument.components,
    schemas: {
      ...publicOpenApiDocument.components.schemas,
      ...internalSchemas,
    },
  },
} as const;

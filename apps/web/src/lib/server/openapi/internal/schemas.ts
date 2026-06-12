import {
  contestScoringModeSchema,
  editorialSubmitSchema,
  editorialUpdateSchema,
  editorialVoteSchema,
  feedbackUpsertSchema,
  ipViolationTypeSchema,
  scoreboardModeSchema,
} from "@nojv/core";
import { z } from "zod";

import { zodToOpenApiSchema } from "../zod-schema";

const feedbackContextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assignment"), assignmentId: z.string().min(1) }),
  z.object({ type: z.literal("exam"), examId: z.string().min(1) }),
]);

const upsertGradingFeedbackRequestSchema = z.object({
  context: feedbackContextSchema,
  ...feedbackUpsertSchema.shape,
});

export const internalSchemas = {
  HealthCheckStatus: {
    type: "string",
    description: "Subsystem health status.",
    enum: ["ok", "error"],
  },
  AdminHealthResponse: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["healthy", "unhealthy"],
      },
      checks: {
        type: "object",
        properties: {
          postgres: {
            $ref: "#/components/schemas/HealthCheckStatus",
          },
          redis: {
            $ref: "#/components/schemas/HealthCheckStatus",
          },
          temporal: {
            $ref: "#/components/schemas/HealthCheckStatus",
          },
        },
        required: ["postgres", "redis", "temporal"],
      },
    },
    required: ["status", "checks"],
  },
  AccountAvatarUploadResponse: {
    type: "object",
    properties: {
      image: {
        type: "string",
        description: "URL of the uploaded avatar image.",
      },
    },
    required: ["image"],
  },
  NotificationItem: {
    type: "object",
    additionalProperties: true,
    description: "Notification item returned by the domain layer.",
  },
  NotificationListResponse: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          $ref: "#/components/schemas/NotificationItem",
        },
      },
      unreadCount: {
        type: "integer",
        minimum: 0,
      },
    },
    required: ["items", "unreadCount"],
  },
  UnreadNotificationCountResponse: {
    type: "object",
    properties: {
      count: {
        type: "integer",
        minimum: 0,
      },
    },
    required: ["count"],
  },
  MarkAllNotificationsReadRequest: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["markAllRead"],
      },
    },
    required: ["action"],
  },
  MarkNotificationReadRequest: {
    type: "object",
    properties: {
      read: {
        type: "boolean",
        enum: [true],
      },
    },
    required: ["read"],
  },
  UpdatedCountResponse: {
    type: "object",
    properties: {
      updated: {
        type: "integer",
        minimum: 0,
      },
    },
    required: ["updated"],
  },
  ClarificationContext: {
    oneOf: [
      {
        type: "object",
        properties: {
          type: { type: "string", enum: ["assignment"] },
          assignmentId: { type: "string" },
        },
        required: ["type", "assignmentId"],
      },
      {
        type: "object",
        properties: {
          type: { type: "string", enum: ["exam"] },
          examId: { type: "string" },
        },
        required: ["type", "examId"],
      },
      {
        type: "object",
        properties: {
          type: { type: "string", enum: ["contest"] },
          contestId: { type: "string" },
        },
        required: ["type", "contestId"],
      },
    ],
  },
  ClarificationItem: {
    type: "object",
    additionalProperties: true,
    description: "Clarification row projected for the current viewer.",
  },
  ClarificationListResponse: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          $ref: "#/components/schemas/ClarificationItem",
        },
      },
    },
    required: ["items"],
  },
  CreateClarificationRequest: {
    type: "object",
    properties: {
      context: {
        $ref: "#/components/schemas/ClarificationContext",
      },
      problemId: {
        oneOf: [{ type: "string" }, { type: "null" }],
      },
      questionText: {
        type: "string",
        minLength: 10,
        maxLength: 1000,
      },
    },
    required: ["context", "questionText"],
  },
  PatchClarificationRequest: {
    oneOf: [
      {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["answer"] },
          answerText: {
            type: "string",
            minLength: 1,
            maxLength: 1000,
          },
        },
        required: ["kind", "answerText"],
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["dismiss"] },
        },
        required: ["kind"],
      },
    ],
  },
  CannedClarificationReplyRequest: {
    type: "object",
    properties: {
      templateKey: {
        type: "string",
        enum: ["noComment", "readProblem", "yes", "no"],
      },
    },
    required: ["templateKey"],
  },
  EditorialItem: {
    type: "object",
    additionalProperties: true,
    description:
      "Editorial row returned by the domain layer, including voteScore and viewerVote where available.",
  },
  EditorialSubmitRequest: {
    ...zodToOpenApiSchema(editorialSubmitSchema),
  },
  EditorialUpdateRequest: {
    ...zodToOpenApiSchema(editorialUpdateSchema),
    description:
      "At least one field is required. The current route validates title, content, and language; content and language are persisted by the current handler.",
  },
  EditorialReportRequest: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        minLength: 1,
        maxLength: 1000,
      },
    },
    required: ["reason"],
  },
  EditorialReportItem: {
    type: "object",
    additionalProperties: true,
    description: "Editorial report row returned by the domain layer.",
  },
  EditorialVoteRequest: {
    ...zodToOpenApiSchema(editorialVoteSchema),
    description: "value=1 upvotes, value=-1 downvotes, and value=0 clears the vote.",
  },
  EditorialVoteResponse: {
    type: "object",
    properties: {
      score: {
        type: "integer",
      },
      viewerVote: {
        type: "integer",
        enum: [1, -1, 0],
      },
    },
    required: ["score", "viewerVote"],
  },
  PlagiarismReportItem: {
    type: "object",
    additionalProperties: true,
    description: "Plagiarism report summary returned by the domain layer.",
  },
  PlagiarismReportListResponse: {
    type: "object",
    properties: {
      reports: {
        type: "array",
        items: { $ref: "#/components/schemas/PlagiarismReportItem" },
      },
    },
    required: ["reports"],
  },
  CreatePlagiarismReportResponse: {
    type: "object",
    properties: {
      targetId: {
        type: "string",
      },
      status: {
        type: "string",
        enum: ["pending"],
      },
    },
    required: ["targetId", "status"],
  },
  PlagiarismSourceFile: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  PlagiarismSourceResponse: {
    type: "object",
    properties: {
      files: {
        oneOf: [
          {
            type: "array",
            items: { $ref: "#/components/schemas/PlagiarismSourceFile" },
          },
          { type: "null" },
        ],
      },
    },
    required: ["files"],
  },
  CreatePlagiarismFlagRequest: {
    type: "object",
    properties: {
      contextType: {
        type: "string",
        enum: ["assessment", "exam", "contest"],
      },
      contextId: {
        type: "string",
        minLength: 1,
      },
      problemId: {
        type: "string",
        minLength: 1,
      },
      userAId: {
        type: "string",
        minLength: 1,
      },
      userBId: {
        type: "string",
        minLength: 1,
      },
      note: {
        oneOf: [{ type: "string", maxLength: 2000 }, { type: "null" }],
      },
    },
    required: ["contextType", "contextId", "problemId", "userAId", "userBId"],
  },
  PlagiarismFlagItem: {
    type: "object",
    additionalProperties: true,
    description: "Plagiarism flag row returned by the domain layer.",
  },
  CreatePlagiarismFlagResponse: {
    type: "object",
    properties: {
      flag: {
        $ref: "#/components/schemas/PlagiarismFlagItem",
      },
    },
    required: ["flag"],
  },
  ExamIpViolationUser: {
    type: "object",
    properties: {
      displayUsername: {
        oneOf: [{ type: "string" }, { type: "null" }],
      },
      email: {
        oneOf: [{ type: "string" }, { type: "null" }],
      },
      name: {
        type: "string",
      },
    },
    required: ["displayUsername", "email", "name"],
  },
  ExamIpViolationItem: {
    type: "object",
    properties: {
      id: { type: "string" },
      userId: { type: "string" },
      examId: { type: "string" },
      expectedIp: {
        oneOf: [{ type: "string" }, { type: "null" }],
      },
      actualIp: { type: "string" },
      violationType: {
        ...zodToOpenApiSchema(ipViolationTypeSchema),
      },
      createdAt: { type: "string", format: "date-time" },
      user: { $ref: "#/components/schemas/ExamIpViolationUser" },
    },
    required: [
      "id",
      "userId",
      "examId",
      "expectedIp",
      "actualIp",
      "violationType",
      "createdAt",
      "user",
    ],
  },
  ExamIpViolationListResponse: {
    type: "object",
    properties: {
      violations: {
        type: "array",
        items: { $ref: "#/components/schemas/ExamIpViolationItem" },
      },
    },
    required: ["violations"],
  },
  FeedbackContext: {
    ...zodToOpenApiSchema(feedbackContextSchema),
  },
  GradingFeedbackItem: {
    type: "object",
    additionalProperties: true,
    description: "Submission feedback row returned by the domain layer.",
  },
  GradingFeedbackListResponse: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: { $ref: "#/components/schemas/GradingFeedbackItem" },
      },
    },
    required: ["items"],
  },
  UpsertGradingFeedbackRequest: {
    ...zodToOpenApiSchema(upsertGradingFeedbackRequestSchema),
  },
  ScoreOverrideContext: {
    oneOf: [
      {
        type: "object",
        properties: {
          type: { type: "string", enum: ["assignment"] },
          assignmentId: { type: "string", minLength: 1 },
        },
        required: ["type", "assignmentId"],
      },
      {
        type: "object",
        properties: {
          type: { type: "string", enum: ["exam"] },
          examId: { type: "string", minLength: 1 },
        },
        required: ["type", "examId"],
      },
      {
        type: "object",
        properties: {
          type: { type: "string", enum: ["contest"] },
          contestId: { type: "string", minLength: 1 },
        },
        required: ["type", "contestId"],
      },
    ],
  },
  ScoreOverrideItem: {
    type: "object",
    additionalProperties: true,
    description: "Score override row returned by the domain layer.",
  },
  ScoreOverrideListResponse: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: { $ref: "#/components/schemas/ScoreOverrideItem" },
      },
    },
    required: ["items"],
  },
  CreateScoreOverrideRequest: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        minLength: 1,
      },
      problemId: {
        type: "string",
        minLength: 1,
      },
      context: {
        $ref: "#/components/schemas/ScoreOverrideContext",
      },
      overrideScore: {
        type: "integer",
        minimum: 0,
      },
      reason: {
        type: "string",
        minLength: 1,
        maxLength: 500,
      },
    },
    required: ["userId", "problemId", "context", "overrideScore", "reason"],
  },
  PatchScoreOverrideRequest: {
    type: "object",
    properties: {
      overrideScore: {
        type: "integer",
        minimum: 0,
      },
      reason: {
        type: "string",
        minLength: 1,
        maxLength: 500,
      },
    },
    description: "At least one of overrideScore or reason should be provided.",
  },
  UserContentImageUploadResponse: {
    type: "object",
    properties: {
      url: {
        type: "string",
      },
    },
    required: ["url"],
  },
  CreateProblemRequest: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["standard", "advanced"],
        description: "Optional creation mode. Defaults to standard.",
      },
    },
  },

  CreateProblemResponse: {
    type: "object",
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["standard", "advanced"] },
    },
    required: ["id", "mode"],
  },

  BookmarkToggleResponse: {
    type: "object",
    additionalProperties: true,
    description: "Bookmark toggle result returned by the domain layer.",
  },

  StorageUsageResponse: {
    type: "object",
    additionalProperties: true,
    description: "Problem storage usage summary returned by the domain layer.",
  },

  ProblemImageUploadResponse: {
    type: "object",
    properties: {
      url: { type: "string" },
    },
    required: ["url"],
  },

  AdvancedImageUploadResponse: {
    type: "object",
    properties: {
      key: { type: "string" },
    },
    required: ["key"],
  },
  ProblemScore: {
    type: "object",
    properties: {
      problemId: { type: "string" },
      score: { type: "integer" },
      attempts: { type: "integer", minimum: 0 },
      firstAcTime: {
        oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
      },
      isFrozen: { type: "boolean" },
      isPending: { type: "boolean" },
    },
    required: ["problemId", "score", "attempts", "firstAcTime", "isFrozen", "isPending"],
  },
  ScoreboardProblem: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      ordinal: { type: "integer" },
      points: { type: "integer" },
    },
    required: ["id", "title", "ordinal", "points"],
  },
  ScoreboardEntry: {
    type: "object",
    properties: {
      rank: { type: "integer" },
      userId: { type: "string" },
      username: { type: "string" },
      displayName: { type: "string" },
      totalScore: { type: "integer" },
      totalPenalty: { type: "integer" },
      problems: {
        type: "array",
        items: { $ref: "#/components/schemas/ProblemScore" },
      },
      isFirstBlood: {
        type: "array",
        items: { type: "boolean" },
      },
    },
    required: [
      "rank",
      "userId",
      "username",
      "displayName",
      "totalScore",
      "totalPenalty",
      "problems",
      "isFirstBlood",
    ],
  },
  ContestScoreboardResponse: {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: { $ref: "#/components/schemas/ScoreboardEntry" },
      },
      problems: {
        type: "array",
        items: { $ref: "#/components/schemas/ScoreboardProblem" },
      },
      scoringMode: {
        ...zodToOpenApiSchema(contestScoringModeSchema),
      },
      scoreboardMode: {
        ...zodToOpenApiSchema(scoreboardModeSchema),
      },
      frozenAt: {
        oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
      },
      isFrozen: { type: "boolean" },
    },
    required: ["entries", "problems", "scoringMode", "scoreboardMode", "frozenAt", "isFrozen"],
  },
  ScoreboardChartResponse: {
    type: "object",
    properties: {
      series: {
        type: "array",
        items: {
          type: "object",
          properties: {
            userId: { type: "string" },
            username: { type: "string" },
            points: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  time: { type: "integer", minimum: 0 },
                  score: { type: "integer" },
                },
                required: ["time", "score"],
              },
            },
          },
          required: ["userId", "username", "points"],
        },
      },
    },
    required: ["series"],
  },
  CreateRejudgeRequest: {
    type: "object",
    properties: {
      problemId: { type: "string", minLength: 1 },
      contestId: { type: "string" },
      assessmentId: { type: "string" },
      examId: { type: "string" },
      userIds: {
        type: "array",
        items: { type: "string" },
      },
      since: { type: "string", format: "date-time" },
      until: { type: "string", format: "date-time" },
    },
    required: ["problemId"],
  },
  CreateRejudgeResponse: {
    type: "object",
    properties: {
      workflowId: { type: "string" },
      status: { type: "string", enum: ["queued"] },
    },
    required: ["workflowId", "status"],
  },
} as const;

import {
  apiErrorSchema,
  languageSchema,
  runCaseSchema,
  submissionDispatchResponseSchema,
  submissionDraftSchema,
  submissionOperationSchema,
  submissionOperationStatusSchema,
  submissionResultSchema,
} from "@nojv/core";

import { zodToOpenApiSchema } from "./zod-schema";

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "NOJV API",
    version: "0.1.0",
    summary: "Hand-written base API reference merged into the Full API document",
    description:
      "Base API documentation for system and submission routes. Served to readers through the API Token and Full API documents.",
    contact: {
      name: "NOJV Maintainers",
    },
    license: {
      name: "Private",
    },
  },
  servers: [
    {
      url: "http://localhost:5173",
      description: "Local development",
    },
  ],
  tags: [
    {
      name: "System",
      description: "Health and API metadata.",
    },
    {
      name: "Submissions",
      description: "Submission creation, status, verdicts, and source access.",
    },
  ],
  paths: {
    "/api/healthz": {
      get: {
        tags: ["System"],
        summary: "Check service health",
        operationId: "getHealth",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/HealthResponse",
                },
                example: {
                  ok: true,
                  checks: { postgres: "ok", redis: "ok", temporal: "ok" },
                },
              },
            },
          },
          "503": {
            description: "Service is unhealthy",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/HealthResponse",
                },
                example: {
                  ok: false,
                  checks: { postgres: "ok", redis: "error: timeout", temporal: "ok" },
                },
              },
            },
          },
        },
      },
    },
    "/api/openapi.public.json": {
      get: {
        tags: ["System"],
        summary: "Get the API Token OpenAPI document",
        operationId: "getOpenApiDocument",
        responses: {
          "200": {
            description: "OpenAPI document for the API routes callable with personal API tokens",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                },
              },
            },
          },
        },
      },
    },
    "/api/submissions": {
      get: {
        tags: ["Submissions"],
        summary: "List own submissions",
        operationId: "listSubmissions",
        description:
          "Returns a cursor-paginated list of the caller's own submissions, newest first. Supports Bearer API token auth when the token has the submissions:read scope.",
        security: [{ ApiToken: [] }],
        parameters: [
          {
            name: "cursor",
            in: "query",
            required: false,
            description:
              "Submission ID to continue from, taken from nextCursor of the previous page.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Page of the caller's submissions",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SubmissionListResponse",
                },
              },
            },
          },
          "401": {
            description: "Authentication required",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Submissions"],
        summary: "Create a submission",
        operationId: "createSubmission",
        description:
          "Creates a queued submission and dispatches it to the judge. Supports Bearer API token auth when the token has the submissions:write scope. Browser-session callers continue to use the existing X-Requested-With: fetch protection.",
        security: [{ ApiToken: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SubmissionDraft",
              },
              examples: {
                practicePython: {
                  summary: "Practice Python submission",
                  value: {
                    problemId: "problem_noisy-oracle-hunt",
                    language: "python",
                    sourceCode: "print('hello')",
                  },
                },
                sampleRun: {
                  summary: "Sample-only run with custom input",
                  value: {
                    problemId: "problem_noisy-oracle-hunt",
                    language: "python",
                    sampleOnly: true,
                    runCases: [
                      {
                        input: "1 2\n",
                        expectedOutput: "3\n",
                      },
                    ],
                    sourceCode: "print(sum(map(int, input().split())))",
                  },
                },
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Submission queued",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CreateSubmissionResponse",
                },
              },
            },
          },
          "400": {
            description: "Invalid request body",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ValidationErrorResponse",
                },
              },
            },
          },
          "401": {
            description: "Authentication required",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
          "403": {
            description: "Profile incomplete, CSRF header missing, or access denied",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
          "429": {
            description: "Rate limit exceeded",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/api/submissions/{id}": {
      get: {
        tags: ["Submissions"],
        summary: "Get submission status and result",
        operationId: "getSubmission",
        description:
          "Returns the current status and judge result for a submission. Supports Bearer API token auth when the token has the submissions:read scope. Users can access their own submissions; elevated admin sessions can access all submissions, while API tokens always act with the owner's base role.",
        security: [{ ApiToken: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Submission ID.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Submission status and judge result",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SubmissionOperationResponse",
                },
              },
            },
          },
          "401": {
            description: "Authentication required",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
          "403": {
            description: "Access denied",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
          "404": {
            description: "Submission not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/api/submissions/{id}/source": {
      get: {
        tags: ["Submissions"],
        summary: "Get submission source files",
        operationId: "getSubmissionSource",
        description:
          "Returns submitted source files. Supports Bearer API token auth when the token has the submissions:read scope. Users can access their own submissions; elevated admin sessions can access all submissions, while API tokens always act with the owner's base role.",
        security: [{ ApiToken: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Submission ID.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Submission source files",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SubmissionSourceResponse",
                },
              },
            },
          },
          "401": {
            description: "Authentication required",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
          "403": {
            description: "Access denied",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
          "404": {
            description: "Submission not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiToken: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "NOJV API token",
      },
    },
    schemas: {
      HealthResponse: {
        type: "object",
        properties: {
          ok: {
            type: "boolean",
            description:
              "True when the web-critical dependencies (PostgreSQL + Redis) are reachable. Temporal is surfaced under `checks` for observability but does not gate this flag.",
          },
          checks: {
            type: "object",
            properties: {
              postgres: { type: "string" },
              redis: { type: "string" },
              temporal: { type: "string" },
            },
            required: ["postgres", "redis", "temporal"],
          },
        },
        required: ["ok", "checks"],
      },
      SupportedLanguage: {
        ...zodToOpenApiSchema(languageSchema),
      },
      RunCase: {
        ...zodToOpenApiSchema(runCaseSchema),
      },
      SourceFile: {
        type: "object",
        properties: {
          path: {
            type: "string",
            minLength: 1,
            maxLength: 300,
            description: "Workspace-relative file path. NUL bytes are not allowed.",
          },
          content: {
            type: "string",
            maxLength: 500000,
          },
        },
        required: ["path", "content"],
      },
      SubmissionDraft: {
        ...zodToOpenApiSchema(submissionDraftSchema),
      },
      CreateSubmissionResponse: {
        ...zodToOpenApiSchema(submissionDispatchResponseSchema),
      },
      SubmissionStatus: {
        ...zodToOpenApiSchema(submissionOperationStatusSchema),
        description: "Submission operation status.",
      },
      SubmissionVerdict: {
        type: "string",
        description: "Final judge verdict for a completed submission.",
      },
      SubmissionResult: {
        ...zodToOpenApiSchema(submissionResultSchema),
      },
      SubmissionOperationResponse: {
        ...zodToOpenApiSchema(submissionOperationSchema),
      },
      SubmissionListItem: {
        type: "object",
        properties: {
          id: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          language: { $ref: "#/components/schemas/SupportedLanguage" },
          problemId: { type: "string" },
          problemTitle: { type: "string" },
          runtimeMs: { oneOf: [{ type: "integer" }, { type: "null" }] },
          memoryKb: { oneOf: [{ type: "integer" }, { type: "null" }] },
          score: { type: "integer" },
          totalScore: { type: "integer" },
          status: { $ref: "#/components/schemas/SubmissionStatus" },
          context: {
            type: "string",
            description: "Submission context kind (e.g. practice, assignment, exam, contest).",
          },
        },
        required: [
          "id",
          "createdAt",
          "language",
          "problemId",
          "problemTitle",
          "runtimeMs",
          "memoryKb",
          "score",
          "totalScore",
          "status",
          "context",
        ],
      },
      SubmissionListResponse: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SubmissionListItem",
            },
          },
          nextCursor: {
            oneOf: [{ type: "string" }, { type: "null" }],
          },
        },
        required: ["items", "nextCursor"],
      },
      SubmissionSourceFile: {
        type: "object",
        properties: {
          path: {
            type: "string",
          },
          content: {
            type: "string",
          },
        },
        required: ["path", "content"],
      },
      SubmissionSourceResponse: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SubmissionSourceFile",
            },
          },
          language: {
            $ref: "#/components/schemas/SupportedLanguage",
          },
        },
        required: ["files", "language"],
      },
      ErrorResponse: {
        ...zodToOpenApiSchema(apiErrorSchema),
      },
      ValidationErrorResponse: {
        type: "object",
        properties: {
          message: {
            type: "string",
          },
          issues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
        required: ["message", "issues"],
      },
    },
  },
} as const;

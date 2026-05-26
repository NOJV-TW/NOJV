export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "NOJV Public API",
    version: "0.1.0",
    summary: "Stable API surface for external NOJV clients",
    description:
      "The NOJV Public API is intended for external student clients, scripts, and integrations. Only endpoints listed in this document are considered public contract. Internal web APIs may change without notice.",
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
      description: "Health and platform metadata.",
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
              },
            },
          },
        },
      },
    },
    "/api/openapi.json": {
      get: {
        tags: ["System"],
        summary: "Get the OpenAPI document",
        operationId: "getOpenApiDocument",
        responses: {
          "200": {
            description: "OpenAPI document for the public NOJV API",
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
      post: {
        tags: ["Submissions"],
        summary: "Create a submission",
        operationId: "createSubmission",
        description:
          "Creates a queued submission and dispatches it to the judge. This endpoint currently requires a logged-in browser session and the X-Requested-With: fetch header. Bearer token auth will be added in the API token phase.",
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
          "Returns the current status and judge result for a submission. Users can access their own submissions; admins can access all submissions.",
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
          "400": {
            description: "Missing or invalid submission ID",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
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
        summary: "Get submission source code",
        operationId: "getSubmissionSource",
        description:
          "Returns the submitted source code. Users can access their own submissions; admins can access all submissions.",
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
            description: "Submission source code",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SubmissionSourceResponse",
                },
              },
            },
          },
          "400": {
            description: "Missing or invalid submission ID",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
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
          },
        },
        required: ["ok"],
      },
      SupportedLanguage: {
        type: "string",
        enum: ["c", "cpp", "go", "java", "javascript", "python", "rust", "typescript"],
      },
      RunCase: {
        type: "object",
        properties: {
          input: {
            type: "string",
            maxLength: 200000,
          },
          expectedOutput: {
            type: "string",
            maxLength: 200000,
          },
        },
        required: ["input"],
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
        type: "object",
        properties: {
          assessment: {
            type: "object",
            additionalProperties: true,
            description: "Assessment context for course assignment submissions.",
          },
          contestId: {
            type: "string",
            description: "Contest identifier when submitting inside a contest.",
          },
          virtualContestId: {
            type: "string",
            description: "Virtual contest identifier for time-shifted contest replay.",
          },
          language: {
            $ref: "#/components/schemas/SupportedLanguage",
          },
          mode: {
            type: "string",
            description: "Optional submission mode hint.",
          },
          problemId: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9_-]+$",
            description:
              'Problem identifier. Accepts values such as "problem_noisy-oracle-hunt".',
          },
          runCases: {
            type: "array",
            maxItems: 10,
            items: {
              $ref: "#/components/schemas/RunCase",
            },
            description: "Only allowed when sampleOnly is true.",
          },
          sampleOnly: {
            type: "boolean",
            description: "True for sample/run submissions that are not graded.",
          },
          sourceCode: {
            type: "string",
            minLength: 1,
            maxLength: 50000,
          },
          sourceFiles: {
            type: "array",
            maxItems: 200,
            items: {
              $ref: "#/components/schemas/SourceFile",
            },
          },
        },
        required: ["language", "problemId", "sourceCode"],
      },
      CreateSubmissionResponse: {
        type: "object",
        properties: {
          pollUrl: {
            type: "string",
            example: "/api/submissions/clx123",
          },
          status: {
            $ref: "#/components/schemas/SubmissionStatus",
          },
          submissionId: {
            type: "string",
          },
        },
        required: ["pollUrl", "status", "submissionId"],
      },
      SubmissionStatus: {
        type: "string",
        description: "Submission operation status.",
        enum: [
          "queued",
          "compiling",
          "running",
          "accepted",
          "wrong_answer",
          "time_limit_exceeded",
          "memory_limit_exceeded",
          "runtime_error",
          "compile_error",
        ],
      },
      SubmissionVerdict: {
        type: "string",
        description: "Final judge verdict for a completed submission.",
      },
      SubmissionResult: {
        type: "object",
        properties: {
          accepted: {
            type: "boolean",
          },
          feedback: {
            type: "string",
          },
          runtimeMs: {
            type: "integer",
            minimum: 0,
          },
          memoryKb: {
            type: "integer",
            minimum: 0,
          },
          score: {
            type: "integer",
            minimum: 0,
            maximum: 100,
          },
          verdict: {
            $ref: "#/components/schemas/SubmissionVerdict",
          },
          caseResults: {
            type: "array",
            description: "Per-testcase result details when available.",
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
          subtaskResults: {
            type: "array",
            description: "Per-subtask result details when available.",
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
        required: ["accepted", "feedback", "runtimeMs", "score", "verdict"],
      },
      SubmissionOperationResponse: {
        type: "object",
        properties: {
          result: {
            oneOf: [{ $ref: "#/components/schemas/SubmissionResult" }, { type: "null" }],
            description: "Null while the submission is queued or still running.",
          },
          status: {
            $ref: "#/components/schemas/SubmissionStatus",
          },
          submissionId: {
            type: "string",
          },
        },
        required: ["result", "status", "submissionId"],
      },
      SubmissionSourceResponse: {
        type: "object",
        properties: {
          sourceCode: {
            type: "string",
          },
        },
        required: ["sourceCode"],
      },
      ErrorResponse: {
        type: "object",
        properties: {
          message: {
            type: "string",
          },
        },
        required: ["message"],
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
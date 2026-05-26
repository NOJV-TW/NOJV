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
      name: "Problems",
      description: "Problem discovery and problem detail endpoints.",
    },
    {
      name: "Submissions",
      description: "Submission creation, status, verdicts, and source access.",
    },
  ],
  paths: {
    "/api/v1/healthz": {
      get: {
        tags: ["System"],
        summary: "Check service health",
        operationId: "getPublicApiHealth",
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
    "/api/v1/problems": {
      get: {
        tags: ["Problems"],
        summary: "List public problems",
        operationId: "listProblems",
        description:
          "Lists published public problems. This endpoint is read-only and does not require authentication in the initial public API version.",
        parameters: [
          {
            name: "q",
            in: "query",
            required: false,
            description: "Search query.",
            schema: {
              type: "string",
            },
          },
          {
            name: "difficulty",
            in: "query",
            required: false,
            description: "Difficulty filter.",
            schema: {
              type: "string",
              enum: ["all", "easy", "medium", "hard"],
            },
          },
          {
            name: "tags",
            in: "query",
            required: false,
            description: "Comma-separated tag list. All listed tags must match.",
            schema: {
              type: "string",
            },
          },
          {
            name: "page",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              default: 1,
            },
          },
          {
            name: "sort",
            in: "query",
            required: false,
            description: "Sort by problem display order.",
            schema: {
              type: "string",
              enum: ["asc", "desc"],
              default: "asc",
            },
          },
        ],
        responses: {
          "200": {
            description: "Public problem list",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ProblemListResponse",
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
    "/api/v1/problems/{problemId}": {
      get: {
        tags: ["Problems"],
        summary: "Get public problem detail",
        operationId: "getProblem",
        description:
          "Returns public problem detail, samples, starter code, and testcase set summaries. Hidden testcase input/output and private judge assets are never included.",
        parameters: [
          {
            name: "problemId",
            in: "path",
            required: true,
            description: "Problem ID.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Public problem detail",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ProblemDetailResponse",
                },
              },
            },
          },
          "404": {
            description: "Problem not found or not public",
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
    "/api/v1/submissions": {
      post: {
        tags: ["Submissions"],
        summary: "Create a submission",
        operationId: "createSubmission",
        description:
          "Creates a queued submission and dispatches it to the judge. This v1 endpoint currently uses the same logged-in browser session gate as the web app. Bearer token auth and scopes will replace this before external token access is enabled.",
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
    "/api/v1/submissions/{id}": {
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
    "/api/v1/submissions/{id}/source": {
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
      ApiToken: [],
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
      ProblemDifficulty: {
        type: "string",
        enum: ["easy", "medium", "hard"],
      },
      ProblemType: {
        type: "string",
        enum: ["full_source", "multi_file", "special_env"],
      },
      ProblemUserStatus: {
        oneOf: [{ type: "string", enum: ["ac", "attempted"] }, { type: "null" }],
      },
      ProblemCard: {
        type: "object",
        properties: {
          acceptanceRate: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
          difficulty: {
            $ref: "#/components/schemas/ProblemDifficulty",
          },
          displayId: {
            type: "integer",
          },
          id: {
            type: "string",
          },
          judgeType: {
            type: "string",
          },
          type: {
            $ref: "#/components/schemas/ProblemType",
          },
          status: {
            $ref: "#/components/schemas/ProblemUserStatus",
          },
          tags: {
            type: "array",
            items: {
              type: "string",
            },
          },
          title: {
            type: "string",
          },
          totalSubmissions: {
            type: "integer",
            minimum: 0,
          },
        },
        required: [
          "acceptanceRate",
          "difficulty",
          "displayId",
          "id",
          "judgeType",
          "type",
          "status",
          "tags",
          "title",
          "totalSubmissions",
        ],
      },
      ProblemListResponse: {
        type: "object",
        properties: {
          page: {
            type: "integer",
            minimum: 1,
          },
          pageSize: {
            type: "integer",
            minimum: 1,
            maximum: 100,
          },
          problems: {
            type: "array",
            items: {
              $ref: "#/components/schemas/ProblemCard",
            },
          },
          totalCount: {
            type: "integer",
            minimum: 0,
          },
        },
        required: ["page", "pageSize", "problems", "totalCount"],
      },
      ProblemSample: {
        type: "object",
        properties: {
          input: { type: "string" },
          output: { type: "string" },
        },
        required: ["input", "output"],
      },
      TestcaseSetSummary: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          weight: { type: "integer", minimum: 1 },
          ordinal: { type: "integer" },
          caseCount: { type: "integer", minimum: 0 },
        },
        required: ["id", "name", "description", "weight", "ordinal", "caseCount"],
      },
      ProblemDetail: {
        type: "object",
        properties: {
          id: { type: "string" },
          displayId: { type: "integer" },
          title: { type: "string" },
          statement: { type: "string" },
          inputFormat: { type: "string" },
          outputFormat: { type: "string" },
          difficulty: { $ref: "#/components/schemas/ProblemDifficulty" },
          tags: { type: "array", items: { type: "string" } },
          type: { $ref: "#/components/schemas/ProblemType" },
          judgeType: { type: "string" },
          timeLimitMs: { type: "integer", minimum: 1 },
          memoryLimitMb: { type: "integer", minimum: 1 },
          samples: {
            type: "array",
            items: { $ref: "#/components/schemas/ProblemSample" },
          },
          starterByLanguage: {
            type: "object",
            additionalProperties: { type: "string" },
          },
          acceptanceRate: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
          totalSubmissions: {
            type: "integer",
            minimum: 0,
          },
        },
        required: [
          "id",
          "displayId",
          "title",
          "statement",
          "inputFormat",
          "outputFormat",
          "difficulty",
          "tags",
          "type",
          "judgeType",
          "timeLimitMs",
          "memoryLimitMb",
          "samples",
          "starterByLanguage",
          "acceptanceRate",
          "totalSubmissions",
        ],
      },
      ProblemDetailResponse: {
        type: "object",
        properties: {
          problem: {
            $ref: "#/components/schemas/ProblemDetail",
          },
          testcaseSets: {
            type: "array",
            items: { $ref: "#/components/schemas/TestcaseSetSummary" },
          },
        },
        required: ["problem", "testcaseSets"],
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
            example: "/api/v1/submissions/clx123",
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
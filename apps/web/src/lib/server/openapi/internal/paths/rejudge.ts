export const rejudgePaths = {
  "/api/submissions/{id}/rejudge": {
    post: {
      tags: ["Rejudge"],
      summary: "Rejudge a single submission",
      operationId: "rejudgeSubmission",
      description:
        "Queues a rejudge for one submission. Requires the caller to have rejudge permission for the submission's context (problem author for practice, teacher/TA for coursework, organizer for contests, or admin).",
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
        "202": {
          description: "Rejudge queued",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateRejudgeResponse" },
            },
          },
        },
        "400": {
          description: "Missing submission id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Not permitted to rejudge this submission",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Submission not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/rejudges": {
    post: {
      tags: ["Rejudge"],
      summary: "Create a batch rejudge",
      operationId: "createBatchRejudge",
      description:
        "Queues a batch rejudge for a problem, optionally scoped to a contest, assignment, exam, users, or time range. Requires the caller to have rejudge permission for the selected scope.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateRejudgeRequest" },
            examples: {
              practiceProblem: {
                value: {
                  problemId: "problem_add-two-numbers",
                },
              },
              contestScope: {
                value: {
                  problemId: "problem_add-two-numbers",
                  contestId: "contest_demo_live",
                },
              },
              timeRange: {
                value: {
                  problemId: "problem_add-two-numbers",
                  since: "2026-06-01T00:00:00.000Z",
                  until: "2026-06-03T00:00:00.000Z",
                },
              },
            },
          },
        },
      },
      responses: {
        "202": {
          description: "Rejudge queued",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateRejudgeResponse" },
            },
          },
        },
        "400": {
          description: "Invalid request body",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
            },
          },
        },
        "403": {
          description: "Not permitted to rejudge this scope",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/rejudges/{workflowId}": {
    get: {
      tags: ["Rejudge"],
      summary: "Read rejudge progress",
      operationId: "getRejudgeProgress",
      description:
        "Available to the requester or an administrator. Queued work is read from the durable dispatch record; running and terminal states come from Temporal. Query failures never imply completion.",
      parameters: [
        { name: "workflowId", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Current rejudge state and progress",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status", "completed", "total"],
                properties: {
                  status: {
                    type: "string",
                    enum: ["queued", "running", "completed", "failed", "cancelled"],
                  },
                  completed: { type: "integer", minimum: 0 },
                  total: { type: "integer", minimum: 0 },
                },
              },
            },
          },
        },
        "403": { description: "Not the requester or an administrator" },
        "404": { description: "Unknown rejudge or expired workflow history" },
        "503": {
          description:
            "Rejudge state is temporarily unavailable; retain prior progress and retry",
        },
      },
    },
  },
  "/api/rejudges/{workflowId}/cancel": {
    post: {
      tags: ["Rejudge"],
      summary: "Request rejudge cancellation",
      operationId: "cancelRejudge",
      description:
        "Available to the requester or an administrator. A cancellation request is acknowledged with 202; poll progress until a terminal state is observed. Unattempted queued work can be cancelled atomically before dispatch.",
      parameters: [
        { name: "workflowId", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "The rejudge is already terminal or was cancelled before dispatch",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: {
                  status: { type: "string", enum: ["completed", "failed", "cancelled"] },
                },
              },
            },
          },
        },
        "202": {
          description: "Cancellation requested; continue polling for confirmation",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: { status: { const: "requested" } },
              },
            },
          },
        },
        "403": { description: "Not the requester or an administrator" },
        "404": { description: "Unknown rejudge" },
        "503": {
          description: "Dispatch or the backend is temporarily unavailable; retry cancellation",
        },
      },
    },
  },
} as const;

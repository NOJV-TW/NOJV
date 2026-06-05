export const plagiarismPaths = {
  "/api/plagiarism/{assignmentId}/reports": {
    get: {
      tags: ["Plagiarism"],
      summary: "Get plagiarism reports for a target",
      operationId: "listPlagiarismReports",
      description:
        "Returns plagiarism report state for an assignment, exam, or contest target. The route parameter is named assignmentId but is also used as the exam or contest id when type is provided.",
      parameters: [
        {
          name: "assignmentId",
          in: "path",
          required: true,
          description: "Assignment id by default, or exam/contest id when type is set.",
          schema: { type: "string" },
        },
        {
          name: "type",
          in: "query",
          required: false,
          description: "Target type. Omit for course assignment plagiarism reports.",
          schema: {
            type: "string",
            enum: ["exam", "contest"],
          },
        },
      ],
      responses: {
        "200": {
          description: "Plagiarism reports for the target",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PlagiarismReportListResponse" },
            },
          },
        },
        "400": {
          description: "Missing target id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Only staff can view plagiarism reports",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Target not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    post: {
      tags: ["Plagiarism"],
      summary: "Trigger a plagiarism check",
      operationId: "createPlagiarismReport",
      description:
        "Creates a pending plagiarism report and dispatches the plagiarism check workflow for an assignment, exam, or contest target.",
      parameters: [
        {
          name: "assignmentId",
          in: "path",
          required: true,
          description: "Assignment id by default, or exam/contest id when type is set.",
          schema: { type: "string" },
        },
        {
          name: "type",
          in: "query",
          required: false,
          description: "Target type. Omit for course assignment plagiarism reports.",
          schema: {
            type: "string",
            enum: ["exam", "contest"],
          },
        },
      ],
      responses: {
        "202": {
          description: "Plagiarism check queued",
          headers: {
            Location: {
              description: "Polling URL for the plagiarism report target.",
              schema: { type: "string" },
            },
          },
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreatePlagiarismReportResponse" },
            },
          },
        },
        "400": {
          description: "Missing target id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Only staff can trigger plagiarism checks",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Target not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/plagiarism/{assignmentId}/sources/{userId}/{problemId}": {
    get: {
      tags: ["Plagiarism"],
      summary: "Get plagiarism source files",
      operationId: "getPlagiarismSourceFiles",
      description:
        "Returns source files for a user's top submission for the target/problem pair. The files value can be null when no matching submission exists.",
      parameters: [
        {
          name: "assignmentId",
          in: "path",
          required: true,
          description: "Assignment id by default, or exam/contest id when type is set.",
          schema: { type: "string" },
        },
        {
          name: "userId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "problemId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "type",
          in: "query",
          required: false,
          description: "Target type. Omit for course assignment plagiarism sources.",
          schema: {
            type: "string",
            enum: ["exam", "contest"],
          },
        },
      ],
      responses: {
        "200": {
          description: "Source files for plagiarism comparison",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PlagiarismSourceResponse" },
            },
          },
        },
        "400": {
          description: "Missing assignmentId, userId, or problemId",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Only staff can view plagiarism source code",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Target not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/plagiarism-flags": {
    post: {
      tags: ["Plagiarism"],
      summary: "Flag a plagiarism pair",
      operationId: "createPlagiarismFlag",
      description:
        "Flags a user pair for a problem within an assignment, exam, or contest plagiarism context.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreatePlagiarismFlagRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Plagiarism pair flagged",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreatePlagiarismFlagResponse" },
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
          description: "Not permitted to manage plagiarism flags for this context",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/plagiarism-flags/{id}": {
    delete: {
      tags: ["Plagiarism"],
      summary: "Delete a plagiarism flag",
      operationId: "deletePlagiarismFlag",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Plagiarism flag ID.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "204": {
          description: "Plagiarism flag deleted",
        },
        "400": {
          description: "Missing flag id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Not permitted to manage plagiarism flags for this context",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Plagiarism flag not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
} as const;

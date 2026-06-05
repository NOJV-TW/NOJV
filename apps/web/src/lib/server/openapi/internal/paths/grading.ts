export const gradingPaths = {
  "/api/feedback": {
    get: {
      tags: ["Grading"],
      summary: "List grading feedback",
      operationId: "listGradingFeedback",
      description:
        "Lists submission feedback for an assignment or exam context. Requires permission to view feedback for the selected context.",
      parameters: [
        {
          name: "type",
          in: "query",
          required: true,
          schema: {
            type: "string",
            enum: ["assignment", "exam"],
          },
        },
        {
          name: "assignmentId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "examId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Feedback rows for the selected context",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GradingFeedbackListResponse" },
            },
          },
        },
        "400": {
          description: "Invalid context query",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
            },
          },
        },
        "403": {
          description: "Not permitted to view feedback for this context",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    put: {
      tags: ["Grading"],
      summary: "Create or update grading feedback",
      operationId: "upsertGradingFeedback",
      description:
        "Creates or updates one feedback row for a student/problem within an assignment or exam context.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/UpsertGradingFeedbackRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Feedback row created or updated",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GradingFeedbackItem" },
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
          description: "Not permitted to manage feedback for this context",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/feedback/{id}": {
    delete: {
      tags: ["Grading"],
      summary: "Delete grading feedback",
      operationId: "deleteGradingFeedback",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Feedback ID.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "204": {
          description: "Feedback deleted",
        },
        "400": {
          description: "Missing feedback id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Not permitted to delete this feedback",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Feedback not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/overrides": {
    get: {
      tags: ["Grading"],
      summary: "List score overrides",
      operationId: "listScoreOverrides",
      description:
        "Lists score overrides for an assignment, exam, or contest context. Requires permission to view score overrides for the selected context.",
      parameters: [
        {
          name: "type",
          in: "query",
          required: true,
          schema: {
            type: "string",
            enum: ["assignment", "exam", "contest"],
          },
        },
        {
          name: "assignmentId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "examId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "contestId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Score override rows for the selected context",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ScoreOverrideListResponse" },
            },
          },
        },
        "400": {
          description: "Invalid context query",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
            },
          },
        },
        "403": {
          description: "Not permitted to view score overrides for this context",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    post: {
      tags: ["Grading"],
      summary: "Create score override",
      operationId: "createScoreOverride",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateScoreOverrideRequest" },
          },
        },
      },
      responses: {
        "201": {
          description: "Score override created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ScoreOverrideItem" },
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
          description: "Not permitted to create score overrides for this context",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/overrides/{id}": {
    patch: {
      tags: ["Grading"],
      summary: "Update score override",
      operationId: "updateScoreOverride",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Score override ID.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PatchScoreOverrideRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Score override updated",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ScoreOverrideItem" },
            },
          },
        },
        "400": {
          description: "Missing override id or invalid request body",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
            },
          },
        },
        "403": {
          description: "Not permitted to update this score override",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Score override not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    delete: {
      tags: ["Grading"],
      summary: "Delete score override",
      operationId: "deleteScoreOverride",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Score override ID.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "204": {
          description: "Score override deleted",
        },
        "400": {
          description: "Missing override id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Not permitted to delete this score override",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Score override not found",
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

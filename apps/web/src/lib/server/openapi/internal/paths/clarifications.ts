export const clarificationsPaths = {
  "/api/clarifications": {
    get: {
      tags: ["Clarifications"],
      summary: "List clarifications",
      operationId: "listClarifications",
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
        {
          name: "since",
          in: "query",
          required: false,
          description: "ISO datetime. When present, only newer clarifications are returned.",
          schema: {
            type: "string",
            format: "date-time",
          },
        },
      ],
      responses: {
        "200": {
          description: "Clarifications visible to the current viewer",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ClarificationListResponse",
              },
            },
          },
        },
        "400": {
          description: "Invalid context query",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ValidationErrorResponse",
              },
            },
          },
        },
      },
    },
    post: {
      tags: ["Clarifications"],
      summary: "Ask a clarification",
      operationId: "askClarification",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/CreateClarificationRequest",
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Clarification created",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ClarificationItem",
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
      },
    },
  },
  "/api/clarifications/{id}": {
    patch: {
      tags: ["Clarifications"],
      summary: "Answer or dismiss a clarification",
      operationId: "updateClarification",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/PatchClarificationRequest",
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Clarification updated",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ClarificationItem",
              },
            },
          },
        },
        "400": {
          description: "Missing clarification id or invalid request body",
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
    delete: {
      tags: ["Clarifications"],
      summary: "Delete a clarification",
      operationId: "deleteClarification",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "204": {
          description: "Clarification deleted",
        },
        "400": {
          description: "Missing clarification id",
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
  "/api/clarifications/{id}/replies": {
    post: {
      tags: ["Clarifications"],
      summary: "Answer a clarification with a canned reply",
      operationId: "replyToClarificationWithTemplate",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/CannedClarificationReplyRequest",
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Clarification answered",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ClarificationItem",
              },
            },
          },
        },
        "400": {
          description: "Missing clarification id or invalid request body",
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
} as const;

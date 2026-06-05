export const editorialsPaths = {
  "/api/problems/{id}/editorials": {
    get: {
      tags: ["Editorials"],
      summary: "List problem editorials",
      operationId: "listProblemEditorials",
      description:
        "Lists editorials for a problem. The current user must be allowed to view editorials for the problem.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Problem ID.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Editorials visible to the current user",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: "#/components/schemas/EditorialItem" },
              },
            },
          },
        },
        "400": {
          description: "Missing problem id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Solve access required to view editorials",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Problem not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    post: {
      tags: ["Editorials"],
      summary: "Create or update the current user's problem editorial",
      operationId: "upsertProblemEditorial",
      description:
        "Creates or updates the current user's editorial for a problem. The current user must be allowed to post editorials for the problem.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Problem ID.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/EditorialSubmitRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Editorial created or updated",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EditorialItem" },
            },
          },
        },
        "400": {
          description: "Missing problem id or invalid request body",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
            },
          },
        },
        "403": {
          description: "Solve access required to post an editorial",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Problem not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/editorials/{id}": {
    patch: {
      tags: ["Editorials"],
      summary: "Update an editorial",
      operationId: "updateEditorial",
      description: "Updates an editorial. Only the editorial author or an admin may edit it.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Editorial ID.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/EditorialUpdateRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Editorial updated",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EditorialItem" },
            },
          },
        },
        "400": {
          description: "Missing editorial id or invalid request body",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
            },
          },
        },
        "403": {
          description: "Only the author or an admin may edit this editorial",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Editorial not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    delete: {
      tags: ["Editorials"],
      summary: "Delete an editorial",
      operationId: "deleteEditorial",
      description:
        "Soft-deletes an editorial. Only the editorial author or an admin may delete it.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Editorial ID.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "204": {
          description: "Editorial deleted",
        },
        "400": {
          description: "Missing editorial id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Only the author or an admin may delete this editorial",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Editorial not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/editorials/{id}/reports": {
    post: {
      tags: ["Editorials"],
      summary: "Report an editorial",
      operationId: "reportEditorial",
      description: "Reports an editorial. Users cannot report their own editorials.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Editorial ID.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/EditorialReportRequest" },
          },
        },
      },
      responses: {
        "201": {
          description: "Editorial report created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EditorialReportItem" },
            },
          },
        },
        "400": {
          description: "Missing editorial id or invalid request body",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
            },
          },
        },
        "404": {
          description: "Editorial not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "409": {
          description: "The current user has already reported this editorial",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/editorials/{id}/votes": {
    post: {
      tags: ["Editorials"],
      summary: "Vote on an editorial",
      operationId: "voteEditorial",
      description:
        "Casts an upvote, downvote, or clears the current user's vote. Users cannot vote on their own editorials and must be allowed to view editorials for the problem.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Editorial ID.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/EditorialVoteRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated vote aggregate",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EditorialVoteResponse" },
            },
          },
        },
        "400": {
          description: "Missing editorial id or invalid request body",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
            },
          },
        },
        "403": {
          description: "Voting is not allowed for this user or editorial",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Editorial not found",
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

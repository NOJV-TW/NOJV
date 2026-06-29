export const problemsPaths = {
  "/api/problems": {
    post: {
      tags: ["Problems Management"],
      summary: "Create a draft problem",
      operationId: "createProblem",
      description:
        "Creates a draft problem for an editor/admin. Advanced mode requires the Docker execution backend.",
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateProblemRequest" },
            examples: {
              standard: { value: { mode: "standard" } },
              advanced: { value: { mode: "advanced" } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Problem created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateProblemResponse" },
            },
          },
        },
        "400": {
          description: "Advanced mode unavailable or invalid request",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Not authorized to create problems",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/problems/{id}": {
    delete: {
      tags: ["Problems Management"],
      summary: "Delete a draft problem",
      operationId: "deleteProblem",
      description:
        "Deletes a draft problem. Published problems cannot be deleted by this route.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "204": { description: "Problem deleted" },
        "400": {
          description: "Missing problem id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Access denied or problem is not draft",
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
  "/api/problems/{id}/bookmark": {
    post: {
      tags: ["Problems Management"],
      summary: "Toggle problem bookmark",
      operationId: "toggleProblemBookmark",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Bookmark toggled",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BookmarkToggleResponse" },
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
      },
    },
  },
  "/api/problems/{id}/storage-usage": {
    get: {
      tags: ["Problems Management"],
      summary: "Get problem storage usage",
      operationId: "getProblemStorageUsage",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": {
          description: "Problem storage usage",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StorageUsageResponse" },
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
          description: "Access denied",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/problems/{id}/images": {
    post: {
      tags: ["Problems Management"],
      summary: "Upload problem image",
      operationId: "uploadProblemImage",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                image: {
                  type: "string",
                  format: "binary",
                },
              },
              required: ["image"],
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Image uploaded",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProblemImageUploadResponse" },
            },
          },
        },
        "400": {
          description: "Missing, invalid, or oversized image",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Access denied",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/problems/{id}/advanced-package": {
    post: {
      tags: ["Problems Management"],
      summary: "Upload one canonical Advanced package ZIP",
      operationId: "uploadAdvancedProblemPackage",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                package: {
                  type: "string",
                  format: "binary",
                },
              },
              required: ["package"],
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Advanced package built and attached to the problem",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AdvancedPackageUploadResponse" },
            },
          },
        },
        "400": {
          description: "Missing, invalid, or unbuildable package",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Access denied",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/problems/advanced-scaffold": {
    get: {
      tags: ["Problems Management"],
      summary: "Download a canonical Advanced package scaffold",
      operationId: "downloadAdvancedProblemScaffold",
      responses: {
        "200": {
          description: "Advanced package scaffold zip file",
          content: {
            "application/zip": {
              schema: {
                type: "string",
                format: "binary",
              },
            },
          },
        },
      },
    },
  },
} as const;

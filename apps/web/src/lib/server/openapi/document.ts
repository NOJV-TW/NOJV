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
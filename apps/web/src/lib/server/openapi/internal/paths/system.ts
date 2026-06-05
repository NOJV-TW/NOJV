export const systemPaths = {
  "/api/admin/healthz": {
    get: {
      tags: ["System"],
      summary: "Get detailed system health",
      operationId: "getAdminHealth",
      description:
        "Returns detailed subsystem health. Requires an authenticated admin session.",
      responses: {
        "200": {
          description: "System is healthy",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AdminHealthResponse",
              },
              example: {
                status: "healthy",
                checks: {
                  postgres: "ok",
                  redis: "ok",
                  temporal: "ok",
                },
              },
            },
          },
        },
        "503": {
          description: "System is unhealthy",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AdminHealthResponse",
              },
              example: {
                status: "unhealthy",
                checks: {
                  postgres: "ok",
                  redis: "error",
                  temporal: "ok",
                },
              },
            },
          },
        },
        "403": {
          description: "Admin access required",
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

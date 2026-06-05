export const notificationsPaths = {
  "/api/notifications": {
    get: {
      tags: ["Notifications"],
      summary: "List recent notifications",
      operationId: "listNotifications",
      parameters: [
        {
          name: "limit",
          in: "query",
          required: false,
          description: "Number of recent notifications to return. Clamped to 1-50.",
          schema: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            default: 20,
          },
        },
      ],
      responses: {
        "200": {
          description: "Recent notifications and unread count",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/NotificationListResponse",
              },
            },
          },
        },
      },
    },
    patch: {
      tags: ["Notifications"],
      summary: "Mark all notifications as read",
      operationId: "markAllNotificationsRead",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/MarkAllNotificationsReadRequest",
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Number of updated notifications",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/UpdatedCountResponse",
              },
            },
          },
        },
      },
    },
    delete: {
      tags: ["Notifications"],
      summary: "Delete read notifications",
      operationId: "deleteReadNotifications",
      parameters: [
        {
          name: "status",
          in: "query",
          required: true,
          schema: {
            type: "string",
            enum: ["read"],
          },
        },
      ],
      responses: {
        "204": {
          description: "Read notifications deleted",
        },
        "400": {
          description: "Missing required status=read query parameter",
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
  "/api/notifications/unread-count": {
    get: {
      tags: ["Notifications"],
      summary: "Get unread notification count",
      operationId: "getUnreadNotificationCount",
      responses: {
        "200": {
          description: "Unread notification count",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/UnreadNotificationCountResponse",
              },
            },
          },
        },
      },
    },
  },
  "/api/notifications/{id}": {
    patch: {
      tags: ["Notifications"],
      summary: "Mark one notification as read",
      operationId: "markNotificationRead",
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
              $ref: "#/components/schemas/MarkNotificationReadRequest",
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Number of updated notifications",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/UpdatedCountResponse",
              },
            },
          },
        },
        "400": {
          description: "Missing notification id or invalid body",
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
      tags: ["Notifications"],
      summary: "Delete one notification",
      operationId: "deleteNotification",
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
          description: "Notification deleted",
        },
        "400": {
          description: "Missing notification id",
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

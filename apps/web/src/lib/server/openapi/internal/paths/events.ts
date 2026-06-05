export const eventsPaths = {
  "/api/events/stream": {
    get: {
      tags: ["Events"],
      summary: "Open server-sent event stream",
      operationId: "openEventStream",
      description:
        "Opens an authenticated SSE stream for user, notification, and authorized clarification events.",
      parameters: [
        {
          name: "clarificationSub",
          in: "query",
          required: false,
          description:
            "Optional repeated subscription value in the form contest:{id}, exam:{id}, or assignment:{id}. Unauthorized clarification subscriptions are ignored.",
          schema: {
            type: "array",
            items: { type: "string" },
          },
          style: "form",
          explode: true,
        },
      ],
      responses: {
        "200": {
          description: "SSE stream",
          content: {
            "text/event-stream": {
              schema: {
                type: "string",
                description: "Server-sent event stream.",
              },
            },
          },
        },
        "401": {
          description: "Unauthorized",
          content: {
            "text/plain": {
              schema: { type: "string" },
            },
          },
        },
        "429": {
          description: "Rate limit or concurrent connection limit exceeded",
          content: {
            "text/plain": {
              schema: { type: "string" },
            },
          },
        },
        "503": {
          description: "SSE is not configured",
          content: {
            "text/plain": {
              schema: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

export const contestsPaths = {
  "/api/contests/{id}/scoreboard": {
    get: {
      tags: ["Contests"],
      summary: "Get contest scoreboard",
      operationId: "getContestScoreboard",
      description:
        "Returns the contest scoreboard. Visibility follows contest scoreboard settings and the current viewer's permission.",
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
          description: "Contest scoreboard",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ContestScoreboardResponse" },
            },
          },
        },
        "400": {
          description: "Missing contest id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Contest not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
  "/api/contests/{id}/scoreboard/chart": {
    get: {
      tags: ["Contests"],
      summary: "Get contest scoreboard chart data",
      operationId: "getContestScoreboardChart",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "topN",
          in: "query",
          required: false,
          description: "Number of top contestants to include. Clamped from 1 to 50.",
          schema: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            default: 10,
          },
        },
      ],
      responses: {
        "200": {
          description: "Scoreboard chart series",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ScoreboardChartResponse" },
            },
          },
        },
        "400": {
          description: "Missing contest id",
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

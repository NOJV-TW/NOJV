export const uploadsPaths = {
  "/api/uploads/image": {
    post: {
      tags: ["Uploads"],
      summary: "Upload shared user content image",
      operationId: "uploadUserContentImage",
      description:
        "Uploads a user content image. Allowed file types are png, jpeg, gif, and webp. Maximum size is 5 MB.",
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
              schema: { $ref: "#/components/schemas/UserContentImageUploadResponse" },
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
      },
    },
  },
} as const;

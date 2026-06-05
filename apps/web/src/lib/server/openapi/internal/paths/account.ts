export const accountPaths = {
  "/api/account/avatar": {
    put: {
      tags: ["Account"],
      summary: "Upload account avatar",
      operationId: "uploadAccountAvatar",
      description:
        "Uploads the current user's avatar. The file must be a WebP image and no larger than 1 MB.",
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                file: {
                  type: "string",
                  format: "binary",
                  description: "WebP avatar image, maximum 1 MB.",
                },
              },
              required: ["file"],
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Avatar uploaded",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AccountAvatarUploadResponse",
              },
            },
          },
        },
        "400": {
          description: "Missing file, invalid file type, or file too large",
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
      tags: ["Account"],
      summary: "Delete account avatar",
      operationId: "deleteAccountAvatar",
      description:
        "Deletes the current user's avatar and clears the avatar URL on the user row.",
      responses: {
        "204": {
          description: "Avatar deleted",
        },
      },
    },
  },
} as const;

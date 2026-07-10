const errorContent = {
  "application/json": {
    schema: { $ref: "#/components/schemas/ErrorResponse" },
  },
} as const;

const validationErrorContent = {
  "application/json": {
    schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
  },
} as const;

export const postsPaths = {
  "/api/problems/{id}/posts": {
    get: {
      tags: ["Posts"],
      summary: "List problem posts",
      operationId: "listProblemPosts",
      description:
        "Lists a page of editorial or discussion posts for a problem. The current user must be allowed to view posts of the requested type; admins bypass the view gate.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Problem ID.",
          schema: { type: "string" },
        },
        {
          name: "type",
          in: "query",
          required: true,
          description: "Post type to list.",
          schema: { type: "string", enum: ["editorial", "discussion"] },
        },
        {
          name: "page",
          in: "query",
          required: false,
          description: "1-based page number.",
          schema: { type: "integer", minimum: 1, default: 1 },
        },
        {
          name: "pageSize",
          in: "query",
          required: false,
          description: "Page size.",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        "200": {
          description: "Page of posts visible to the current user",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PostListPageResponse" },
            },
          },
        },
        "400": {
          description: "Missing problem id or invalid query",
          content: validationErrorContent,
        },
        "403": {
          description: "The current user may not view posts of this type for the problem",
          content: errorContent,
        },
        "404": {
          description: "Problem not found",
          content: errorContent,
        },
      },
    },
    post: {
      tags: ["Posts"],
      summary: "Create a problem post",
      operationId: "createProblemPost",
      description:
        "Creates an editorial or discussion post for a problem. The current user must be allowed to interact with posts of the requested type.",
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
            schema: { $ref: "#/components/schemas/PostCreateRequest" },
          },
        },
      },
      responses: {
        "201": {
          description: "Post created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PostItem" },
            },
          },
        },
        "400": {
          description: "Missing problem id or invalid request body",
          content: validationErrorContent,
        },
        "403": {
          description: "The current user may not post to this problem right now",
          content: errorContent,
        },
        "404": {
          description: "Problem not found",
          content: errorContent,
        },
      },
    },
  },
  "/api/posts/{id}": {
    get: {
      tags: ["Posts"],
      summary: "Get a post",
      operationId: "getPost",
      description:
        "Returns a single post. The current user must be allowed to view posts of its type; admins bypass the view gate.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Post ID.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Post visible to the current user",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PostItem" },
            },
          },
        },
        "400": {
          description: "Missing post id",
          content: errorContent,
        },
        "403": {
          description: "The current user may not view this post",
          content: errorContent,
        },
        "404": {
          description: "Post not found",
          content: errorContent,
        },
      },
    },
    patch: {
      tags: ["Posts"],
      summary: "Update a post",
      operationId: "updatePost",
      description: "Updates a post. Only the post author or an admin may edit it.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Post ID.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PostUpdateRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Post updated",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PostItem" },
            },
          },
        },
        "400": {
          description: "Missing post id or invalid request body",
          content: validationErrorContent,
        },
        "403": {
          description: "Only the author or an admin may edit this post",
          content: errorContent,
        },
        "404": {
          description: "Post not found",
          content: errorContent,
        },
      },
    },
    delete: {
      tags: ["Posts"],
      summary: "Delete a post",
      operationId: "deletePost",
      description: "Soft-deletes a post. Only the post author or an admin may delete it.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Post ID.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "204": {
          description: "Post deleted",
        },
        "400": {
          description: "Missing post id",
          content: errorContent,
        },
        "403": {
          description: "Only the author or an admin may delete this post",
          content: errorContent,
        },
        "404": {
          description: "Post not found",
          content: errorContent,
        },
      },
    },
  },
  "/api/posts/{id}/votes": {
    post: {
      tags: ["Posts"],
      summary: "Vote on a post",
      operationId: "votePost",
      description:
        "Casts an upvote, downvote, or clears the current user's vote. Users cannot vote on their own posts and must be allowed to interact with posts of its type.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Post ID.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PostVoteRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated vote aggregate",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PostVoteResponse" },
            },
          },
        },
        "400": {
          description: "Missing post id or invalid request body",
          content: validationErrorContent,
        },
        "403": {
          description: "Voting is not allowed for this user or post",
          content: errorContent,
        },
        "404": {
          description: "Post not found",
          content: errorContent,
        },
      },
    },
  },
  "/api/posts/{id}/comments": {
    get: {
      tags: ["Posts"],
      summary: "List post comments",
      operationId: "listPostComments",
      description:
        "Lists comments on a post. The current user must be allowed to view the post; admins bypass the view gate.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Post ID.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Comments on the post",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: "#/components/schemas/PostCommentItem" },
              },
            },
          },
        },
        "400": {
          description: "Missing post id",
          content: errorContent,
        },
        "403": {
          description: "The current user may not view this post",
          content: errorContent,
        },
        "404": {
          description: "Post not found",
          content: errorContent,
        },
      },
    },
    post: {
      tags: ["Posts"],
      summary: "Comment on a post",
      operationId: "createPostComment",
      description:
        "Adds a comment or a one-level reply to a post. The current user must be allowed to interact with posts of its type.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Post ID.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PostCommentSubmitRequest" },
          },
        },
      },
      responses: {
        "201": {
          description: "Comment created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PostCommentItem" },
            },
          },
        },
        "400": {
          description: "Missing post id, invalid request body, or invalid parent comment",
          content: validationErrorContent,
        },
        "403": {
          description: "The current user may not comment on this post right now",
          content: errorContent,
        },
        "404": {
          description: "Post not found",
          content: errorContent,
        },
      },
    },
  },
  "/api/posts/{id}/reports": {
    post: {
      tags: ["Posts"],
      summary: "Report a post",
      operationId: "reportPost",
      description:
        "Reports a post. Users cannot report their own posts and must be allowed to view posts of its type.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Post ID.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ContentReportRequest" },
          },
        },
      },
      responses: {
        "201": {
          description: "Content report created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ContentReportItem" },
            },
          },
        },
        "400": {
          description: "Missing post id or invalid request body",
          content: validationErrorContent,
        },
        "403": {
          description:
            "Reporting your own post, or a post the current user cannot view, is not allowed",
          content: errorContent,
        },
        "404": {
          description: "Post not found",
          content: errorContent,
        },
        "409": {
          description: "The current user has already reported this post",
          content: errorContent,
        },
      },
    },
  },
  "/api/comments/{id}": {
    delete: {
      tags: ["Posts"],
      summary: "Delete a comment",
      operationId: "deleteComment",
      description: "Soft-deletes a comment. Only the comment author or an admin may delete it.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Comment ID.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "204": {
          description: "Comment deleted",
        },
        "400": {
          description: "Missing comment id",
          content: errorContent,
        },
        "403": {
          description: "Only the author or an admin may delete this comment",
          content: errorContent,
        },
        "404": {
          description: "Comment not found",
          content: errorContent,
        },
      },
    },
  },
  "/api/comments/{id}/reports": {
    post: {
      tags: ["Posts"],
      summary: "Report a comment",
      operationId: "reportComment",
      description:
        "Reports a comment. Users cannot report their own comments and must be allowed to view the post the comment belongs to.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Comment ID.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ContentReportRequest" },
          },
        },
      },
      responses: {
        "201": {
          description: "Content report created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ContentReportItem" },
            },
          },
        },
        "400": {
          description: "Missing comment id or invalid request body",
          content: validationErrorContent,
        },
        "403": {
          description:
            "Reporting your own comment, or a comment the current user cannot view, is not allowed",
          content: errorContent,
        },
        "404": {
          description: "Comment not found",
          content: errorContent,
        },
        "409": {
          description: "The current user has already reported this comment",
          content: errorContent,
        },
      },
    },
  },
} as const;

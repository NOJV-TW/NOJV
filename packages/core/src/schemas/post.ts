import { z } from "zod";

const TITLE_MIN = 1;
const TITLE_MAX = 200;
const CONTENT_MIN = 10;
const CONTENT_MAX = 50_000;
const REASON_MIN = 1;
const REASON_MAX = 1000;
const COMMENT_MIN = 1;
const COMMENT_MAX = 5000;

export const problemPostTypeSchema = z.enum(["editorial", "discussion"]);

export const postSubmitSchema = z.object({
  title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX),
  content: z.string().min(CONTENT_MIN).max(CONTENT_MAX),
});

export const postUpdateSchema = z
  .object({
    title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX).optional(),
    content: z.string().min(CONTENT_MIN).max(CONTENT_MAX).optional(),
  })
  .refine((value) => value.title !== undefined || value.content !== undefined, {
    message: "At least one field (title or content) is required.",
  });

export const postVoteSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

export const contentReportSchema = z.object({
  reason: z.string().min(REASON_MIN).max(REASON_MAX),
});

export const postCommentSubmitSchema = z.object({
  content: z.string().trim().min(COMMENT_MIN).max(COMMENT_MAX),
  parentId: z.string().nullish(),
});

export const postEntrySchema = z.looseObject({
  id: z.string(),
  type: problemPostTypeSchema,
  title: z.string(),
  content: z.string(),
  createdAt: z.string(),
  voteScore: z.number(),
  viewerVote: z.number(),
  commentCount: z.number(),
  author: z.object({
    username: z.string().nullable(),
    name: z.string(),
  }),
});

export const postListResponseSchema = z.object({
  items: z.array(postEntrySchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export type ProblemPostType = z.infer<typeof problemPostTypeSchema>;
export type PostSubmitInput = z.infer<typeof postSubmitSchema>;
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;
export type PostVoteInput = z.infer<typeof postVoteSchema>;
export type ContentReportInput = z.infer<typeof contentReportSchema>;
export type PostCommentSubmitInput = z.infer<typeof postCommentSubmitSchema>;

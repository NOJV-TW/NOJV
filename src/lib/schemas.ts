import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().min(1, "Name must not be empty").max(100).optional(),
});

export const createPostSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().optional(),
  published: z.boolean().default(false),
  authorId: z.string().cuid("Invalid author ID"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;

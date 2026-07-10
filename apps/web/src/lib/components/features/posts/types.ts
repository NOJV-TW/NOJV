import type { ProblemPostType } from "@nojv/core";

export interface PostAuthor {
  username: string | null;
  name: string;
}

export interface PostListItem {
  id: string;
  title: string;
  createdAt: string;
  author: PostAuthor;
  voteScore: number;
  commentCount: number;
}

export interface PostDetail {
  id: string;
  type: ProblemPostType;
  title: string;
  content: string;
  createdAt: string;
  authorId: string;
  author: PostAuthor;
  voteScore: number;
  viewerVote: number;
}

export interface PostCommentEntry {
  id: string;
  parentId: string | null;
  content: string;
  createdAt: string;
  authorId: string;
  author: PostAuthor;
  deleted: boolean;
}

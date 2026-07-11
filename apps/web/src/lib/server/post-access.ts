import type { ProblemPostType } from "@nojv/core";
import { postDomain, problemDomain } from "@nojv/application";

import { ForbiddenError, NotFoundError, type ActorContext } from "$lib/server/auth";

const { canViewPosts, getPostById, resolveActiveContextForUser } = postDomain;
const { getProblemRowById } = problemDomain;

const VIEW_GATE_MESSAGES: Record<ProblemPostType, string> = {
  editorial: "Solve this problem first to view editorials.",
  discussion: "You cannot view discussions for this problem right now.",
};

export async function requireProblemPostAccess(
  userId: string,
  problemId: string,
  type: ProblemPostType,
  isAdmin: boolean,
) {
  const problem = await getProblemRowById(problemId);
  if (!problem) throw new NotFoundError("Problem not found.");
  if (isAdmin) return problem;

  const context = await resolveActiveContextForUser(userId, problemId, new Date());
  const canView = await canViewPosts(userId, problemId, type, context);
  if (!canView) throw new ForbiddenError(VIEW_GATE_MESSAGES[type]);

  return problem;
}

export async function requireViewablePost(postId: string, actor: ActorContext) {
  const post = await getPostById(postId, actor.userId);
  if (!post) throw new NotFoundError("Post not found.");

  await requireProblemPostAccess(
    actor.userId,
    post.problemId,
    post.type,
    actor.platformRole === "admin",
  );

  return post;
}

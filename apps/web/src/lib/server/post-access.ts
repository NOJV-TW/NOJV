import type { ProblemPostType } from "@nojv/core";
import { postDomain, problemDomain } from "@nojv/application";

import { NotFoundError, type ActorContext } from "$lib/server/auth";

const { assertCanInteractWithPosts, getPostById } = postDomain;
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

  await assertCanInteractWithPosts(userId, problemId, type, VIEW_GATE_MESSAGES[type]);

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

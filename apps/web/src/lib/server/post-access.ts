import type { ProblemPostType } from "@nojv/core";
import { postDomain, NotFoundError } from "@nojv/application";

import { type CompletedActorContext } from "$lib/server/auth";

const { assertCanInteractWithPosts, getPostById } = postDomain;

const VIEW_GATE_MESSAGES: Record<ProblemPostType, string> = {
  editorial: "Solve this problem first to view editorials.",
  discussion: "You cannot view discussions for this problem right now.",
};

export async function requireProblemPostAccess(
  actor: CompletedActorContext,
  problemId: string,
  type: ProblemPostType,
) {
  return assertCanInteractWithPosts(actor, problemId, type, VIEW_GATE_MESSAGES[type]);
}

export async function requireViewablePost(postId: string, actor: CompletedActorContext) {
  const post = await getPostById(postId, actor.userId);
  if (!post) throw new NotFoundError("Post not found.");

  await requireProblemPostAccess(actor, post.problemId, post.type);

  return post;
}

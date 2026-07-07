import type { PageServerLoad } from "./$types";
import { submissionDomain } from "@nojv/application";

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ url }) => {
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const userId = url.searchParams.get("userId")?.trim() || undefined;
  const problemId = url.searchParams.get("problemId")?.trim() || undefined;

  const { items, nextCursor } = await submissionDomain.listAllSubmissionsPaged({
    limit: PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    ...(userId ? { userId } : {}),
    ...(problemId ? { problemId } : {}),
  });

  return {
    submissions: items,
    nextCursor,
    userId: userId ?? "",
    problemId: problemId ?? "",
  };
};

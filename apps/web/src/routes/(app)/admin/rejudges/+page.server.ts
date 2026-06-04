import type { PageServerLoad } from "./$types";
import { submissionDomain } from "@nojv/domain";

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ url }) => {
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const problemIdRaw = url.searchParams.get("problemId")?.trim();
  const problemId = problemIdRaw && problemIdRaw.length > 0 ? problemIdRaw : undefined;

  const { items, nextCursor } = await submissionDomain.listRejudgeLogsPaged({
    limit: PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    ...(problemId ? { problemId } : {}),
  });

  return { logs: items, nextCursor, problemId: problemId ?? "" };
};

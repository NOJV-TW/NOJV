import type { PageServerLoad } from "./$types";
import { submissionDomain } from "@nojv/application";

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ url }) => {
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const userIdRaw = url.searchParams.get("userId")?.trim();
  const problemIdRaw = url.searchParams.get("problemId")?.trim();
  const status = url.searchParams.get("status") === "system_error" ? "system_error" : undefined;
  const userId = userIdRaw && userIdRaw.length > 0 ? userIdRaw : undefined;
  const problemId = problemIdRaw && problemIdRaw.length > 0 ? problemIdRaw : undefined;

  const { items, nextCursor } = await submissionDomain.listAllSubmissionsPaged({
    limit: PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    ...(userId ? { userId } : {}),
    ...(problemId ? { problemId } : {}),
    ...(status ? { status } : {}),
  });

  return {
    submissions: items,
    nextCursor,
    userId: userId ?? "",
    problemId: problemId ?? "",
    status: status ?? "",
  };
};

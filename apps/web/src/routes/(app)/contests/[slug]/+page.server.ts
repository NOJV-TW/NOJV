import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { contestDomain } from "@nojv/domain";

const { getContestDetail } = contestDomain;
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(
  async ({ params, locals }: PageServerLoadEvent) => {
    const now = new Date();
    const user = locals.user;

    // Contests dropped proctoring (IP lock / page lock) in the
    // 2026-04-14 split. The exam-side detail route (Phase 3) will
    // carry the IP check path over.
    const contest = await getContestDetail(params.slug, {
      userId: user?.id ?? null,
      now
    });

    return { contest };
  }
);

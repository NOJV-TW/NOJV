import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { contestDomain } from "@nojv/domain";

const { getContestDetail } = contestDomain;
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(
  async ({ params, locals }: PageServerLoadEvent) => {
    const now = new Date();
    const user = locals.user;

    const contest = await getContestDetail(params.slug, {
      userId: user?.id ?? null,
      platformRole: locals.sessionUser?.platformRole ?? null,
      now
    });

    return { contest };
  }
);

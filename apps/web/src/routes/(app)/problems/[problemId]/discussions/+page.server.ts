import type { PageServerLoad } from "./$types";
import { loadPostListPage } from "$lib/server/post-pages";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad((event) =>
  loadPostListPage(event, "discussion"),
);

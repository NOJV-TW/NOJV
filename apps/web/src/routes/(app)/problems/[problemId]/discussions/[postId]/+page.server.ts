import type { PageServerLoad } from "./$types";
import { loadPostArticlePage } from "$lib/server/post-pages";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad((event) =>
  loadPostArticlePage(event, "discussion"),
);

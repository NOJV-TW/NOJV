import type { PageServerLoad } from "./$types";
import { loadPostComposePage } from "$lib/server/post-pages";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad((event) =>
  loadPostComposePage(event, "editorial"),
);

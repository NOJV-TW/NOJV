import type { PageServerLoad } from "./$types";
import { loadPostEditPage } from "$lib/server/post-pages";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad((event) => loadPostEditPage(event, "editorial"));

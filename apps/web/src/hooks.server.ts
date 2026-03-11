import type { Handle } from "@sveltejs/kit";
import { redirect } from "@sveltejs/kit";

import { auth } from "$lib/auth";

const DEFAULT_LOCALE = "zh-TW";
const SUPPORTED_LOCALES = ["en", "zh-TW"];

export const handle: Handle = async ({ event, resolve }) => {
  // --- Auth: populate event.locals with session/user ---
  const session = await auth.api.getSession({
    headers: event.request.headers
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;

  // --- Locale routing: redirect bare "/" to default locale ---
  const { pathname } = event.url;

  if (pathname === "/") {
    redirect(302, `/${DEFAULT_LOCALE}`);
  }

  // Also handle paths that don't start with a supported locale or /api
  const firstSegment = pathname.split("/")[1];
  const isLocaleRoute = SUPPORTED_LOCALES.includes(firstSegment ?? "");
  const isApiRoute = firstSegment === "api";

  if (!isLocaleRoute && !isApiRoute) {
    redirect(302, `/${DEFAULT_LOCALE}${pathname}`);
  }

  return resolve(event);
};

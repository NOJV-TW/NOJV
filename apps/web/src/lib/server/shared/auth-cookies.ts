import type { RequestEvent } from "@sveltejs/kit";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";

export function forwardSetCookies(event: RequestEvent, headers: Headers): void {
  for (const raw of headers.getSetCookie()) {
    for (const [name, attributes] of parseSetCookieHeader(raw)) {
      event.cookies.set(name, attributes.value, {
        ...toCookieOptions(attributes),
        path: attributes.path ?? "/",
      });
    }
  }
}

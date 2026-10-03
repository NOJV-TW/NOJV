import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { getActorContext } from "$lib/server/auth";
import {
  RemoteImageError,
  fetchRemoteImage,
  normalizeRemoteImageUrl,
} from "$lib/server/remote-image";
import { apiHandler } from "$lib/server/shared/api-handler";
import { detectImageMime } from "$lib/server/shared/file-validation";
import { remoteAssetFetchRateLimiter } from "$lib/server/shared/rate-limiter";
import { immutableImageResponse } from "$lib/server/storage/image-response";

function imageResponse(image: { body: Buffer; contentType: string }): Response {
  const contentType = detectImageMime(image.body);
  if (!contentType) error(502, "Remote image is invalid");
  return immutableImageResponse(image.body, contentType, {
    "cache-control": "private, max-age=300",
    "cross-origin-resource-policy": "same-origin",
  });
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = getActorContext(event);
  if (!actor) error(401, "Authentication required.");
  const rawUrl = event.url.searchParams.get("url");
  if (!rawUrl) error(400, "Missing remote image URL");

  let remoteUrl: URL;
  try {
    remoteUrl = normalizeRemoteImageUrl(rawUrl);
  } catch {
    error(400, "Invalid remote image URL");
  }

  if (remoteUrl.hostname === event.url.hostname) {
    if (remoteUrl.pathname === event.url.pathname) {
      error(400, "Invalid remote image URL");
    }
    const local = new URL(event.url.origin);
    local.pathname = remoteUrl.pathname;
    local.search = remoteUrl.search;
    redirect(307, local.href);
  }

  const canonicalUrl = remoteUrl.href;
  const rateLimit = await remoteAssetFetchRateLimiter.consume(`u:${actor.userId}`);
  if (rateLimit === "limited") error(429, "Too many remote image requests");
  if (rateLimit === "unavailable") error(503, "Remote image service unavailable");

  let fetched: { body: Buffer; contentType: string };
  try {
    fetched = await fetchRemoteImage(canonicalUrl, {
      forbiddenHostname: event.url.hostname,
    });
  } catch (reason) {
    if (reason instanceof RemoteImageError) {
      const status = reason.code === "blocked" || reason.code === "invalid_url" ? 400 : 502;
      error(status, "Remote image unavailable");
    }
    throw reason;
  }

  return imageResponse(fetched);
});

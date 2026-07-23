import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import {
  RemoteImageError,
  fetchRemoteImage,
  normalizeRemoteImageUrl,
} from "$lib/server/remote-image";
import { apiHandler } from "$lib/server/shared/api-handler";
import { getClientIp } from "$lib/server/shared/client-ip";
import { detectImageMime } from "$lib/server/shared/file-validation";
import { remoteAssetFetchRateLimiter } from "$lib/server/shared/rate-limiter";
import { toArrayBufferBody } from "$lib/server/shared/response-body";
import {
  cacheRemoteImage,
  isRemoteImageNotFoundError,
  readRemoteImage,
} from "$lib/server/storage/remote-image";

function imageResponse(image: { body: Buffer; contentType: string }): Response {
  const contentType = detectImageMime(image.body);
  if (!contentType) error(502, "Remote image cache is invalid");
  return new Response(toArrayBufferBody(image.body), {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(image.body.byteLength),
      "content-type": contentType,
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

export const GET: RequestHandler = apiHandler(async (event) => {
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
  try {
    return imageResponse(await readRemoteImage(canonicalUrl));
  } catch (reason) {
    if (!isRemoteImageNotFoundError(reason)) throw reason;
  }

  const rateLimit = await remoteAssetFetchRateLimiter.consume(getClientIp(event));
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

  return imageResponse(await cacheRemoteImage(canonicalUrl, fetched.body, fetched.contentType));
});

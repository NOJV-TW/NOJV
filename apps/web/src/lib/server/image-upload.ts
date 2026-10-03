import { error, type RequestEvent } from "@sveltejs/kit";

import { fetchRemoteImage, RemoteImageError } from "./remote-image";
import { readFormData } from "./shared/api-handler";
import { MAX_IMAGE_SIZE, readUploadedImage } from "./shared/file-validation";

export async function readImageUpload(event: RequestEvent) {
  const form = await readFormData(event, MAX_IMAGE_SIZE + 64 * 1024);
  const hasFile = form.has("image");
  const hasUrl = form.has("url");
  if (hasFile === hasUrl || form.getAll(hasFile ? "image" : "url").length !== 1) {
    error(400, "Provide either one image file or one remote image URL.");
  }
  if (hasFile) return readUploadedImage(form);

  const url = form.get("url");
  if (typeof url !== "string" || !url.trim()) error(400, "Invalid remote image URL.");
  try {
    const { body, contentType } = await fetchRemoteImage(url.trim(), {
      forbiddenHostname: event.url.hostname,
    });
    return { buffer: body, contentType };
  } catch (reason) {
    if (reason instanceof RemoteImageError) {
      const status = reason.code === "too_large" ? 413 : reason.code === "upstream" ? 502 : 400;
      error(status, "Remote image unavailable.");
    }
    throw reason;
  }
}

import { error } from "@sveltejs/kit";

type ImageFormat = "webp" | "png" | "jpeg" | "gif";

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const IMAGE_FORMAT_TO_MIME: Record<ImageFormat, string> = {
  webp: "image/webp",
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set(Object.values(IMAGE_FORMAT_TO_MIME));

export function detectImageMime(buffer: Buffer | Uint8Array): string | null {
  const format = detectImageFormat(buffer);
  return format ? IMAGE_FORMAT_TO_MIME[format] : null;
}

function detectImageFormat(buffer: Buffer | Uint8Array): ImageFormat | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "gif";
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

export async function readUploadedImage(
  formData: FormData,
): Promise<{ buffer: Buffer; contentType: string }> {
  const file = formData.get("image");

  if (!(file instanceof File)) {
    error(400, "No image provided");
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    error(400, "Invalid file type. Allowed: png, jpeg, gif, webp");
  }

  if (file.size > MAX_IMAGE_SIZE) {
    error(400, "File too large (max 5MB)");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const contentType = detectImageMime(buffer);
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    error(400, "Invalid file type. File content does not match an allowed image format.");
  }

  return { buffer, contentType };
}

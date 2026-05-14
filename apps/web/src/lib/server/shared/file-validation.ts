import { ValidationError } from "@nojv/domain";

export type ImageFormat = "webp" | "png" | "jpeg" | "gif";

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export const IMAGE_FORMAT_TO_MIME: Record<ImageFormat, string> = {
  webp: "image/webp",
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

export const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set(
  Object.values(IMAGE_FORMAT_TO_MIME),
);

/** Detect by magic bytes and return the MIME type. Returns null if unknown. */
export function detectImageMime(buffer: Buffer | Uint8Array): string | null {
  const format = detectImageFormat(buffer);
  return format ? IMAGE_FORMAT_TO_MIME[format] : null;
}

export function detectImageFormat(buffer: Buffer | Uint8Array): ImageFormat | null {
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

export function assertImageFormat(
  buffer: Buffer | Uint8Array,
  allowed: ImageFormat[],
): ImageFormat {
  const detected = detectImageFormat(buffer);
  if (!detected || !allowed.includes(detected)) {
    throw new ValidationError(`Invalid file type. Allowed: ${allowed.join(", ")}`);
  }
  return detected;
}

export function assertImageSize(buffer: Buffer | Uint8Array, maxBytes: number): void {
  if (buffer.length > maxBytes) {
    throw new ValidationError(`File too large (max ${String(maxBytes)} bytes)`);
  }
}

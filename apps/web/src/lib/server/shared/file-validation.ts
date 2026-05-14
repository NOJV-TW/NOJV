import { ValidationError } from "@nojv/domain";

export type ImageFormat = "webp" | "png" | "jpeg" | "gif";

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

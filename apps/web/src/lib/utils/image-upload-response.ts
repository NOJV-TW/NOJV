interface ImageUploadBody {
  url?: unknown;
  message?: unknown;
}

export async function readImageUploadUrl(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const body = (await response.json().catch(() => null)) as ImageUploadBody | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.message === "string" && body.message.trim() !== ""
        ? body.message
        : fallbackMessage,
    );
  }
  if (typeof body?.url !== "string" || body.url.trim() === "") {
    throw new Error(fallbackMessage);
  }
  return body.url;
}

export function avatarSrc(image: string, allowRemote = true): string | undefined {
  const sameOrigin = image.startsWith("/") && !image.startsWith("//");
  if (sameOrigin) return image;
  return allowRemote ? `/api/images/proxy?url=${encodeURIComponent(image)}` : undefined;
}

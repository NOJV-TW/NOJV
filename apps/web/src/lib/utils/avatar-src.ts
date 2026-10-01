export function avatarSrc(image: string): string {
  const sameOrigin = image.startsWith("/") && !image.startsWith("//");
  return sameOrigin ? image : `/api/images/proxy?url=${encodeURIComponent(image)}`;
}

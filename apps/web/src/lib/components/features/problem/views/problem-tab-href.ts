export function problemTabHref(currentUrl: URL, nextTab: "public" | "mine" | "all"): string {
  const params = new URLSearchParams(currentUrl.searchParams);
  if (nextTab === "public") params.delete("tab");
  else params.set("tab", nextTab);
  const query = params.toString();
  const search = query ? `?${query}` : "";
  return `${currentUrl.pathname}${search}`;
}

export type LinkProvider = "github" | "google";

export const LINKABLE_PROVIDERS: readonly LinkProvider[] = ["github", "google"];

export function isLinkProvider(value: string): value is LinkProvider {
  return (LINKABLE_PROVIDERS as readonly string[]).includes(value);
}

export function wouldOrphanAccount(accountProviderIds: string[], unlinking: string): boolean {
  const remaining = [...accountProviderIds];
  const idx = remaining.indexOf(unlinking);
  if (idx >= 0) remaining.splice(idx, 1);
  return remaining.length === 0;
}

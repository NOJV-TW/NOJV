export type LinkProvider = "github" | "google";

export const LINKABLE_PROVIDERS: readonly LinkProvider[] = ["github", "google"];

export function isLinkProvider(value: string): value is LinkProvider {
  return (LINKABLE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * A user must always keep at least one way to sign in. Unlinking a provider is
 * only allowed if a credential password or another linked provider remains.
 *
 * `accountProviderIds` is the full list from better-auth's listUserAccounts
 * (OAuth providers plus the "credential" entry for password accounts).
 */
export function wouldOrphanAccount(accountProviderIds: string[], unlinking: string): boolean {
  const remaining = [...accountProviderIds];
  const idx = remaining.indexOf(unlinking);
  if (idx >= 0) remaining.splice(idx, 1);
  return remaining.length === 0;
}

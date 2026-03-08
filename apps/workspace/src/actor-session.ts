import {
  actorIdentitySchema,
  defaultLocalActor,
  readActorIdentityFromSearchParams,
  writeActorIdentityToSearchParams,
  type ActorIdentity
} from "@nojv/domain";

export const workspaceActorStorageKey = "nojv.workspace-actor";

function normalizeSearch(search: string) {
  return search.startsWith("?") ? search.slice(1) : search;
}

export function resolveWorkspaceActor(input: { search: string; storedActor?: string | null }) {
  const fromSearch = readActorIdentityFromSearchParams(
    new URLSearchParams(normalizeSearch(input.search))
  );

  if (fromSearch) {
    return fromSearch;
  }

  if (input.storedActor) {
    try {
      const parsed = actorIdentitySchema.safeParse(JSON.parse(input.storedActor) as unknown);

      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      return defaultLocalActor;
    }
  }

  return defaultLocalActor;
}

export function buildWorkspaceActorSearch(search: string, actor: ActorIdentity) {
  const params = writeActorIdentityToSearchParams(
    new URLSearchParams(normalizeSearch(search)),
    actor
  );

  return `?${params.toString()}`;
}

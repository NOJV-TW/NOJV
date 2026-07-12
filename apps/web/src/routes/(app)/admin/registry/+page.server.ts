import { error, fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { readString } from "$lib/server/shared/form-utils";
import {
  deleteManifest,
  getManifestDigestAndSize,
  isRegistryConfigured,
  listRepositories,
  listTags,
} from "$lib/server/registry";
import { auditDomain, registryDomain } from "@nojv/application";

// distribution repository-name grammar and a sha256 manifest digest.
const REPO_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const MANIFEST_DIGEST = /^sha256:[a-f0-9]{64}$/;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  if (actor.platformRole !== "admin") {
    error(403, "Admin access required.");
  }

  if (!isRegistryConfigured()) {
    return { configured: false as const };
  }

  let repoNames: string[];
  try {
    repoNames = await listRepositories();
  } catch {
    return { configured: true as const, repositories: [] };
  }

  const repositories = await Promise.all(
    repoNames.map(async (repo) => {
      try {
        const tagNames = await listTags(repo);
        const tags = await Promise.all(
          tagNames.map(async (tag) => {
            try {
              const { digest, size } = await getManifestDigestAndSize(repo, tag);
              return { tag, digest, size };
            } catch {
              return { tag, digest: null, size: null };
            }
          }),
        );
        return { repo, tags };
      } catch {
        return { repo, tags: [] };
      }
    }),
  );

  return { configured: true as const, repositories };
};

export const actions = {
  deleteTag: withAction(async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") {
      return fail(403, { error: "Admin access required." });
    }
    const formData = await event.request.formData();
    const repo = readString(formData, "repo");
    const digest = readString(formData, "digest");
    const tag = readString(formData, "tag");

    if (!REPO_NAME.test(repo) || !MANIFEST_DIGEST.test(digest)) {
      return fail(400, { error: "Invalid input." });
    }

    await deleteManifest(repo, digest);
    await auditDomain.recordAdminAudit({
      actorId: actor.userId,
      actorName: actor.displayName,
      action: "registry_tag_delete",
      targetType: "registry",
      targetId: repo,
      summary: tag ? `${repo}:${tag}` : `${repo}@${digest}`,
    });

    return { success: true };
  }),

  triggerGc: withAction(async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") {
      return fail(403, { error: "Admin access required." });
    }

    const result = await registryDomain.triggerRegistryGarbageCollect({
      userId: actor.userId,
      platformRole: actor.platformRole,
    });
    await auditDomain.recordAdminAudit({
      actorId: actor.userId,
      actorName: actor.displayName,
      action: "registry_gc",
      targetType: "registry",
      targetId: null,
      summary: result.alreadyRunning ? "already running" : result.workflowId,
    });

    return { success: true, alreadyRunning: result.alreadyRunning };
  }),
} satisfies Actions;

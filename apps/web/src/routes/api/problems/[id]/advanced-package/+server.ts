import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { problemDomain } from "@nojv/application";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { getWebEnv } from "$lib/server/env";

const ADVANCED_PACKAGE_MAX_BYTES = 128 * 1024 * 1024;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  if (!(await problemDomain.canAuthorProblems(actor))) {
    error(403, "Not authorized to edit problems");
  }
  const env = getWebEnv();
  const publishTarget =
    env.EXECUTION_BACKEND === "kubernetes"
      ? env.ADVANCED_IMAGE_REGISTRY
        ? { type: "registry" as const, registryPrefix: env.ADVANCED_IMAGE_REGISTRY }
        : null
      : { type: "tarball" as const };
  if (!publishTarget) {
    error(
      400,
      "Advanced package upload on Kubernetes requires ADVANCED_IMAGE_REGISTRY and Docker-compatible build access in the web runtime.",
    );
  }

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  const formData = await event.request.formData();
  const file = formData.get("package");
  if (!(file instanceof File)) {
    error(400, "No Advanced package ZIP provided.");
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    error(400, "Advanced package must be a .zip file.");
  }
  if (file.size > ADVANCED_PACKAGE_MAX_BYTES) {
    error(400, `Advanced package ZIP is too large (max 128 MB).`);
  }

  try {
    const result = await problemDomain.importAdvancedPackage(
      { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
      problemId,
      Buffer.from(await file.arrayBuffer()),
      { publishTarget },
    );
    return json({
      success: true,
      builtImages: result.builtImages,
      maxScore: result.advancedConfig.maxScore,
      problem: result.problem,
      requiredPaths: result.requiredPaths,
    });
  } catch (err) {
    if (err instanceof problemDomain.AdvancedPackageError) {
      return json({ success: false, issue: err.issue }, { status: 400 });
    }
    throw err;
  }
});

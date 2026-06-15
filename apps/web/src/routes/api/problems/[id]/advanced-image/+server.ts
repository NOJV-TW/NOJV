import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { advancedConfigSchema, type AdvancedConfig } from "@nojv/core";
import { canCreateProblem, problemDomain } from "@nojv/application";
import { createLogger } from "$lib/server/logger";
import {
  deleteAdvancedImageTarball,
  uploadAdvancedImageTarball,
  type AdvancedImageRole,
} from "$lib/server/storage/advanced-image";

const logger = createLogger("advanced-image-upload");

const { updateProblemRecord } = problemDomain;

const ADVANCED_IMAGE_MAX_BYTES_PER_ROLE = 64 * 1024 * 1024;

const ROLES = new Set<AdvancedImageRole>(["run", "grade", "service"]);

function looksLikeTar(buffer: Buffer): boolean {
  if (buffer.length < 512) return false;
  const magic = buffer.subarray(257, 262).toString("utf8");
  return magic === "ustar";
}

function slotKey(config: AdvancedConfig | null, role: AdvancedImageRole): string | null {
  if (!config) return null;
  if (role === "run") return config.run.imageSource === "tarball" ? config.run.imageRef : null;
  if (role === "grade") {
    return config.grade.imageSource === "tarball" ? config.grade.imageRef : null;
  }
  return config.network.service?.imageSource === "tarball"
    ? config.network.service.imageRef
    : null;
}

function mergeSlot(
  config: AdvancedConfig | null,
  role: AdvancedImageRole,
  image: { imageRef: string; imageSource: "tarball" },
): unknown {
  if (role === "run") {
    return { ...config, run: image };
  }
  if (role === "grade") {
    return { ...config, grade: image };
  }
  return {
    ...config,
    network: { ...config?.network, mode: "service", service: image, allowlist: undefined },
  };
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (!canCreateProblem(actor.platformRole, actor.emailVerified)) {
    error(403, "Not authorized to edit problems");
  }

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
  );

  const formData = await event.request.formData();

  const rawRole = formData.get("role");
  const role = typeof rawRole === "string" ? rawRole : "";
  if (!ROLES.has(role as AdvancedImageRole)) {
    error(400, "role must be one of run|grade|service");
  }
  const imageRole = role as AdvancedImageRole;

  const file = formData.get("tarball");
  if (!(file instanceof File)) {
    error(400, "No tarball provided");
  }
  if (file.size > ADVANCED_IMAGE_MAX_BYTES_PER_ROLE) {
    error(
      400,
      `Tarball too large (max ${String(ADVANCED_IMAGE_MAX_BYTES_PER_ROLE / (1024 * 1024))} MB per role)`,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!looksLikeTar(buffer)) {
    error(400, "File does not look like a tar archive");
  }

  const existing = await problemDomain.getProblemRowById(problemId);
  const existingConfig = advancedConfigSchema.safeParse(existing?.advancedConfig).data ?? null;
  const previousKey = slotKey(existingConfig, imageRole);

  const key = await uploadAdvancedImageTarball(problemId, imageRole, buffer);
  const image = { imageRef: key, imageSource: "tarball" as const };

  const merged = advancedConfigSchema.safeParse(mergeSlot(existingConfig, imageRole, image));
  let persisted = false;
  if (merged.success) {
    await updateProblemRecord(
      { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
      problemId,
      { type: "special_env", advancedConfig: merged.data },
    );
    persisted = true;
  }

  if (persisted && previousKey && previousKey !== key) {
    try {
      await deleteAdvancedImageTarball(previousKey);
    } catch (err) {
      logger.warn("Failed to delete superseded advanced-image tarball", {
        problemId,
        role: imageRole,
        previousKey,
        err,
      });
    }
  }

  return json({ key, role: imageRole, persisted });
});

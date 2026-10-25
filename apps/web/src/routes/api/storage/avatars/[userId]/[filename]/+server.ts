import type { RequestHandler } from "./$types";

import { storedImageResponse } from "#lib/server/storage/image-response.js";
import { readAvatar } from "#lib/server/storage/avatar.js";

export const GET: RequestHandler = ({ params }) =>
  storedImageResponse(
    async () => ({
      body: await readAvatar(params.userId, params.filename),
      contentType: "image/webp",
    }),
    "Avatar not found",
  );

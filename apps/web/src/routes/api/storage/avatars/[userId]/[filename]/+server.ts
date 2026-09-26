import type { RequestHandler } from "./$types";

import { storedImageResponse } from "$lib/server/storage/image-response";
import { readAvatar } from "$lib/server/storage/avatar";

export const GET: RequestHandler = ({ params }) =>
  storedImageResponse(
    async () => ({
      body: await readAvatar(params.userId, params.filename),
      contentType: "image/webp",
    }),
    "Avatar not found",
  );

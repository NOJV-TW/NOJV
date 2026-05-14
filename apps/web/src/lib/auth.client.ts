import { createAuthClient } from "better-auth/svelte";
import { inferAdditionalFields, usernameClient } from "better-auth/client/plugins";

import type { getAuth } from "$lib/auth.server";

export const authClient = createAuthClient({
  plugins: [usernameClient(), inferAdditionalFields<ReturnType<typeof getAuth>>()],
});

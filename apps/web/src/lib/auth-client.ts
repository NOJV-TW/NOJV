import { createAuthClient } from "better-auth/svelte";
import { inferAdditionalFields, usernameClient } from "better-auth/client/plugins";

import type { auth } from "$lib/auth";

export const authClient = createAuthClient({
  plugins: [usernameClient(), inferAdditionalFields<typeof auth>()]
});

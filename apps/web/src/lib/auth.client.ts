import { createAuthClient } from "better-auth/svelte";
import {
  inferAdditionalFields,
  twoFactorClient,
  usernameClient,
} from "better-auth/client/plugins";

import type { getAuth } from "$lib/auth.server";

export const authClient = createAuthClient({
  plugins: [
    usernameClient(),
    twoFactorClient(),
    inferAdditionalFields<ReturnType<typeof getAuth>>(),
  ],
});

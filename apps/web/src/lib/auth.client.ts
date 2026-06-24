import { passkeyClient } from "@better-auth/passkey/client";
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
    passkeyClient(),
    inferAdditionalFields<ReturnType<typeof getAuth>>(),
  ],
});

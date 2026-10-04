import { superForm, type FormOptions, type SuperValidated } from "sveltekit-superforms";

import type { FormMessage } from "$lib/types/form-message";
import { formlessResultMessage } from "$lib/utils/actions";

export function appSuperForm<T extends Record<string, unknown>>(
  form: SuperValidated<T, FormMessage>,
  options: FormOptions<T, FormMessage> = {},
) {
  const created = superForm<T, FormMessage>(form, {
    ...options,
    async onResult(event) {
      const text = formlessResultMessage(event.result);
      if (text !== null) {
        event.cancel();
        created.message.set({ kind: "error", text });
        return;
      }
      await options.onResult?.(event);
    },
  });
  return created;
}

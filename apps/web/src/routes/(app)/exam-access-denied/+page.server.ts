import { error } from "@sveltejs/kit";
import { m } from "#lib/paraglide/messages.js";

export const load = () => {
  error(403, m.examShell_ipBlocked());
};

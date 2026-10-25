import { building } from "$app/env";
import { validateMailerConfig } from "@nojv/mailer";

if (!building) {
  validateMailerConfig();
}

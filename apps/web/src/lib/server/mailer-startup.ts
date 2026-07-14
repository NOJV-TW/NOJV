import { building } from "$app/environment";
import { validateMailerConfig } from "@nojv/mailer";

if (!building) {
  validateMailerConfig();
}

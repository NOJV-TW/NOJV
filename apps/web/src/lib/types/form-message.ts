/**
 * Shared discriminated union for superForm `message()` payloads.
 * Lets a single superForm's `$formMessage` represent both success banners
 * and server-side failures, so templates can distinguish them by `kind`.
 */
export type FormMessage = {
  kind: "success" | "error";
  text: string;
};

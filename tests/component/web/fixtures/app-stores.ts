import { readable, writable } from "svelte/store";

export const page = writable({
  status: 200,
  data: {},
  form: null,
  url: new URL("http://localhost"),
});
export const navigating = writable(null);
export const updated = readable(false);

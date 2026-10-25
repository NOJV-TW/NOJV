export const page = $state({
  status: 200,
  data: {} as Record<string, unknown>,
  form: null as unknown,
  url: new URL("http://localhost/assignments/assignment-A"),
});
export const navigating = $state({ to: null, from: null });
export const updated = $state({ current: false });

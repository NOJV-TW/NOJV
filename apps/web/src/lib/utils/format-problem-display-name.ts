import { m } from "$lib/paraglide/messages.js";

export function formatProblemDisplayName(input: {
  displayId: number | null;
  title: string;
}): string {
  const prefix =
    input.displayId == null
      ? m.common_problemDraft()
      : m.common_problemDisplayId({ id: input.displayId });
  return `${prefix} ${input.title}`;
}

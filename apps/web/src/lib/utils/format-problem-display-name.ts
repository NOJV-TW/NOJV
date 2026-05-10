import { m } from "$lib/paraglide/messages.js";

export function formatProblemDisplayName(input: { displayId: number; title: string }): string {
  return `${m.common_problemDisplayId({ id: input.displayId })} ${input.title}`;
}

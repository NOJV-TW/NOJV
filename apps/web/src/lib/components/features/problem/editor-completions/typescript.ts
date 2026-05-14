import type { CompletionEntry } from "./index";
import { jsCompletions } from "./javascript";

export const tsCompletions: CompletionEntry[] = [...jsCompletions];

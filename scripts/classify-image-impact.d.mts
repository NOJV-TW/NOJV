export interface ImageImpact {
  image: "web" | "worker" | "migrator" | "sandbox";
  dockerfile: string;
  tag: string;
}

export function classifyImageImpact(changedPaths: string[]): ImageImpact[];

export function changedPathsBetween(baseSha: string, headSha: string, cwd?: string): string[];

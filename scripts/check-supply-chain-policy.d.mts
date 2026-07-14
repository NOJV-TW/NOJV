export interface SupplyChainViolation {
  file: string;
  line: number;
  message: string;
}

export function checkSupplyChainFile(file: string, content: string): SupplyChainViolation[];

export function scanSupplyChainPolicy(root?: string): SupplyChainViolation[];

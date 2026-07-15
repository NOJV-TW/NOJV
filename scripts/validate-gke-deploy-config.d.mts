export interface CloudArmorRule {
  priority: number;
  action: string;
  preview?: boolean;
  match?: { config?: { srcIpRanges?: string[] } };
}

export interface GkeDeployConfigInput {
  projectId: string;
  region: string;
  publicHost: string;
  registryHost: string;
  tlsSecretName: string;
  edgeSecurityPolicy: string;
  cloudsqlConnectionName: string;
  actualCloudsqlConnectionName: string;
  cloudsqlIp: string;
  redisIp: string;
  clusterMasterCidr: string;
  kubernetesServiceIp: string;
  cloudflareCidrs: string[];
  edgeRules: CloudArmorRule[];
}

export interface VerifiedGkeNetworkConfig {
  redisCidr: string;
  cloudsqlCidr: string;
  googleApisCidrs: string[];
  apiServerCidrs: string[];
}

export function validateGkeDeployConfig(input: GkeDeployConfigInput): VerifiedGkeNetworkConfig;

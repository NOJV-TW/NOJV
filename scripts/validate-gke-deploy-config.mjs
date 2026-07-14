#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

const GOOGLE_APIS_CIDRS = ["199.36.153.4/30", "199.36.153.8/30"];
const DEFAULT_RULE_PRIORITY = 2_147_483_647;
const DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u;
const DNS_NAME = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/u;

function requireString(label, value) {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    throw new Error(`${label} is required and must not contain surrounding whitespace`);
  }
  return value;
}

function rejectPlaceholder(label, value) {
  if (/PROJECT_ID|REGION|INSTANCE|example\.com/iu.test(value)) {
    throw new Error(`${label} contains an unresolved placeholder`);
  }
}

function requireDnsName(label, value) {
  requireString(label, value);
  rejectPlaceholder(label, value);
  if (
    value.length > 253 ||
    !DNS_NAME.test(value) ||
    value.split(".").some((part) => !DNS_LABEL.test(part))
  ) {
    throw new Error(`${label} must be a lowercase DNS name`);
  }
}

function parseCidr(label, cidr, allowedFamilies = [4, 6]) {
  requireString(label, cidr);
  const separator = cidr.lastIndexOf("/");
  const address = separator > 0 ? cidr.slice(0, separator) : "";
  const prefixText = separator > 0 ? cidr.slice(separator + 1) : "";
  const family = isIP(address);
  const prefix = Number(prefixText);
  const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : 0;
  if (
    !allowedFamilies.includes(family) ||
    !/^(?:0|[1-9][0-9]{0,2})$/u.test(prefixText) ||
    !Number.isInteger(prefix) ||
    prefix <= 0 ||
    prefix > maxPrefix
  ) {
    throw new Error(`${label} must be a non-global IP CIDR`);
  }
  return { address, family, prefix };
}

function requirePrivateIpv4(label, value) {
  requireString(label, value);
  if (isIP(value) !== 4) throw new Error(`${label} must be a private IPv4 address`);
  const [first, second] = value.split(".").map(Number);
  const privateAddress =
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
  if (!privateAddress) throw new Error(`${label} must be a private IPv4 address`);
}

function exactStringSet(label, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (
    actualSet.size !== actual.length ||
    expectedSet.size !== expected.length ||
    actualSet.size !== expectedSet.size ||
    [...expectedSet].some((value) => !actualSet.has(value))
  ) {
    throw new Error(label);
  }
}

function validateEdgeRules(rules, cloudflareCidrs) {
  if (!Array.isArray(rules) || rules.length < 2) {
    throw new Error(
      "Cloud Armor policy must contain Cloudflare allow rules and a default deny",
    );
  }
  if (!Array.isArray(cloudflareCidrs) || cloudflareCidrs.length === 0) {
    throw new Error("committed Cloudflare CIDRs are required");
  }
  for (const cidr of cloudflareCidrs) parseCidr("Cloudflare CIDR", cidr);

  const allowedCidrs = [];
  let defaultDenyCount = 0;
  for (const rule of rules) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error("Cloud Armor policy returned an invalid rule");
    }
    if (rule.preview === true) throw new Error("Cloud Armor rules must not be in preview");
    const ranges = rule.match?.config?.srcIpRanges;
    if (!Array.isArray(ranges) || !ranges.every((range) => typeof range === "string")) {
      throw new Error("Cloud Armor rules must use explicit source IP ranges");
    }
    if (rule.priority === DEFAULT_RULE_PRIORITY) {
      if (
        !/^deny\((?:403|404)\)$/u.test(rule.action ?? "") ||
        ranges.length !== 1 ||
        ranges[0] !== "*"
      ) {
        throw new Error("Cloud Armor policy must have one enforced default deny");
      }
      defaultDenyCount += 1;
      continue;
    }
    if (rule.action !== "allow") {
      throw new Error(
        "Cloud Armor non-default rules must only allow committed Cloudflare CIDRs",
      );
    }
    for (const range of ranges) {
      parseCidr("Cloud Armor source range", range);
      allowedCidrs.push(range);
    }
  }
  if (defaultDenyCount !== 1) {
    throw new Error("Cloud Armor policy must have exactly one enforced default deny");
  }
  exactStringSet(
    "Cloud Armor policy must allow exactly the committed Cloudflare CIDRs",
    allowedCidrs,
    cloudflareCidrs,
  );
}

export function validateGkeDeployConfig(input) {
  const projectId = requireString("Google Cloud project ID", input.projectId);
  rejectPlaceholder("Google Cloud project ID", projectId);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
    throw new Error("Google Cloud project ID is invalid");
  }

  const region = requireString("Google Cloud region", input.region);
  rejectPlaceholder("Google Cloud region", region);
  if (!/^[a-z]+-[a-z]+[0-9]$/u.test(region)) throw new Error("Google Cloud region is invalid");

  requireDnsName("public host", input.publicHost);
  requireDnsName("registry host", input.registryHost);
  requireDnsName("TLS Secret name", input.tlsSecretName);
  requireDnsName("Cloud Armor security policy name", input.edgeSecurityPolicy);
  if (input.publicHost === input.registryHost) {
    throw new Error("public host and registry host must be distinct");
  }

  const connectionName = requireString(
    "Cloud SQL connection name",
    input.cloudsqlConnectionName,
  );
  rejectPlaceholder("Cloud SQL connection name", connectionName);
  const connectionParts = connectionName.split(":");
  if (
    connectionParts.length !== 3 ||
    connectionParts[0] !== projectId ||
    connectionParts[1] !== region ||
    !DNS_LABEL.test(connectionParts[2] ?? "")
  ) {
    throw new Error("Cloud SQL connection name must match PROJECT_ID:REGION:INSTANCE");
  }
  if (input.actualCloudsqlConnectionName !== connectionName) {
    throw new Error("Cloud SQL identity does not match the requested connection name");
  }

  requirePrivateIpv4("Cloud SQL IP", input.cloudsqlIp);
  requirePrivateIpv4("Redis IP", input.redisIp);
  const masterCidr = parseCidr("cluster master CIDR", input.clusterMasterCidr, [4]);
  if (!(
    masterCidr.address.startsWith("10.") ||
    /^172\.(?:1[6-9]|2[0-9]|3[01])\./u.test(masterCidr.address) ||
    masterCidr.address.startsWith("192.168.")
  )) {
    throw new Error("cluster master CIDR must be a private IPv4 range");
  }
  requirePrivateIpv4("Kubernetes Service IP", input.kubernetesServiceIp);

  validateEdgeRules(input.edgeRules, input.cloudflareCidrs);

  return {
    redisCidr: `${input.redisIp}/32`,
    cloudsqlCidr: `${input.cloudsqlIp}/32`,
    googleApisCidrs: [...GOOGLE_APIS_CIDRS],
    apiServerCidrs: [`${input.kubernetesServiceIp}/32`, input.clusterMasterCidr],
  };
}

function lines(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function validateFromEnvironment() {
  const cidrFile = requireString("CLOUDFLARE_CIDRS_FILE", process.env.CLOUDFLARE_CIDRS_FILE);
  const edgeRulesJson = requireString(
    "EDGE_SECURITY_POLICY_RULES_JSON",
    process.env.EDGE_SECURITY_POLICY_RULES_JSON,
  );
  let edgeRules;
  try {
    edgeRules = JSON.parse(edgeRulesJson);
  } catch {
    throw new Error("EDGE_SECURITY_POLICY_RULES_JSON must be valid JSON");
  }
  const output = validateGkeDeployConfig({
    projectId: process.env.PROJECT_ID,
    region: process.env.REGION,
    publicHost: process.env.PUBLIC_HOST,
    registryHost: process.env.REGISTRY_HOST,
    tlsSecretName: process.env.TLS_SECRET_NAME,
    edgeSecurityPolicy: process.env.EDGE_SECURITY_POLICY,
    cloudsqlConnectionName: process.env.CLOUDSQL_INSTANCE_CONNECTION_NAME,
    actualCloudsqlConnectionName: process.env.ACTUAL_CLOUDSQL_CONNECTION_NAME,
    cloudsqlIp: process.env.ACTUAL_CLOUDSQL_IP,
    redisIp: process.env.ACTUAL_REDIS_IP,
    clusterMasterCidr: process.env.CLUSTER_MASTER_CIDR,
    kubernetesServiceIp: process.env.KUBERNETES_SERVICE_IP,
    cloudflareCidrs: lines(cidrFile),
    edgeRules,
  });
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateFromEnvironment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

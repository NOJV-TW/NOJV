export const SANDBOX_NODE_SELECTOR = { "nojv-role": "sandbox" };

export const SANDBOX_TOLERATIONS = [
  { key: "nojv-role", operator: "Equal", value: "sandbox", effect: "NoSchedule" },
];

const NONROOT_SECCOMP = {
  runAsNonRoot: true,
  seccompProfile: { type: "RuntimeDefault" },
};

export const SANDBOX_POD_SECURITY_CONTEXT = {
  runAsUser: 10001,
  runAsGroup: 10001,
  ...NONROOT_SECCOMP,
};

export const SANDBOX_POD_SECURITY_CONTEXT_WITH_FSGROUP = {
  runAsUser: 10001,
  runAsGroup: 10001,
  fsGroup: 10001,
  ...NONROOT_SECCOMP,
};

export const UNPINNED_POD_SECURITY_CONTEXT = { ...NONROOT_SECCOMP };

const HARDENED_CONTAINER_BASE = {
  allowPrivilegeEscalation: false,
  capabilities: { drop: ["ALL"] },
  readOnlyRootFilesystem: true,
  runAsNonRoot: true,
};

export const HARDENED_CONTAINER_SECURITY_CONTEXT = { ...HARDENED_CONTAINER_BASE };

export const HARDENED_CONTAINER_SECURITY_CONTEXT_PINNED = {
  ...HARDENED_CONTAINER_BASE,
  runAsUser: 10001,
  runAsGroup: 10001,
};

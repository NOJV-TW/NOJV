export const keys = {
  adminDashboard: () => "nojv:cache:admin-dashboard",

  scoreboardUpdateThrottle: (contestId: string) => `nojv:sb-throttle:${contestId}`,
  scoreboardCache: (contestId: string, variant: "live" | "public") =>
    `nojv:sb-cache:${contestId}:${variant}`,
  scoreboardLock: (contestId: string, variant: "live" | "public") =>
    `nojv:sb-lock:${contestId}:${variant}`,

  userChannel: (userId: string) => `nojv:user:${userId}`,
  notificationChannel: (userId: string) => `nojv:notification:${userId}`,
  contestChannel: (contestId: string) => `nojv:contest:${contestId}`,
  clarificationChannel: (contextType: string, contextId: string) =>
    `nojv:clarification:${contextType}:${contextId}`,
  clarificationStaffChannel: (contextType: string, contextId: string) =>
    `nojv:clarification-staff:${contextType}:${contextId}`,

  apiTokenStepUp: (userId: string) => `nojv:apitoken:stepup:${userId}`,
  adminSessionMfa: (sessionId: string) => `nojv:admin:mfa:${sessionId}`,
  adminMode: (sessionId: string) => `nojv:admin:mode:${sessionId}`,
  twoFactorEnrollConfirm: (tokenHash: string) => `nojv:2fa:enroll-confirm:${tokenHash}`,
  twoFactorEnrollConfirmed: (userId: string) => `nojv:2fa:enroll-confirmed:${userId}`,
  twoFactorTotpSeen: (userId: string, code: string) => `nojv:2fa:totp-seen:${userId}:${code}`,
} as const;

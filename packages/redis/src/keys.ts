export const keys = {
  adminDashboard: () => "nojv:cache:admin-dashboard",

  scoreboardUpdateThrottle: (contestId: string) => `nojv:sb-throttle:${contestId}`,
  scoreboardCache: (contestId: string, variant: "live" | "public") =>
    `nojv:sb-cache:${contestId}:${variant}`,
  scoreboardChartCache: (contestId: string, variant: "live" | "public", topN: number) =>
    `nojv:sb-chart-cache:${contestId}:${variant}:${String(topN)}`,
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
  tokenPageMfa: (sessionId: string) => `nojv:apitoken:page-mfa:${sessionId}`,
  adminSessionMfa: (sessionId: string) => `nojv:admin:mfa:${sessionId}`,
  adminMode: (sessionId: string) => `nojv:admin:mode:${sessionId}`,
  twoFactorTotpSeen: (userId: string, code: string) => `nojv:2fa:totp-seen:${userId}:${code}`,
  twoFactorActivationOtp: (userId: string) => `nojv:2fa:activation-otp:${userId}`,
  twoFactorActivationOtpAttempts: (userId: string) =>
    `nojv:2fa:activation-otp-attempts:${userId}`,
  twoFactorChangeGrant: (userId: string) => `nojv:2fa:change-grant:${userId}`,
} as const;

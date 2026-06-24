export const keys = {
  adminDashboard: () => "nojv:cache:admin-dashboard",

  scoreboardUpdateThrottle: (contestId: string) => `nojv:sb-throttle:${contestId}`,
  scoreboardCache: (contestId: string, variant: "live" | "public") =>
    `nojv:sb-cache:${contestId}:${variant}`,

  userChannel: (userId: string) => `nojv:user:${userId}`,
  notificationChannel: (userId: string) => `nojv:notification:${userId}`,
  contestChannel: (contestId: string) => `nojv:contest:${contestId}`,
  clarificationChannel: (contextType: string, contextId: string) =>
    `nojv:clarification:${contextType}:${contextId}`,

  apiTokenStepUp: (userId: string) => `nojv:apitoken:stepup:${userId}`,
  twoFactorEnrollOtp: (userId: string) => `nojv:2fa:enroll-otp:${userId}`,
  twoFactorTotpSeen: (userId: string, code: string) => `nojv:2fa:totp-seen:${userId}:${code}`,
} as const;

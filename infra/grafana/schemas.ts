import { z } from "zod";

export const DashboardSchema = z
  .object({
    uid: z.string().min(1),
    title: z.string().min(1),
    schemaVersion: z.number().int().nonnegative(),
    panels: z.array(z.unknown()),
  })
  .passthrough();

export type DashboardModel = z.infer<typeof DashboardSchema>;

export const AlertRuleDefSchema = z.object({
  uid: z.string().min(1),
  title: z.string().min(1),
  slo: z.string().min(1),
  expr: z.string().min(1),
  threshold: z.number(),
  for: z.string().min(1),
  severity: z.string().min(1),
  summary: z.string().min(1),
  noDataState: z.enum(["OK", "Alerting", "NoData", "KeepLast"]).optional(),
});

export const AlertRuleDefsSchema = z.array(AlertRuleDefSchema);

export type AlertRuleDef = z.infer<typeof AlertRuleDefSchema>;

export const RequiredEnvSchema = z.object({
  GRAFANA_STACK_URL: z.string().url(),
  GRAFANA_SA_TOKEN: z.string().min(1),
});

export const OptionalEnvSchema = z.object({
  GRAFANA_ALERT_FOLDER_UID: z.string().min(1).optional(),
  GRAFANA_PROM_DATASOURCE_UID: z.string().min(1).optional(),
  GRAFANA_ALERT_EMAIL: z.string().email().optional(),
});

export type RequiredEnv = z.infer<typeof RequiredEnvSchema>;
export type OptionalEnv = z.infer<typeof OptionalEnvSchema>;

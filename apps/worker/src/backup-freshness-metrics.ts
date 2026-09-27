import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";
import { metrics, type ObservableResult } from "@opentelemetry/api";

import { createLogger } from "./logger.js";

const require = createRequire(import.meta.url);
const logger = createLogger("backup-freshness-metrics");

export const BACKUP_LAST_SUCCESS_METRIC = "nojv_backup_last_success_timestamp_seconds";
const BACKUP_CRONJOB_SELECTOR = "app.kubernetes.io/component in (postgres-dump,minio-backup)";

export interface BackupCronJobStatus {
  component: string;
  lastSuccessSeconds: number;
}

export function toBackupCronJobStatus(cronJob: k8s.V1CronJob): BackupCronJobStatus | null {
  const component = cronJob.metadata?.labels?.["app.kubernetes.io/component"];
  const since = cronJob.status?.lastSuccessfulTime ?? cronJob.metadata?.creationTimestamp;
  if (!component || !since) return null;
  return { component, lastSuccessSeconds: Math.floor(new Date(since).getTime() / 1000) };
}

export function kubernetesBackupCronJobReader(
  namespace: string,
): () => Promise<BackupCronJobStatus[]> {
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  const kc = new k8sLib.KubeConfig();
  kc.loadFromCluster();
  const batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
  return async () => {
    const list = await batchApi.listNamespacedCronJob({
      namespace,
      labelSelector: BACKUP_CRONJOB_SELECTOR,
    });
    return list.items.flatMap((item) => toBackupCronJobStatus(item) ?? []);
  };
}

export function startBackupFreshnessMetrics(
  readStatuses: () => Promise<BackupCronJobStatus[]>,
): () => void {
  const gauge = metrics
    .getMeter("@nojv/backup-freshness", "0.1.0")
    .createObservableGauge(BACKUP_LAST_SUCCESS_METRIC);
  const observe = async (result: ObservableResult) => {
    try {
      for (const status of await readStatuses()) {
        result.observe(status.lastSuccessSeconds, { component: status.component });
      }
    } catch (error) {
      logger.warn("Backup CronJob status read failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  gauge.addCallback(observe);
  return () => gauge.removeCallback(observe);
}

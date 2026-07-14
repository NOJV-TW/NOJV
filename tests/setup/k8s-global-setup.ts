import { assertK8sIntegrationOptIn } from "./k8s-integration-target";

export default function k8sGlobalSetup(): void {
  assertK8sIntegrationOptIn(process.env);
}

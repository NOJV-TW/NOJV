{{/*
Expand the name of the chart.
*/}}
{{- define "nojv.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Truncated at 63 chars (DNS limit). If release name contains chart name it is used as-is.
*/}}
{{- define "nojv.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version label value.
*/}}
{{- define "nojv.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "nojv.labels" -}}
helm.sh/chart: {{ include "nojv.chart" . }}
{{ include "nojv.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: nojv
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "nojv.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nojv.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
The application namespace (where web + workers live).
*/}}
{{- define "nojv.namespace" -}}
{{- default "nojv" .Values.namespace }}
{{- end }}

{{/*
The sandbox namespace (where per-submission Jobs run).
*/}}
{{- define "nojv.sandboxNamespace" -}}
{{- default "nojv-sandbox" .Values.sandboxNamespace }}
{{- end }}

{{/*
Fully-qualified image reference for a given component.
Usage: {{ include "nojv.image" (dict "root" $ "component" "web") }}
Looks up .Values.image.repositories.<component> for the path suffix.
*/}}
{{- define "nojv.image" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $img := $root.Values.image -}}
{{- $repo := index $img.repositories $component -}}
{{- $registry := $img.registry -}}
{{- $prefix := $img.repositoryPrefix -}}
{{- $tag := default $root.Chart.AppVersion $img.tag -}}
{{- $name := $repo -}}
{{- if $prefix -}}
{{- $name = printf "%s/%s" $prefix $name -}}
{{- end -}}
{{- if $registry -}}
{{- $name = printf "%s/%s" $registry $name -}}
{{- end -}}
{{- if $img.allowUnpinnedLocalBuilds -}}
{{- if or $registry $prefix -}}
{{- fail "image.allowUnpinnedLocalBuilds requires empty image.registry and image.repositoryPrefix" -}}
{{- end -}}
{{- if ne $tag "local" -}}
{{- fail "image.allowUnpinnedLocalBuilds requires image.tag=local" -}}
{{- end -}}
{{- printf "%s:%s" $name $tag -}}
{{- else -}}
{{- $digest := required (printf "image.digests.%s is required and must be registry-verified" $component) (index $img.digests $component) -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $digest) -}}
{{- fail (printf "image.digests.%s must be sha256:<64 lowercase hex characters>" $component) -}}
{{- end -}}
{{- printf "%s:%s@%s" $name $tag $digest -}}
{{- end -}}
{{- end }}

{{/*
Name of the existing runtime secret holding DATABASE_URL, REDIS_URL, S3 and GRAFANA keys.
*/}}
{{- define "nojv.runtimeSecretName" -}}
{{- .Values.secrets.runtimeSecretName }}
{{- end }}

{{/*
Name of the CloudNativePG Cluster CR.
*/}}
{{- define "nojv.cnpgClusterName" -}}
{{- printf "%s-pg" (include "nojv.fullname" .) }}
{{- end }}

{{/*
DATABASE_URL env var entry for a worker/web container, derived from postgres.mode:
  - cnpg     -> read from the runtime secret (operator-managed -app secret recommended,
               but we keep it in the runtime secret for a single source of truth; the
               default points at the CNPG -rw service, see values comments).
  - cloudsql -> 127.0.0.1:5432 via the cloudsql-proxy sidecar (from the runtime secret).
  - external -> from the runtime secret as-is.
In every mode the literal connection string lives in the runtime secret (never templated
here) so credentials stay out of the rendered manifests.
*/}}
{{- define "nojv.databaseUrlEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "nojv.runtimeSecretName" . }}
      key: DATABASE_URL
{{- end }}

{{- define "inorch-tmf-proxy.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "inorch-tmf-proxy.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end -}}

{{- define "inorch-tmf-proxy.namespace" -}}
{{- if .Values.namespaceOverride }}
{{- .Values.namespaceOverride }}
{{- else }}
{{- .Release.Namespace }}
{{- end }}
{{- end -}}

{{- define "inorch-tmf-proxy.serviceAccountName" -}}
  {{- if .Values.serviceAccount.create -}}
    {{- if .Values.serviceAccount.name -}}
{{- .Values.serviceAccount.name -}}
    {{- else -}}
{{- include "inorch-tmf-proxy.fullname" . -}}
    {{- end -}}
  {{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
  {{- end -}}
{{- end -}}


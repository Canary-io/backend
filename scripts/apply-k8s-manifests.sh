#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$ROOT_DIR/k8s"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required but was not found in PATH" >&2
  exit 1
fi

if [[ "${1:-}" == "--help" ]]; then
  echo "Usage: $0 [kubeconfig-path]"
  echo
  echo "Applies all Kubernetes manifests in $K8S_DIR."
  echo "If a kubeconfig path is provided, it will be exported as KUBECONFIG."
  exit 0
fi

if [[ -n "${1:-}" ]]; then
  export KUBECONFIG="$1"
fi

manifests=(
  "$K8S_DIR/docker-registry-creds-secret.yaml"
  "$K8S_DIR/helm-creds-secret.yaml"
  "$K8S_DIR/repo-store-s3-secret.yaml"
  "$K8S_DIR/argo-rollouts-role.yaml"
  "$K8S_DIR/argo-workflow-role.yaml"
)

for manifest in "${manifests[@]}"; do
  if [[ ! -f "$manifest" ]]; then
    echo "Missing manifest: $manifest" >&2
    exit 1
  fi
done

for manifest in "${manifests[@]}"; do
  echo "Applying $(basename "$manifest")"
  kubectl apply -f "$manifest"
done

echo "All Kubernetes manifests applied successfully."

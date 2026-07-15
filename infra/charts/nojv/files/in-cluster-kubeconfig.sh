KUBECONFIG="${TMPDIR:-/tmp}/kubeconfig"
export KUBECONFIG

cat > "$KUBECONFIG" <<'EOF'
apiVersion: v1
kind: Config
clusters:
  - name: in-cluster
    cluster:
      certificate-authority: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
      server: https://kubernetes.default.svc
contexts:
  - name: in-cluster
    context:
      cluster: in-cluster
      user: service-account
current-context: in-cluster
users:
  - name: service-account
    user:
      tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
EOF

chmod 600 "$KUBECONFIG"

#!/usr/bin/env bash
# Waits for first boot (cloud-init) to finish, then says what the VM has. Prints one line of JSON.
# Exit 3: first boot ran but did not finish (no ready marker).
set -uo pipefail
cloud-init status --wait >/dev/null 2>&1 || true
if [ ! -f /var/lib/noobly/ready ]; then
  echo '{"ready":false}'
  exit 3
fi
docker_version=""
if command -v docker >/dev/null 2>&1; then
  docker_version=$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)
fi
printf '{"ready":true,"docker":"%s"}\n' "$docker_version"

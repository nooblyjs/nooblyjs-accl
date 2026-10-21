#!/usr/bin/env bash
# Memory, disk and uptime of the VM, as one line of JSON (architecture.md §9, "VM health"). Reads only.
set -euo pipefail
mem_total=$(free -b | awk '/^Mem:/ {print $2}')
mem_used=$(free -b | awk '/^Mem:/ {print $3}')
read -r disk_total disk_used < <(df -B1 --output=size,used / | tail -1)
uptime_s=$(cut -d' ' -f1 /proc/uptime | cut -d. -f1)
printf '{"memory":{"totalBytes":%s,"usedBytes":%s},"disk":{"totalBytes":%s,"usedBytes":%s},"uptimeSeconds":%s}\n' \
  "$mem_total" "$mem_used" "$disk_total" "$disk_used" "$uptime_s"

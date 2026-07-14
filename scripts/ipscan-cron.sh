#!/usr/bin/env bash
# Draait op de Proxmox 1 host zelf (niet in de container — geen fysieke LAN-toegang
# vanuit het Docker-netwerk t2_proxy). Schrijft data/ipscan.json, dat de
# infra-dashboard container read-only inleest.
set -euo pipefail

SUBNET="${IPSCAN_SUBNET:-192.168.0.0/24}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${IPSCAN_OUT_DIR:-$SCRIPT_DIR/../data}"
OUT_FILE="$OUT_DIR/ipscan.json"

command -v nmap >/dev/null || { echo "nmap niet gevonden" >&2; exit 1; }
command -v jq   >/dev/null || { echo "jq niet gevonden (apt install -y jq)" >&2; exit 1; }

mkdir -p "$OUT_DIR"

TMP_TSV="$(mktemp)"
trap 'rm -f "$TMP_TSV"' EXIT

nmap -sn -oG - "$SUBNET" \
  | grep 'Status: Up' \
  | sed -E 's/^Host: ([0-9.]+) \(([^)]*)\).*/\1\t\2/' \
  > "$TMP_TSV"

SCANNED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -Rn --arg scanned_at "$SCANNED_AT" '
  [inputs | select(length > 0) | split("\t") |
    {ip: .[0], hostname: ((.[1] // "") | if . == "" then null else . end)}] as $hosts
  | {scanned_at: $scanned_at, hosts: $hosts}
' "$TMP_TSV" > "$OUT_FILE.tmp"

mv "$OUT_FILE.tmp" "$OUT_FILE"

# Infra Dashboard

Minimal status page for home infrastructure. Pulls data from Healthchecks.io, Uptime Kuma, Zabbix and custom APIs.

## Installation

```bash
cp config.example.json config.json   # adjust to your setup
cp .env.example .env                 # fill in API keys
docker compose up -d --build
```

Available on port 3000. Changes to `config.json` are picked up without restart.

For Traefik, copy the override example and adjust the domain:

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
```

## Environment variables

Create a `.env` file (see `.env.example`):

| Variable | Description |
|----------|-------------|
| `HC_API_KEY` | Healthchecks.io API key |
| `ZABBIX_TOKEN` | Zabbix API token |
| `PORT` | Listen port (default: 3000) |

---

## config.json

### Global Zabbix configuration

```json
{
  "zabbix": {
    "apiUrl": "http://zabbix.example.com/zabbix/api_jsonrpc.php"
  },
  "sections": [ ... ]
}
```

The Zabbix token is read from the `ZABBIX_TOKEN` environment variable.

### Item types

#### `healthchecks`

```json
{
  "type": "healthchecks",
  "label": "Proxmox1",
  "uuid": "8e2f29ff-...",
  "status_labels": { "up": "OK", "down": "Failed" }
}
```

#### `kuma`

Fetches all monitors from an Uptime Kuma status page. Optionally filter to a single monitor via `monitor`.

```json
{ "type": "kuma", "url": "https://uptimekuma.example.com", "slug": "mailcow" }
```

#### `omada-version`

Compares the running Omada Controller version against the Omada support page.

```json
{
  "type": "omada-version",
  "label": "Omada Controller",
  "apiUrl": "https://192.168.0.20:8043/api/info",
  "status_labels": { "up": "Up-to-date", "grace": "Update available" }
}
```

#### `zabbix-alerts`

Shows active Zabbix problems (severities Warning through Disaster). One item per section, no extra fields required.

```json
{ "type": "zabbix-alerts" }
```

- No problems → green "No active problems" bar
- Problems → table with severity badge (yellow/orange/red/dark red), hostname, description, timestamp
- Only shows problems from enabled triggers/items, unacknowledged and unsuppressed

#### `zabbix-item`

Displays the value of a single Zabbix item as a status card. Useful for tracking updates per service.

```json
{
  "type": "zabbix-item",
  "label": "Immich",
  "host": "proxmox1",
  "itemKey": "docker.update[immich]",
  "valueMap": { "0": "up", "1": "grace" },
  "status_labels": { "up": "Up-to-date", "grace": "Update available" }
}
```

Optionally show current and latest version (like the `omada-version` card):

```json
{
  "type": "zabbix-item",
  "label": "HASS Core",
  "host": "Home Assistant",
  "itemKey": "update.home.assistant.core.update",
  "currentVersionKey": "version.home.assistant.core.installed",
  "latestVersionKey": "version.home.assistant.core.latest",
  "valueMap": { "0": "up", "1": "grace" },
  "status_labels": { "up": "Up-to-date", "grace": "Update available" }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `host` | yes | Technical hostname as known in Zabbix (Monitoring → Hosts → "Host" column) |
| `itemKey` | yes | Exact item key (Configuration → Hosts → Items → "Key" column) |
| `currentVersionKey` | no | Zabbix item key holding the installed version string |
| `latestVersionKey` | no | Zabbix item key holding the latest available version string |
| `valueMap` | no | Maps item value to a dashboard status (`up`/`grace`/`down`/`error`) |
| `showValue` | no | `true` to show the raw value as meta text |
| `status_labels` | no | Custom labels for statuses |

**Finding host and item key:**
1. Zabbix → Monitoring → Hosts → copy the value from the **Host** column (not Visible name)
2. Click the host → Items → find the item → copy the **Key** column

**Requirements for the Zabbix item:** the item must return a value that can be mapped to a status via `valueMap`. For update tracking: a trapper item or UserParameter returning `0` (up-to-date) or `1` (update available). [Diun](https://crazymax.dev/diun/) can track this automatically and write directly to Zabbix.

#### `static`

A fixed card with no external data — useful for to-do items or notes.

```json
{ "type": "static", "label": "Docker container updates" }
```

---

## Infrastructure treeview & IP scan

Two extra tabs besides the Dashboard:

- **Infrastructuur** (`/api/tree`) — Physical host → Proxmox VM/LXC → Docker container tree, live status.
- **IP-adressen** (`/api/ipscan`) — Every address in the configured LAN subnet, classified as known+active, unknown+active, known+inactive, or free. If `opnsense` is configured, each address also shows hostname/MAC/vendor from the dnsmasq lease table, plus a `Fixed`/`DHCP` badge (`is_reserved` in OPNsense — i.e. whether the address has a static lease/reservation or is handed out dynamically).

Both degrade gracefully: if a Proxmox API, Docker socket/endpoint, or the IP scan file is unreachable, that branch shows `unreachable`/`stale` instead of crashing the server.

**Docker socket permissions:** the container runs as the non-root `node` user (uid/gid 1000), which is not in the host's `docker` group by default — mounting `/var/run/docker.sock` read-only is not enough on its own. `docker-compose.override.yml` adds `group_add` with the docker group's gid; run `getent group docker` on the host and make sure that gid matches (it's `998` on Proxmox 1 at the time of writing).

### `config.json` — `tree` / `ipscan`

```json
"tree": {
  "hosts": [
    { "id": "proxmox1", "name": "Proxmox 1", "ip": "192.168.0.3",
      "proxmoxApi": { "url": "https://192.168.0.3:8006/api2/json", "tokenEnv": "PROXMOX1_TOKEN" },
      "docker": { "socketPath": "/var/run/docker.sock" } },
    { "id": "proxmox2", "name": "Proxmox 2", "ip": "192.168.0.100",
      "proxmoxApi": { "url": "https://192.168.0.100:8006/api2/json", "tokenEnv": "PROXMOX2_TOKEN" },
      "guestDocker": [
        { "matchName": "frigate", "docker": { "host": "192.168.0.40", "port": 2375 } }
      ] },
    { "id": "vps1", "name": "VPS 1", "ip": "100.123.240.92", "link": "https://vps1.example.com" }
  ]
},
"ipscan": { "subnet": "192.168.0.0/24", "jsonPath": "./data/ipscan.json" }
```

| Field | Description |
|-------|-------------|
| `tree.hosts[].proxmoxApi` | Optional. Proxmox API base URL + `tokenEnv` (env var holding `user@realm!tokenid=uuid`) → fetches VM/LXC inventory for that host. |
| `tree.hosts[].docker` | Optional. Either `{ "socketPath": "/var/run/docker.sock" }` (local, read-only mount) or `{ "host": "...", "port": 2375 }` (remote Docker API over TCP) → lists that host's own containers. |
| `tree.hosts[].guestDocker` | Optional. Matches a Proxmox VM/LXC by (substring of) name and attaches its Docker containers. |
| `tree.hosts[].checkPort` | Used only for hosts with neither `proxmoxApi` nor `docker` — plain TCP reachability check (default port 443). |
| `ipscan.subnet` | CIDR range to enumerate (e.g. `192.168.0.0/24`). |
| `ipscan.jsonPath` | Path (relative to the repo root) to the JSON file written by the nmap cron job. Missing/corrupt file → empty scan list, `stale: true`. |

Add the matching tokens to `.env`:

```
PROXMOX1_TOKEN=homepage@pve!homepage=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PROXMOX2_TOKEN=homepage@pve!homepage=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### `config.json` — `opnsense` (optional)

Enriches the IP scan with live dnsmasq lease data — hostname, MAC, vendor, and whether the lease is a static reservation (`Fixed`) or handed out dynamically (`DHCP`):

```json
"opnsense": {
  "url": "https://192.168.0.1",
  "keyEnv": "OPNSENSE_API_KEY",
  "secretEnv": "OPNSENSE_API_SECRET"
}
```

Create an API key/secret in OPNsense under System → Access → Users (or a dedicated read-only API user), and add them to `.env`:

```
OPNSENSE_API_KEY=
OPNSENSE_API_SECRET=
```

Missing/unreachable OPNsense → the ipscan table just falls back to hostname/MAC from the nmap scan file, no `Fixed`/`DHCP` badge.

### IP scan cron job (on the Proxmox 1 host, not in the container)

The container has no LAN access (it only sits on the `t2_proxy` Docker network), so the nmap scan runs on the Proxmox 1 host itself via cron and writes a JSON file that's mounted read-only into the container.

```bash
apt install -y jq   # nmap is normally already present
mkdir -p /opt/infra-dashboard/scripts
cp scripts/ipscan-cron.sh /opt/infra-dashboard/scripts/
chmod +x /opt/infra-dashboard/scripts/ipscan-cron.sh
crontab -e
# add:
0 * * * * /opt/infra-dashboard/scripts/ipscan-cron.sh >> /var/log/ipscan-cron.log 2>&1
```

The script writes to `<repo>/data/ipscan.json` by default (override with `IPSCAN_OUT_DIR`/`IPSCAN_SUBNET` env vars). Mount that `data/` directory read-only into the container — see `docker-compose.override.yml`.

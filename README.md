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

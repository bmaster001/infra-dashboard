# Infra Dashboard

Minimale statuspagina voor thuisinfrastructuur. Haalt data op uit Healthchecks.io, Uptime Kuma, Zabbix en custom API's.

## Installatie

```bash
cp config.example.json config.json   # pas aan naar jouw setup
cp .env.example .env                 # vul API keys in
docker compose up -d --build
```

Beschikbaar op poort 3000. Wijzigingen in `config.json` worden opgepikt zonder herstart.

## Omgevingsvariabelen

Maak een `.env` bestand aan (zie `.env.example`):

| Variabele | Beschrijving |
|-----------|-------------|
| `HC_API_KEY` | Healthchecks.io API key |
| `ZABBIX_TOKEN` | Zabbix API token |
| `PORT` | Luisterpoort (standaard: 3000) |

---

## config.json

### Globale Zabbix-configuratie

```json
{
  "zabbix": {
    "apiUrl": "http://zabbix.example.com/zabbix/api_jsonrpc.php",
    "token": "jouw-api-token"
  },
  "sections": [ ... ]
}
```

### Item types

#### `healthchecks`

```json
{
  "type": "healthchecks",
  "label": "Proxmox1",
  "uuid": "8e2f29ff-...",
  "status_labels": { "up": "OK", "down": "Mislukt" }
}
```

#### `kuma`

Haalt alle monitors op van een Uptime Kuma statuspage. Optioneel filter op één monitor via `monitor`.

```json
{ "type": "kuma", "url": "https://uptimekuma.example.com", "slug": "mailcow" }
```

#### `omada-version`

Vergelijkt de draaiende Omada Controller versie met de Omada support-pagina.

```json
{
  "type": "omada-version",
  "label": "Omada Controller",
  "apiUrl": "https://192.168.0.20:8043/api/info",
  "status_labels": { "up": "Up-to-date", "grace": "Update beschikbaar" }
}
```

#### `zabbix-alerts`

Toont actieve Zabbix-problemen (severities Warning t/m Disaster). Eén item per sectie, geen extra velden nodig.

```json
{ "type": "zabbix-alerts" }
```

- Geen problemen → groene "Geen actieve problemen" balk
- Problemen → tabel met severity badge (geel/oranje/rood/donkerrood), hostname, omschrijving, tijdstip

#### `zabbix-item`

Toont de waarde van één Zabbix-item als statuskaart. Handig voor update-tracking per service.

```json
{
  "type": "zabbix-item",
  "label": "Immich",
  "host": "proxmox1",
  "itemKey": "docker.update[immich]",
  "valueMap": { "0": "up", "1": "grace" },
  "status_labels": { "up": "Up-to-date", "grace": "Update beschikbaar" }
}
```

| Veld | Verplicht | Beschrijving |
|------|-----------|-------------|
| `host` | ja | Technische hostname zoals Zabbix die kent (Monitoring → Hosts → "Host" kolom) |
| `itemKey` | ja | Exacte item key (Configuration → Hosts → Items → "Key" kolom) |
| `valueMap` | nee | Vertaalt de item-waarde naar een dashboardstatus (`up`/`grace`/`down`/`error`) |
| `showValue` | nee | `true` om de ruwe waarde als meta-tekst te tonen |
| `status_labels` | nee | Eigen labels voor de statussen |

**Host en item key vinden:**
1. Zabbix → Monitoring → Hosts → kopieer de waarde uit de **Host** kolom (niet Visible name)
2. Klik op de host → Items → zoek het item → kopieer de **Key** kolom

**Vereisten aan het Zabbix-item:** het item moet een waarde teruggeven die je via `valueMap` op een status kunt mappen. Voor update-tracking: een trapper item of UserParameter dat `0` (up-to-date) of `1` (update beschikbaar) teruggeeft. [Diun](https://crazymax.dev/diun/) kan dit automatisch bijhouden en rechtstreeks naar Zabbix schrijven.

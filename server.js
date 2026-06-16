'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HC_API_KEY = process.env.HC_API_KEY || '';
const ZABBIX_TOKEN = process.env.ZABBIX_TOKEN || '';
const CONFIG_PATH = path.join(__dirname, 'config.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
};

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`config.json: ${err.message}`);
  }
}

function fetchJSON(targetUrl, headers = {}, reqOpts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'infra-dashboard/1.0', ...headers },
      ...reqOpts,
    };
    const req = mod.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`HTTP ${res.statusCode} — geen JSON response`));
        }
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    req.end();
  });
}

function fetchZabbixJSON(apiUrl, token, method, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(apiUrl);
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'infra-dashboard/1.0',
      },
    };
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.data || parsed.error.message));
          else resolve(parsed.result);
        } catch {
          reject(new Error(`HTTP ${res.statusCode} — geen JSON`));
        }
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('Zabbix timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchText(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const opts = {
      hostname: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; infra-dashboard/1.0)' },
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    });
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchZabbixAlerts(apiUrl, token) {
  const problems = await fetchZabbixJSON(apiUrl, token, 'problem.get', {
    output: ['eventid', 'objectid', 'name', 'severity', 'clock'],
    acknowledged: false,
    suppressed: false,
    severities: [2, 3, 4, 5],
    sortfield: 'eventid',
    sortorder: 'DESC',
  });

  if (!problems.length) return [];

  const triggerIds = [...new Set(problems.map((p) => p.objectid))];
  const triggers = await fetchZabbixJSON(apiUrl, token, 'trigger.get', {
    output: ['triggerid'],
    selectHosts: ['host', 'name'],
    triggerids: triggerIds,
    monitored: true,
  });

  const triggerMap = Object.fromEntries(
    triggers.map((t) => [t.triggerid, t.hosts[0]?.name || t.hosts[0]?.host || 'Onbekend'])
  );

  return problems
    .filter((p) => triggerMap[p.objectid] !== undefined)
    .map((p) => ({
      host: triggerMap[p.objectid],
      name: p.name,
      severity: Number(p.severity),
      clock: Number(p.clock),
    }));
}

const omadaLatestCache = { version: null, fetchedAt: 0, ttl: 3600_000 };

async function fetchOmadaLatestVersion() {
  if (omadaLatestCache.version && Date.now() - omadaLatestCache.fetchedAt < omadaLatestCache.ttl) {
    return { ok: true, version: omadaLatestCache.version };
  }
  const result = await fetchText('https://support.omadanetworks.com/us/product/omada-software-controller/?resourceType=download')
    .then((html) => {
      const m = html.match(/Omada_SDN_Controller_v(\d+\.\d+\.\d+\.\d+)/) ||
                html.match(/Omada_SDN_Controller_v\d+\.\d+\.\d+[\s\S]{1,200}?(\d+\.\d+\.\d+\.\d+)/);
      return m ? { ok: true, version: m[1] } : { ok: false, error: 'Versie niet gevonden op support pagina' };
    })
    .catch((err) => ({ ok: false, error: err.message }));
  if (result.ok) {
    omadaLatestCache.version = result.version;
    omadaLatestCache.fetchedAt = Date.now();
  }
  return result;
}

async function fetchOmadaVersionData(apiUrl) {
  const [currentResult, latestResult] = await Promise.all([
    fetchJSON(apiUrl, {}, { rejectUnauthorized: false })
      .then((data) => ({ ok: true, version: data?.result?.controllerVer || null }))
      .catch((err) => ({ ok: false, error: err.message })),
    fetchOmadaLatestVersion(),
  ]);
  return { current: currentResult, latest: latestResult };
}

function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
}

// ── Data aggregation ───────────────────────────────────────────

async function fetchAllData(cfg) {
  const hcHeaders = { 'X-Api-Key': HC_API_KEY };

  // Collect unique HC UUIDs, Kuma pairs, Omada API URLs, and Zabbix needs
  const hcUUIDs = new Set();
  const kumaKeys = new Map(); // "url|slug" -> { url, slug }
  const omadaApiUrls = new Set();
  const zabbixCfg = cfg.zabbix
    ? { ...cfg.zabbix, token: cfg.zabbix.token || ZABBIX_TOKEN }
    : null;
  let hasZabbixAlerts = false;
  const zabbixItemKeys = [];

  for (const section of cfg.sections) {
    for (const item of section.items) {
      if (item.type === 'healthchecks') hcUUIDs.add(item.uuid);
      if (item.type === 'kuma') {
        const key = `${item.url}|${item.slug}`;
        kumaKeys.set(key, { url: item.url, slug: item.slug });
      }
      if (item.type === 'omada-version') omadaApiUrls.add(item.apiUrl);
      if (item.type === 'zabbix-alerts') hasZabbixAlerts = true;
      if (item.type === 'zabbix-item') {
        zabbixItemKeys.push(item.itemKey);
        if (item.currentVersionKey) zabbixItemKeys.push(item.currentVersionKey);
        if (item.latestVersionKey)  zabbixItemKeys.push(item.latestVersionKey);
      }
    }
  }

  // Fetch everything in parallel
  const [hcMap, kumaMap, omadaMap, zabbixProblemsResult, zabbixItemsResult] = await Promise.all([
    Promise.all(
      [...hcUUIDs].map((uuid) =>
        fetchJSON(`https://healthchecks.io/api/v3/checks/${uuid}`, hcHeaders)
          .then((data) => [uuid, { ok: true, data }])
          .catch((err) => [uuid, { ok: false, error: err.message }])
      )
    ).then(Object.fromEntries),

    Promise.all(
      [...kumaKeys.entries()].map(([key, { url, slug }]) =>
        Promise.all([
          fetchJSON(`${url}/api/status-page/${slug}`),
          fetchJSON(`${url}/api/status-page/heartbeat/${slug}`),
        ])
          .then(([page, hb]) => [key, { ok: true, page, heartbeats: hb }])
          .catch((err) => [key, { ok: false, error: err.message }])
      )
    ).then(Object.fromEntries),

    Promise.all(
      [...omadaApiUrls].map((url) =>
        fetchOmadaVersionData(url)
          .then((data) => [url, data])
      )
    ).then(Object.fromEntries),

    (zabbixCfg && hasZabbixAlerts)
      ? fetchZabbixAlerts(zabbixCfg.apiUrl, zabbixCfg.token)
          .then((data) => ({ ok: true, data }))
          .catch((err) => ({ ok: false, error: err.message }))
      : Promise.resolve({ ok: true, data: [] }),

    (zabbixCfg && zabbixItemKeys.length > 0)
      ? fetchZabbixJSON(zabbixCfg.apiUrl, zabbixCfg.token, 'item.get', {
          output: ['itemid', 'key_', 'lastvalue'],
          selectHosts: ['host'],
          filter: { key_: [...new Set(zabbixItemKeys)] },
        })
          .then((data) => ({ ok: true, data }))
          .catch((err) => ({ ok: false, error: err.message }))
      : Promise.resolve({ ok: true, data: [] }),
  ]);

  // Build structured response per section
  const sections = cfg.sections.map((section) => {
    const cards = [];

    for (const item of section.items) {
      if (item.type === 'healthchecks') {
        const result = hcMap[item.uuid];
        if (!result.ok) {
          cards.push({ type: 'healthchecks', label: item.label, status: 'error', error: result.error });
        } else {
          cards.push({
            type: 'healthchecks',
            label: item.label,
            status: result.data.status || 'unknown',
            last_ping: result.data.last_ping || null,
            link: `https://healthchecks.io/checks/${item.uuid}/details/`,
            ...(item.status_labels && { status_labels: item.status_labels }),
          });
        }
      }

      if (item.type === 'static') {
        cards.push({
          type: 'static',
          label: item.label,
          status: item.status || 'todo',
          ...(item.note && { note: item.note }),
          ...(item.link && { link: item.link }),
        });
        continue;
      }

      if (item.type === 'zabbix-alerts') {
        if (!zabbixCfg) {
          cards.push({ type: 'zabbix-alerts', status: 'error', error: 'Geen Zabbix configuratie', problems: [] });
          continue;
        }
        if (!zabbixProblemsResult.ok) {
          cards.push({ type: 'zabbix-alerts', status: 'error', error: zabbixProblemsResult.error, problems: [] });
          continue;
        }
        const problems = zabbixProblemsResult.data;
        const zabbixBase = zabbixCfg.apiUrl.replace(/\/api_jsonrpc\.php$/, '');
        cards.push({
          type: 'zabbix-alerts',
          status: problems.length > 0 ? 'down' : 'up',
          problems,
          link: `${zabbixBase}/zabbix.php?action=problem.view&filter_show=1&filter_set=1`,
        });
        continue;
      }

      if (item.type === 'zabbix-item') {
        if (!zabbixCfg) {
          cards.push({ type: 'zabbix-item', label: item.label, status: 'error', error: 'Geen Zabbix configuratie' });
          continue;
        }
        if (!zabbixItemsResult.ok) {
          cards.push({ type: 'zabbix-item', label: item.label, status: 'error', error: zabbixItemsResult.error });
          continue;
        }
        const zbItem = zabbixItemsResult.data.find(
          (i) => i.key_ === item.itemKey &&
            (!item.host || i.hosts.some((h) => h.host === item.host))
        );
        if (!zbItem) {
          cards.push({ type: 'zabbix-item', label: item.label, status: 'unknown', error: `Item niet gevonden: ${item.itemKey}` });
          continue;
        }
        const val = zbItem.lastvalue;
        const status = item.valueMap ? (item.valueMap[val] || 'unknown') : 'up';

        let versions;
        if (item.currentVersionKey || item.latestVersionKey) {
          const findVer = (key) => key
            ? zabbixItemsResult.data.find(
                (i) => i.key_ === key && (!item.host || i.hosts.some((h) => h.host === item.host))
              )?.lastvalue || null
            : null;
          versions = { current: findVer(item.currentVersionKey), latest: findVer(item.latestVersionKey) };
        }

        cards.push({
          type: 'zabbix-item',
          label: item.label,
          status,
          ...(versions && { versions }),
          ...(item.showValue && { value: val }),
          ...(item.status_labels && { status_labels: item.status_labels }),
        });
        continue;
      }

      if (item.type === 'omada-version') {
        const result = omadaMap[item.apiUrl];
        if (!result) {
          cards.push({ type: 'omada-version', label: item.label, status: 'error', error: 'Geen data' });
          continue;
        }
        const currentVer = result.current.ok ? result.current.version : null;
        const latestVer  = result.latest.ok  ? result.latest.version  : null;
        let status, error;
        if (!result.current.ok) {
          status = 'error'; error = result.current.error;
        } else if (!result.latest.ok) {
          status = 'error'; error = result.latest.error;
        } else {
          status = currentVer === latestVer ? 'up' : 'grace';
        }
        cards.push({
          type: 'omada-version',
          label: item.label,
          status,
          link: item.apiUrl.replace(/\/api\/.*$/, ''),
          ...(error && { error }),
          ...((currentVer || latestVer) && { versions: { current: currentVer, latest: latestVer } }),
          ...(item.status_labels && { status_labels: item.status_labels }),
        });
        continue;
      }

      if (item.type === 'kuma') {
        const key = `${item.url}|${item.slug}`;
        const result = kumaMap[key];
        if (!result.ok) {
          cards.push({ type: 'kuma', label: item.monitor || item.slug, status: 'error', error: result.error });
          continue;
        }
        const monitors = (result.page.publicGroupList || []).flatMap((g) => g.monitorList || []);
        const visible = item.monitor
          ? monitors.filter((m) => m.name === item.monitor)
          : monitors;

        for (const monitor of visible) {
          const hbList = result.heartbeats.heartbeatList?.[monitor.id] || [];
          const status = hbList.length === 0 ? 'unknown' : hbList[0].status === 1 ? 'up' : 'down';
          const uptime = result.heartbeats.uptimeList?.[`${monitor.id}_24`];
          cards.push({
            type: 'kuma',
            label: monitor.name,
            status,
            uptime_24h: uptime != null ? +(uptime * 100).toFixed(1) : null,
            link: `${item.url}/status/${item.slug}`,
            ...(item.status_labels && { status_labels: item.status_labels }),
          });
        }
      }
    }

    return { label: section.label, cards };
  });

  return { sections };
}

// ── HTTP server ────────────────────────────────────────────────

http.createServer(async (req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }

  const pathname = new URL(req.url, 'http://localhost').pathname;

  try {
    const cfg = loadConfig();

    if (pathname === '/api/data') {
      const data = await fetchAllData(cfg);
      return sendJSON(res, data);
    }

    if (pathname === '/' || pathname === '/index.html') {
      return serveFile(res, path.join(__dirname, 'public', 'index.html'));
    }

    const rel = path.normalize(pathname.slice(1));
    if (rel.startsWith('..')) { res.writeHead(403); res.end(); return; }
    serveFile(res, path.join(__dirname, 'public', rel));

  } catch (err) {
    console.error(`[${new Date().toISOString()}] ${err.message}`);
    sendJSON(res, { error: err.message }, 500);
  }
}).listen(PORT, () => {
  console.log(`Infra dashboard running on :${PORT}`);
});

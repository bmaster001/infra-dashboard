'use strict';
const { fetchJSON } = require('./http');

function resolveCreds(cfg) {
  const key = (cfg.keyEnv && process.env[cfg.keyEnv]) || cfg.key || '';
  const secret = (cfg.secretEnv && process.env[cfg.secretEnv]) || cfg.secret || '';
  return { key, secret };
}

async function fetchDnsmasqLeases(opnsenseCfg) {
  const map = new Map(); // ip -> { hostname, mac, vendor, reserved }
  if (!opnsenseCfg || !opnsenseCfg.url) return map;

  const { key, secret } = resolveCreds(opnsenseCfg);
  if (!key || !secret) return map;

  try {
    const auth = Buffer.from(`${key}:${secret}`).toString('base64');
    const data = await fetchJSON(
      `${opnsenseCfg.url}/api/dnsmasq/leases/search`,
      { Authorization: `Basic ${auth}` },
      { rejectUnauthorized: false }
    );
    for (const row of data.rows || []) {
      map.set(row.address, {
        hostname: (row.hostname && row.hostname !== '*') ? row.hostname : null,
        mac: row.hwaddr || null,
        vendor: row.mac_info || null,
        reserved: row.is_reserved === '1',
      });
    }
  } catch {
    // OPNsense niet bereikbaar/geconfigureerd — ipscan degradeert naar de andere bronnen.
  }
  return map;
}

module.exports = { fetchDnsmasqLeases };

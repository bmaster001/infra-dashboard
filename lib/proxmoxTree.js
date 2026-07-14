'use strict';
const { fetchJSON } = require('./http');

function authHeader(token) {
  return { Authorization: `PVEAPIToken=${token}` };
}

async function fetchGuestIp(apiUrl, headers, node, type, vmid) {
  try {
    const data = await fetchJSON(
      `${apiUrl}/nodes/${node}/${type}/${vmid}/agent/network-get-interfaces`,
      headers,
      { rejectUnauthorized: false }
    );
    const ifaces = data?.data?.result || [];
    for (const iface of ifaces) {
      for (const addr of iface['ip-addresses'] || []) {
        if (addr['ip-address-type'] === 'ipv4' && addr['ip-address'] !== '127.0.0.1') {
          return addr['ip-address'];
        }
      }
    }
    return null;
  } catch {
    // Geen guest agent geïnstalleerd/actief is normaal — best-effort, geen fout.
    return null;
  }
}

const SKIP_IFACE = /^(lo|docker|br-|veth|tailscale)/;

async function fetchLxcIp(apiUrl, headers, node, vmid) {
  try {
    const data = await fetchJSON(
      `${apiUrl}/nodes/${node}/lxc/${vmid}/interfaces`,
      headers,
      { rejectUnauthorized: false }
    );
    const ifaces = data?.data || [];
    for (const iface of ifaces) {
      if (SKIP_IFACE.test(iface.name || '')) continue;

      if (iface['ip-addresses']) {
        for (const addr of iface['ip-addresses']) {
          if (addr['ip-address-type'] === 'inet' && addr['ip-address'] !== '127.0.0.1') {
            return addr['ip-address'];
          }
        }
        continue;
      }

      // Oudere PVE-versies geven geen ip-addresses array terug, enkel "inet": "x.x.x.x/24".
      const ip = (iface.inet || '').split('/')[0];
      if (ip && ip !== '127.0.0.1') return ip;
    }
    return null;
  } catch {
    // /interfaces niet beschikbaar (oudere PVE) of container gestopt — best-effort, geen fout.
    return null;
  }
}

async function fetchProxmoxInventory(hostCfg) {
  const { url: apiUrl, token } = hostCfg.proxmoxApi;
  const headers = authHeader(token);

  const nodesRes = await fetchJSON(`${apiUrl}/nodes`, headers, { rejectUnauthorized: false });
  const nodes = nodesRes?.data || [];

  const guests = [];
  for (const node of nodes) {
    const nodeName = node.node;

    for (const [type, kind] of [['qemu', 'vm'], ['lxc', 'lxc']]) {
      try {
        const res = await fetchJSON(`${apiUrl}/nodes/${nodeName}/${type}`, headers, { rejectUnauthorized: false });
        const list = res?.data || [];
        for (const guest of list) {
          const running = guest.status === 'running';
          let ip = null;
          if (running && type === 'qemu') {
            ip = await fetchGuestIp(apiUrl, headers, nodeName, type, guest.vmid);
          } else if (running && type === 'lxc') {
            ip = await fetchLxcIp(apiUrl, headers, nodeName, guest.vmid);
          }
          guests.push({
            id: guest.vmid,
            name: guest.name || `${kind}-${guest.vmid}`,
            kind,
            node: nodeName,
            status: running ? 'up' : 'down',
            ip,
          });
        }
      } catch (err) {
        guests.push({
          kind,
          node: nodeName,
          status: 'unreachable',
          error: err.message,
        });
      }
    }
  }

  return { status: 'up', guests };
}

module.exports = { fetchProxmoxInventory };

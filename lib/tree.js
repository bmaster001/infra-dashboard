'use strict';
const net = require('net');
const { fetchProxmoxInventory } = require('./proxmoxTree');
const { fetchDockerContainers, groupByStack } = require('./dockerTree');

function checkTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    const done = (result) => { socket.destroy(); resolve(result); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function resolveToken(proxmoxApiCfg) {
  return (proxmoxApiCfg.tokenEnv && process.env[proxmoxApiCfg.tokenEnv]) || proxmoxApiCfg.token || '';
}

function byName(a, b) {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

async function attachGuestDocker(guest, guestDockerCfgs) {
  if (!guestDockerCfgs || guest.status !== 'up') return guest;
  const match = guestDockerCfgs.find((gd) => guest.name.toLowerCase().includes(gd.matchName.toLowerCase()));
  if (!match) return guest;
  try {
    guest.docker = groupByStack(await fetchDockerContainers(match.docker));
  } catch (err) {
    guest.dockerError = err.message;
  }
  return guest;
}

async function buildHostNode(hostCfg) {
  const node = { id: hostCfg.id, name: hostCfg.name, ip: hostCfg.ip };
  if (hostCfg.link) node.link = hostCfg.link;

  const hasProxmox = !!hostCfg.proxmoxApi;
  const hasDocker = !!hostCfg.docker;

  if (!hasProxmox && !hasDocker) {
    const reachable = await checkTcp(hostCfg.ip, hostCfg.checkPort || 443, 2000);
    node.status = reachable ? 'up' : 'unreachable';
    return node;
  }

  let anyOk = false;
  let anyFail = false;

  if (hasProxmox) {
    try {
      const inventory = await fetchProxmoxInventory({
        proxmoxApi: { url: hostCfg.proxmoxApi.url, token: resolveToken(hostCfg.proxmoxApi) },
      });
      node.guests = (await Promise.all(
        inventory.guests.map((g) => attachGuestDocker(g, hostCfg.guestDocker))
      )).sort(byName);
      anyOk = true;
    } catch (err) {
      node.guests = [];
      node.proxmoxError = err.message;
      anyFail = true;
    }
  }

  if (hasDocker) {
    try {
      node.docker = groupByStack(await fetchDockerContainers(hostCfg.docker));
      anyOk = true;
    } catch (err) {
      node.docker = [];
      node.dockerError = err.message;
      anyFail = true;
    }
  }

  node.status = anyOk ? (anyFail ? 'partial' : 'up') : 'unreachable';
  return node;
}

async function buildTree(treeCfg) {
  const hosts = await Promise.all(
    (treeCfg.hosts || []).map((hostCfg) =>
      buildHostNode(hostCfg).catch((err) => ({
        id: hostCfg.id,
        name: hostCfg.name,
        ip: hostCfg.ip,
        status: 'unreachable',
        error: err.message,
      }))
    )
  );
  return { hosts };
}

module.exports = { buildTree };

'use strict';
const fs = require('fs');
const path = require('path');
const { buildTree } = require('./tree');
const { fetchDnsmasqLeases } = require('./opnsense');

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function intToIp(int) {
  return [24, 16, 8, 0].map((shift) => (int >>> shift) & 255).join('.');
}

function generateSubnetIps(cidr) {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const baseInt = ipToInt(base);
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  const network = baseInt & mask;
  const broadcast = network | (~mask >>> 0);
  const ips = [];
  for (let i = network + 1; i < broadcast; i++) {
    ips.push(intToIp(i >>> 0));
  }
  return ips;
}

function readScanFile(jsonPath) {
  const resolved = path.join(__dirname, '..', jsonPath);
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      scanned_at: parsed.scanned_at || null,
      hosts: Array.isArray(parsed.hosts) ? parsed.hosts : [],
      stale: false,
    };
  } catch (err) {
    return { scanned_at: null, hosts: [], stale: true, error: err.message };
  }
}

function labelsFilePath(ipscanCfg) {
  const rel = ipscanCfg.labelsPath ||
    (ipscanCfg.jsonPath ? path.join(path.dirname(ipscanCfg.jsonPath), 'ipscan-labels.json') : './data/ipscan-labels.json');
  return path.join(__dirname, '..', rel);
}

function readLabels(ipscanCfg) {
  try {
    const parsed = JSON.parse(fs.readFileSync(labelsFilePath(ipscanCfg), 'utf8'));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function setLabel(ipscanCfg, ip, label) {
  const resolved = labelsFilePath(ipscanCfg);
  const labels = readLabels(ipscanCfg);
  if (label) labels[ip] = label;
  else delete labels[ip];
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(labels, null, 2));
  return labels;
}

function collectKnownIps(treeData) {
  const known = new Map(); // ip -> name
  for (const host of treeData.hosts || []) {
    if (host.ip) known.set(host.ip, host.name);
    for (const guest of host.guests || []) {
      if (guest.ip) known.set(guest.ip, guest.name);
    }
  }
  return known;
}

async function buildIpScan(treeCfg, ipscanCfg, opnsenseCfg) {
  if (!ipscanCfg.subnet) {
    return { scanned_at: null, stale: true, error: 'ipscan niet geconfigureerd (geen subnet)', addresses: [] };
  }

  let subnetIps;
  try {
    subnetIps = generateSubnetIps(ipscanCfg.subnet);
  } catch (err) {
    return { scanned_at: null, stale: true, error: `Ongeldig subnet: ${err.message}`, addresses: [] };
  }

  const scan = ipscanCfg.jsonPath
    ? readScanFile(ipscanCfg.jsonPath)
    : { scanned_at: null, hosts: [], stale: true, error: 'Geen jsonPath geconfigureerd' };

  const activeMap = new Map(scan.hosts.map((h) => [h.ip, h.hostname || null]));

  let known = new Map();
  try {
    const treeData = await buildTree(treeCfg);
    known = collectKnownIps(treeData);
  } catch {
    // Tree kon niet opgebouwd worden — ipscan degradeert naar enkel scan-data.
  }

  // Statische extra IP's per host (bv. LAN-IP naast het Tailscale-IP dat in de tree staat).
  for (const hostCfg of treeCfg.hosts || []) {
    for (const ip of hostCfg.aliasIps || []) known.set(ip, hostCfg.name);
  }

  const labels = readLabels(ipscanCfg);
  const dhcp = await fetchDnsmasqLeases(opnsenseCfg);

  const addresses = subnetIps.map((ip) => {
    const label = labels[ip] || null;
    const dhcpEntry = dhcp.get(ip);
    const dhcpName = dhcpEntry && dhcpEntry.hostname;
    const isKnown = known.has(ip) || !!label || !!dhcpName;
    const isActive = activeMap.has(ip);
    let status;
    if (isKnown && isActive) status = 'known-active';
    else if (!isKnown && isActive) status = 'unknown-active';
    else if (isKnown && !isActive) status = 'known-inactive';
    else status = 'free';

    return {
      ip,
      hostname: label || (isKnown && known.get(ip)) || dhcpName || activeMap.get(ip) || null,
      manual: !!label,
      ...(dhcpEntry?.mac && { mac: dhcpEntry.mac }),
      ...(dhcpEntry?.vendor && { vendor: dhcpEntry.vendor }),
      ...(dhcpEntry && { reserved: dhcpEntry.reserved }),
      status,
    };
  });

  return {
    scanned_at: scan.scanned_at,
    stale: scan.stale,
    ...(scan.error && { error: scan.error }),
    addresses,
  };
}

module.exports = { buildIpScan, setLabel };

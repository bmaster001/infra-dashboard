'use strict';
const { fetchJSON } = require('./http');

function traefikLink(labels) {
  if (!labels) return null;
  for (const [key, rule] of Object.entries(labels)) {
    const routerMatch = key.match(/^traefik\.http\.routers\.([^.]+)\.rule$/);
    if (!routerMatch) continue;
    const hostMatch = rule.match(/Host\(`([^`]+)`\)/);
    if (!hostMatch) continue;
    const router = routerMatch[1];
    const entrypoints = labels[`traefik.http.routers.${router}.entrypoints`] || '';
    const hasTls = labels[`traefik.http.routers.${router}.tls`] !== undefined || entrypoints.includes('websecure');
    return `${hasTls ? 'https' : 'http'}://${hostMatch[1]}`;
  }
  return null;
}

async function fetchDockerContainers(dockerCfg) {
  const url = dockerCfg.socketPath
    ? 'http://localhost/containers/json?all=true'
    : `http://${dockerCfg.host}:${dockerCfg.port}/containers/json?all=true`;
  const reqOpts = dockerCfg.socketPath ? { socketPath: dockerCfg.socketPath } : {};

  const list = await fetchJSON(url, {}, reqOpts);

  return list.map((c) => {
    const link = traefikLink(c.Labels);
    return {
      name: (c.Names?.[0] || '').replace(/^\//, ''),
      status: c.State === 'running' ? 'up' : 'down',
      image: c.Image,
      stack: c.Labels?.['com.docker.compose.project'] || null,
      ...(link && { link }),
    };
  });
}

function byName(a, b) {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

function groupByStack(containers) {
  const groups = new Map();
  for (const c of containers) {
    const key = c.stack || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const entries = [];
  for (const [name, list] of groups) {
    if (name && list.length > 1) entries.push({ name, containers: list.sort(byName) });
    else list.forEach((c) => entries.push({ name: null, containers: [c] }));
  }

  entries.sort((a, b) => {
    const an = (a.name || a.containers[0].name).toLowerCase();
    const bn = (b.name || b.containers[0].name).toLowerCase();
    return an.localeCompare(bn);
  });

  return entries;
}

module.exports = { fetchDockerContainers, groupByStack };

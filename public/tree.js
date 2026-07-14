'use strict';

(function () {
  const ROOT = document.getElementById('tree-root');
  const REFRESH_INTERVAL = 60_000;
  let pollTimer = null;
  const collapsedPaths = new Set();

  function statusClass(status) {
    if (status === 'up') return 'tree-up';
    if (status === 'down') return 'tree-down';
    return 'tree-gray'; // unreachable, partial, unknown
  }

  const KIND_LABEL = { host: 'HOST', vm: 'VM', lxc: 'LXC', docker: 'DOCKER', stack: 'STACK' };

  function buildNode({ label, status, kind, meta, link, children, path }) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-node';

    const row = document.createElement('div');
    row.className = 'tree-row';

    const hasChildren = !!(children && children.length);
    const chevron = document.createElement('span');
    chevron.className = 'tree-chevron' + (hasChildren ? '' : ' tree-chevron-empty');
    chevron.textContent = hasChildren ? '▾' : '';
    row.appendChild(chevron);

    const dot = document.createElement('span');
    dot.className = `tree-dot ${statusClass(status)}`;
    row.appendChild(dot);

    if (kind) {
      const badge = document.createElement('span');
      badge.className = `tree-kind tree-kind-${kind}`;
      badge.textContent = KIND_LABEL[kind] || kind.toUpperCase();
      row.appendChild(badge);
    }

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = label;
    if (link) {
      name.classList.add('tree-link');
      name.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(link, '_blank');
      });
    }
    row.appendChild(name);

    if (meta) {
      const metaEl = document.createElement('span');
      metaEl.className = 'tree-meta';
      metaEl.textContent = meta;
      row.appendChild(metaEl);
    }

    wrap.appendChild(row);

    if (hasChildren) {
      const childrenWrap = document.createElement('div');
      const startCollapsed = collapsedPaths.has(path);
      childrenWrap.className = 'tree-children' + (startCollapsed ? ' collapsed' : '');
      chevron.textContent = startCollapsed ? '▸' : '▾';
      children.forEach((c) => childrenWrap.appendChild(c));
      wrap.appendChild(childrenWrap);

      const toggle = () => {
        const collapsed = childrenWrap.classList.toggle('collapsed');
        chevron.textContent = collapsed ? '▸' : '▾';
        if (collapsed) collapsedPaths.add(path);
        else collapsedPaths.delete(path);
      };
      chevron.addEventListener('click', toggle);
      row.addEventListener('click', (e) => {
        if (e.target === name) return;
        toggle();
      });
    }

    return wrap;
  }

  function buildDockerNode(container, parentPath) {
    const path = `${parentPath}/${container.name}`;
    return buildNode({
      label: container.name,
      status: container.status,
      kind: 'docker',
      meta: container.image,
      link: container.link,
      path,
    });
  }

  function buildStackNode(stack, parentPath) {
    const path = `${parentPath}/${stack.name}`;
    const allUp = stack.containers.every((c) => c.status === 'up');
    const anyUp = stack.containers.some((c) => c.status === 'up');
    return buildNode({
      label: stack.name,
      status: allUp ? 'up' : anyUp ? 'partial' : 'down',
      kind: 'stack',
      meta: `${stack.containers.length} container${stack.containers.length === 1 ? '' : 's'}`,
      children: stack.containers.map((c) => buildDockerNode(c, path)),
      path,
    });
  }

  function buildDockerChildren(stacks, parentPath) {
    const nodes = [];
    (stacks || []).forEach((stack) => {
      if (stack.name) nodes.push(buildStackNode(stack, parentPath));
      else stack.containers.forEach((c) => nodes.push(buildDockerNode(c, parentPath)));
    });
    return nodes;
  }

  function buildGuestNode(guest, parentPath) {
    const label = guest.name || `${guest.kind || 'guest'}${guest.id ? ' ' + guest.id : ''}`;
    const path = `${parentPath}/${label}`;
    const metaParts = [guest.ip, guest.error].filter(Boolean);
    const children = buildDockerChildren(guest.docker, path);
    return buildNode({ label, status: guest.status, kind: guest.kind, meta: metaParts.join(' · '), children, path });
  }

  function buildHostNode(host) {
    const path = host.name;
    const metaParts = [host.ip, host.proxmoxError, host.dockerError, host.error].filter(Boolean);
    const children = [
      ...(host.guests || []).map((g) => buildGuestNode(g, path)),
      ...buildDockerChildren(host.docker, path),
    ];
    return buildNode({
      label: host.name,
      status: host.status,
      kind: 'host',
      meta: metaParts.join(' · '),
      link: host.link,
      children,
      path,
    });
  }

  function render(data) {
    ROOT.innerHTML = '';
    const hosts = data.hosts || [];
    if (!hosts.length) {
      ROOT.innerHTML = '<div class="error-card">Geen hosts geconfigureerd.</div>';
      return;
    }
    hosts.forEach((h) => ROOT.appendChild(buildHostNode(h)));
  }

  async function load() {
    try {
      const res = await fetch('/api/tree');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      render(data);
    } catch (err) {
      ROOT.innerHTML = `<div class="error-card">Kon infrastructuur niet laden: ${err.message}</div>`;
    }
  }

  function start() {
    load();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(load, REFRESH_INTERVAL);
  }

  function stop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  window.TreeView = { start, stop };
})();

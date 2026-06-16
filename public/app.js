'use strict';

const REFRESH_INTERVAL = 60_000;

// ── Utilities ──────────────────────────────────────────────────

function relativeTime(isoString) {
  if (!isoString) return '';
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (diff < 60)    return `${diff}s geleden`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m geleden`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}u geleden`;
  return `${Math.floor(diff / 86400)}d geleden`;
}

async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Zabbix helpers ────────────────────────────────────────────

const SEV_LABELS = { 2: 'Warning', 3: 'Average', 4: 'High', 5: 'Disaster' };

function buildZabbixAlertsCard(card) {
  const el = document.createElement('div');
  el.className = `card zabbix-alerts-card ${card.status || 'unknown'}`;

  if (card.status === 'error') {
    el.innerHTML = `
      <div class="card-name">Zabbix</div>
      <div class="card-status">
        <span class="status-dot"></span>
        <span class="card-status-text">Fout</span>
      </div>
      <div class="card-meta">${card.error || ''}</div>`;
    return el;
  }

  if (!card.problems || card.problems.length === 0) {
    el.innerHTML = `
      <div class="zabbix-ok">
        <span class="zabbix-ok-dot"></span>Geen actieve problemen
      </div>`;
    return el;
  }

  const rows = card.problems.map((p) => {
    const sevClass = `sev-${p.severity}`;
    const sevLabel = SEV_LABELS[p.severity] || `Sev ${p.severity}`;
    const time = relativeTime(new Date(p.clock * 1000).toISOString());
    return `<div class="zabbix-problem ${sevClass}">
      <span class="sev-badge ${sevClass}">${sevLabel}</span>
      <span class="prob-host">${p.host}</span>
      <span class="prob-name">${p.name}</span>
      <span class="prob-time">${time}</span>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="zabbix-problem-list">${rows}</div>`;
  if (card.link) {
    el.classList.add('clickable');
    el.addEventListener('click', () => window.open(card.link, '_blank'));
  }
  return el;
}

// ── Card builder ───────────────────────────────────────────────

const STATUS_LABEL = {
  up: 'Up', down: 'Down', grace: 'Grace',
  paused: 'Gepauzeerd', new: 'Nieuw',
  unknown: 'Onbekend', error: 'Fout',
  todo: 'Te doen',
};

function buildCard(card) {
  if (card.type === 'zabbix-alerts') return buildZabbixAlertsCard(card);
  const status = card.status || 'unknown';
  const labels = card.status_labels ? { ...STATUS_LABEL, ...card.status_labels } : STATUS_LABEL;
  const el = document.createElement('div');
  el.className = `card ${status}`;

  let meta = '';
  if (card.last_ping)          meta = relativeTime(card.last_ping);
  if (card.uptime_24h != null) meta = `${card.uptime_24h}% (24u)`;
  if (card.versions) {
    const { current, latest } = card.versions;
    if (card.status === 'up' && current) meta = `v${current}`;
    else if (current && latest)          meta = `v${current} → v${latest}`;
    else if (current)                    meta = `v${current}`;
  }
  if (card.error)              meta = card.error;

  el.innerHTML = `
    <div class="card-name">${card.label}</div>
    <div class="card-status">
      <span class="status-dot"></span>
      <span class="card-status-text">${labels[status] || status}</span>
    </div>
    ${meta ? `<div class="card-meta">${meta}</div>` : ''}
  `;
  if (card.link) {
    el.classList.add('clickable');
    el.addEventListener('click', () => window.open(card.link, '_blank'));
  }
  return el;
}

function buildSkeletons(n) {
  return Array.from({ length: n || 3 }, () => {
    const s = document.createElement('div');
    s.className = 'skeleton';
    s.innerHTML = '<div class="skel-line"></div><div class="skel-line short"></div><div class="skel-line tiny"></div>';
    return s;
  });
}

// ── Section builder ────────────────────────────────────────────

function buildSection(label) {
  const section = document.createElement('section');

  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `<h2>${label}</h2><span class="section-badge"></span>`;

  const grid = document.createElement('div');
  grid.className = 'card-grid';

  section.appendChild(header);
  section.appendChild(grid);
  return { section, grid, badge: header.querySelector('.section-badge') };
}

function setSectionBadge(badge, cards) {
  const allTodo  = cards.length > 0 && cards.every((c) => c.className.includes('todo'));
  const hasDown  = cards.some((c) => c.className.includes('down') || c.className.includes('error'));
  const hasGrace = cards.some((c) => c.className.includes('grace'));
  if (allTodo)       { badge.className = 'section-badge'; badge.textContent = ''; }
  else if (hasDown)  { badge.className = 'section-badge err';  badge.textContent = 'Probleem'; }
  else if (hasGrace) { badge.className = 'section-badge warn'; badge.textContent = 'Update(s) beschikbaar'; }
  else               { badge.className = 'section-badge ok';   badge.textContent = 'Alles OK'; }
}

// ── Layout ─────────────────────────────────────────────────────

// Keep DOM sections across refreshes to avoid full re-render flicker
const sectionCache = new Map(); // label -> { section, grid, badge }

function renderData(data) {
  const main = document.getElementById('main');
  const seen = new Set();

  for (const sectionData of data.sections) {
    seen.add(sectionData.label);

    let entry = sectionCache.get(sectionData.label);
    if (!entry) {
      entry = buildSection(sectionData.label);
      sectionCache.set(sectionData.label, entry);
      main.appendChild(entry.section);
    }

    // Rebuild cards
    entry.grid.innerHTML = '';
    const cardEls = sectionData.cards.map(buildCard);
    cardEls.forEach((c) => entry.grid.appendChild(c));
    setSectionBadge(entry.badge, cardEls);
  }

  // Remove sections that disappeared from config
  for (const [label, entry] of sectionCache) {
    if (!seen.has(label)) {
      entry.section.remove();
      sectionCache.delete(label);
    }
  }

  // Re-apply correct DOM order (appendChild moves existing nodes)
  for (const sectionData of data.sections) {
    const entry = sectionCache.get(sectionData.label);
    if (entry) main.appendChild(entry.section);
  }
}

function renderSkeletons(cfg) {
  const main = document.getElementById('main');
  main.innerHTML = '';
  sectionCache.clear();
  for (const s of cfg.sections) {
    const entry = buildSection(s.label);
    buildSkeletons(s.items.length).forEach((sk) => entry.grid.appendChild(sk));
    main.appendChild(entry.section);
    sectionCache.set(s.label, entry);
  }
}

// ── Refresh ────────────────────────────────────────────────────

let config = null;

async function refresh() {
  const indicator = document.getElementById('refresh-indicator');
  indicator.classList.add('loading');

  try {
    const data = await apiFetch('/api/data');
    renderData(data);
  } catch (err) {
    console.error('Refresh fout:', err.message);
  }

  document.getElementById('last-updated').textContent =
    `Bijgewerkt: ${new Date().toLocaleTimeString('nl-BE')}`;
  indicator.classList.remove('loading');
}

// ── Bootstrap ──────────────────────────────────────────────────

async function init() {
  try {
    // Fetch config once for skeleton layout, then load real data
    // (config is embedded in /api/data but we need section count for skeletons)
    config = await apiFetch('/api/data').then((d) => {
      // Derive a minimal config shape from the data for skeleton rendering
      return { sections: d.sections.map((s) => ({ label: s.label, items: s.cards })) };
    });

    // Show skeletons immediately, then fill in real data
    renderSkeletons(config);
    const data = await apiFetch('/api/data');
    renderData(data);

    document.getElementById('last-updated').textContent =
      `Bijgewerkt: ${new Date().toLocaleTimeString('nl-BE')}`;
    document.getElementById('refresh-indicator').classList.remove('loading');

    // Auto-refresh
    let secondsLeft = REFRESH_INTERVAL / 1000;
    setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        secondsLeft = REFRESH_INTERVAL / 1000;
        refresh();
      }
    }, 1000);
  } catch (err) {
    document.getElementById('main').innerHTML =
      `<div class="error-card" style="margin:28px">Kon data niet laden: ${err.message}</div>`;
  }
}

init();

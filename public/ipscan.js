'use strict';

(function () {
  const ROOT = document.getElementById('ipscan-root');
  const REFRESH_INTERVAL = 300_000;
  let pollTimer = null;
  let lastData = null;
  let sortKey = 'ip';
  let sortAsc = true;

  const STATUS_LABEL = {
    'known-active': 'Bekend · actief',
    'unknown-active': 'Onbekend · actief',
    'known-inactive': 'Bekend · inactief',
    'free': 'Vrij',
  };

  function ipSortValue(ip) {
    return ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
  }

  function sortedAddresses(addresses) {
    const arr = [...addresses];
    arr.sort((a, b) => {
      let av, bv;
      if (sortKey === 'ip') { av = ipSortValue(a.ip); bv = ipSortValue(b.ip); }
      else if (sortKey === 'hostname') { av = a.hostname || ''; bv = b.hostname || ''; }
      else if (sortKey === 'mac') { av = a.mac || ''; bv = b.mac || ''; }
      else if (sortKey === 'vendor') { av = a.vendor || ''; bv = b.vendor || ''; }
      else if (sortKey === 'reserved') { av = a.reserved ? 1 : 0; bv = b.reserved ? 1 : 0; }
      else { av = a.status; bv = b.status; }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
    return arr;
  }

  function render(data) {
    lastData = data;
    ROOT.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'ipscan-header';
    const scannedText = data.scanned_at
      ? `Scan: ${new Date(data.scanned_at).toLocaleString('nl-BE')}`
      : 'Nog geen scandata beschikbaar';
    header.innerHTML = `<span>${scannedText}</span>` +
      (data.stale ? '<span class="ipscan-stale">verouderd/ontbrekend</span>' : '');
    ROOT.appendChild(header);

    if (data.error) {
      const err = document.createElement('div');
      err.className = 'error-card';
      err.textContent = data.error;
      ROOT.appendChild(err);
    }

    const table = document.createElement('table');
    table.className = 'ipscan-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    [['ip', 'IP'], ['hostname', 'Hostname'], ['mac', 'MAC'], ['vendor', 'Vendor'], ['reserved', 'Lease'], ['status', 'Status']].forEach(([key, label]) => {
      const th = document.createElement('th');
      th.textContent = label;
      th.dataset.key = key;
      if (key === sortKey) th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
      th.addEventListener('click', () => {
        if (sortKey === key) sortAsc = !sortAsc;
        else { sortKey = key; sortAsc = true; }
        render(lastData);
      });
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    sortedAddresses(data.addresses || []).forEach((addr) => {
      const tr = document.createElement('tr');

      const ipTd = document.createElement('td');
      ipTd.className = 'ipscan-ip';
      ipTd.textContent = addr.ip;
      tr.appendChild(ipTd);

      const hostTd = document.createElement('td');
      hostTd.className = 'ipscan-hostname' + (addr.manual ? ' ipscan-manual' : '');
      hostTd.tabIndex = 0;
      hostTd.title = 'Klik om een label in te stellen';

      const hostLabel = document.createElement('span');
      hostLabel.textContent = addr.hostname || '';
      hostTd.appendChild(hostLabel);

      const startEdit = () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ipscan-label-input';
        input.value = addr.manual ? addr.hostname || '' : '';
        input.placeholder = addr.hostname || 'label…';

        const commit = async () => {
          const label = input.value.trim();
          input.removeEventListener('blur', commit);
          try {
            const res = await fetch('/api/ipscan/label', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ip: addr.ip, label }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            render(await res.json());
          } catch (err) {
            render(lastData);
            alert(`Kon label niet opslaan: ${err.message}`);
          }
        };

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(lastData); }
        });
        input.addEventListener('blur', commit);

        hostTd.innerHTML = '';
        hostTd.appendChild(input);
        input.focus();
      };

      hostTd.addEventListener('click', startEdit);
      hostTd.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && document.activeElement === hostTd) startEdit();
      });
      tr.appendChild(hostTd);

      const macTd = document.createElement('td');
      macTd.className = 'ipscan-mac';
      macTd.textContent = addr.mac || '';
      tr.appendChild(macTd);

      const vendorTd = document.createElement('td');
      vendorTd.textContent = addr.vendor || '';
      tr.appendChild(vendorTd);

      const reservedTd = document.createElement('td');
      if (addr.reserved !== undefined) {
        const leaseBadge = document.createElement('span');
        leaseBadge.className = `ipscan-badge ${addr.reserved ? 'fixed' : 'dhcp'}`;
        leaseBadge.textContent = addr.reserved ? 'Fixed' : 'DHCP';
        reservedTd.appendChild(leaseBadge);
      }
      tr.appendChild(reservedTd);

      const statusTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `ipscan-badge ${addr.status}`;
      badge.textContent = STATUS_LABEL[addr.status] || addr.status;
      statusTd.appendChild(badge);
      tr.appendChild(statusTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    ROOT.appendChild(table);
  }

  async function load() {
    try {
      const res = await fetch('/api/ipscan');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      render(data);
    } catch (err) {
      ROOT.innerHTML = `<div class="error-card">Kon IP-scan niet laden: ${err.message}</div>`;
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

  window.IpScanView = { start, stop };
})();

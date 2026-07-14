'use strict';

(function () {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels = {
    dashboard: document.getElementById('panel-dashboard'),
    infra: document.getElementById('panel-infra'),
    ipscan: document.getElementById('panel-ipscan'),
  };

  function activate(tab) {
    if (!panels[tab]) tab = 'dashboard';

    for (const [key, el] of Object.entries(panels)) {
      const active = key === tab;
      el.classList.toggle('active', active);
      el.hidden = !active;
    }
    for (const btn of buttons) btn.classList.toggle('active', btn.dataset.tab === tab);

    if (tab === 'infra') window.TreeView && window.TreeView.start();
    else window.TreeView && window.TreeView.stop();

    if (tab === 'ipscan') window.IpScanView && window.IpScanView.start();
    else window.IpScanView && window.IpScanView.stop();
  }

  function currentTab() {
    return location.hash.slice(1) || 'dashboard';
  }

  buttons.forEach((btn) => btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab !== currentTab()) history.pushState(null, '', '#' + tab);
    activate(tab);
  }));

  window.addEventListener('popstate', () => activate(currentTab()));

  activate(currentTab());
})();

import { els } from './dom.js';

// Owns the discovery panel and its separate scan socket.
export function createDiscovery(ctx) {
  let scanning = false;

  function setScanning(on) {
    scanning = on;
    els.scanBtn.disabled = on;
    els.discoverBtn.disabled = on;
    els.scanBtn.textContent = on ? 'scanning…' : 'scan lan';
  }

  function renderScan(result) {
    setScanning(false);
    els.discover.hidden = false;

    if (result.error) {
      els.discoverTitle.textContent = 'scan failed';
      els.discoverList.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'discover-empty';
      row.textContent = result.error;
      els.discoverList.appendChild(row);
      return;
    }

    const hosts = result.hosts || [];
    els.discoverTitle.textContent = `found ${hosts.length} ssh ${hosts.length === 1 ? 'host' : 'hosts'} · probed ${result.scanned || 0} addresses`;

    els.discoverList.innerHTML = '';
    if (!hosts.length) {
      const row = document.createElement('div');
      row.className = 'discover-empty';
      const cidrs = (result.subnets || []).map((s) => s.cidr).join(', ');
      row.textContent = `No SSH services answered on ${cidrs || 'the local network'}. SSH may be disabled or firewalled on those hosts.`;
      els.discoverList.appendChild(row);
      return;
    }

    for (const host of hosts) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'host-row' + (host.self ? ' self' : '');

      const ip = document.createElement('span');
      ip.className = 'h-ip';
      ip.textContent = host.host;

      const name = document.createElement('span');
      name.className = 'h-name';
      name.textContent = host.name || host.banner || 'ssh';

      const tag = document.createElement('span');
      tag.className = 'h-tag';
      tag.textContent = host.self ? 'self' : 'ssh';

      row.append(ip, name, tag);
      row.addEventListener('click', () => {
        els.host.value = host.host;
        els.port.value = '22';
        els.user.focus();
        els.discover.hidden = true;
      });
      els.discoverList.appendChild(row);
    }

    if (!els.host.value && hosts.length === 1) {
      els.host.value = hosts[0].host;
    }
  }

  function startScan() {
    if (scanning) return;
    ctx.ui.setFormTab(ctx.tabs.activeTab);
    setScanning(true);
    els.overlay.hidden = false;
    els.panelTitle.textContent = 'ssh gateway';
    ctx.ui.updatePanelClose();
    els.discover.hidden = false;
    els.discoverTitle.textContent = 'scanning local network…';
    els.discoverList.innerHTML = '<div class="discover-empty">probing every address for tcp/22 — this takes a few seconds…</div>';

    let ws;
    try {
      ws = ctx.session.openSocket();
    } catch (_) {
      renderScan({ error: 'Could not open a connection to this gateway.' });
      return;
    }

    const timer = setTimeout(() => {
      scanning = false;
      try {
        ws.close();
      } catch (_) {}
      renderScan({ error: 'Scan timed out. The gateway may be unreachable.' });
    }, 30000);

    ws.onopen = () => ws.send(JSON.stringify({ t: 'scan' }));
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (msg.t === 'scan') {
        clearTimeout(timer);
        try {
          ws.close();
        } catch (_) {}
        renderScan(msg);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      renderScan({ error: 'Gateway unreachable — is the server still running?' });
    };
  }

  els.scanBtn.addEventListener('click', (event) => {
    event.preventDefault();
    startScan();
  });
  els.discoverBtn.addEventListener('click', (event) => {
    event.preventDefault();
    startScan();
  });
  els.discoverClose.addEventListener('click', () => {
    els.discover.hidden = true;
  });

  return { startScan, renderScan };
}

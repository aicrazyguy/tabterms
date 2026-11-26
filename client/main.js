import { TOKEN, els } from './dom.js';
import { createUi } from './ui.js';
import { createTabStore } from './tabs.js';
import { createSession } from './session.js';
import { createPrefs } from './prefs.js';
import { installFormHandlers } from './form.js';
import { createDiscovery } from './discovery.js';
import { createFitter } from './fit.js';

// Dependency bag filled in order. Each factory owns its own mutable state and
// reads only the fields of ctx it declares; no module imports another's state.
const ctx = { config: { tabs: [] } };
ctx.ui = createUi(ctx);
ctx.tabs = createTabStore(ctx);
ctx.session = createSession(ctx);
ctx.prefs = createPrefs(ctx);
installFormHandlers(ctx);
ctx.discovery = createDiscovery(ctx);
ctx.fit = createFitter(ctx);

async function fetchConfig() {
  try {
    const url = `/api/config${TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : ''}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 401) {
      return {
        tabs: [],
        error: 'Access token required. Reopen this page with the token printed by the gateway.',
      };
    }
    if (!res.ok) {
      // Older gateways do not expose /api/config; fall back to the connect UI.
      return { tabs: [] };
    }
    const data = await res.json();
    return { tabs: Array.isArray(data.tabs) ? data.tabs : [] };
  } catch (_) {
    return { tabs: [], error: 'Could not reach the gateway.' };
  }
}

async function boot() {
  ctx.prefs.load();
  ctx.ui.setBusy(false);
  els.overlay.hidden = true;
  ctx.ui.updateStatus();

  const config = await fetchConfig();
  ctx.config.tabs = config.tabs;

  if (ctx.config.tabs.length) {
    ctx.tabs.rebuildConfiguredTabs();
  } else {
    const tab = ctx.tabs.addTab({ name: 'session' });
    ctx.tabs.activateTab(tab);
    ctx.ui.showConnectOverlay(tab, config.error || '', config.error ? 'error' : 'info');
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ctx.fit.fitTerminal(ctx.tabs.activeTab));
  } else {
    ctx.fit.fitTerminal(ctx.tabs.activeTab);
  }
}

setInterval(() => {
  els.statusClock.textContent = new Date().toLocaleTimeString([], { hour12: false });
}, 1000);
els.statusClock.textContent = new Date().toLocaleTimeString([], { hour12: false });

window.addEventListener('beforeunload', () => ctx.tabs.closeAll());

// Debug/automation hook (harmless in production, handy for tests).
window.__phosphor = {
  get term() {
    return ctx.tabs.activeTab && ctx.tabs.activeTab.term;
  },
  scan: ctx.discovery.startScan,
  get phase() {
    return ctx.tabs.activeTab ? ctx.tabs.activeTab.phase : 'idle';
  },
  get tabs() {
    return ctx.tabs.tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      phase: tab.phase,
      active: tab === ctx.tabs.activeTab,
    }));
  },
  activate(id) {
    const tab = ctx.tabs.getTab(id);
    if (tab) ctx.tabs.activateTab(tab);
  },
};

boot();

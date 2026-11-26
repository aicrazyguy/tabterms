import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { COLS, ROWS, TERM_THEME, encoder, els, phaseVisual } from './dom.js';

// Owns the tab list, the active tab, and each terminal instance.
export function createTabStore(ctx) {
  const tabs = [];
  let activeTab = null;
  let tabSeq = 0;

  function addTab(def = {}) {
    let id = def.id || `tab-${++tabSeq}`;
    const base = id;
    let n = 2;
    while (tabs.some((t) => t.id === id)) {
      id = `${base}-${n}`;
      n += 1;
    }

    const termEl = document.createElement('div');
    termEl.className = 'terminal';
    termEl.hidden = true;
    els.terminals.appendChild(termEl);

    const btn = document.createElement('div');
    btn.className = 'tab';
    btn.dataset.id = id;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'tab-main';
    main.setAttribute('role', 'tab');

    const dot = document.createElement('span');
    dot.className = 'tab-dot';

    const label = document.createElement('span');
    label.className = 'tab-label';

    main.append(dot, label);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'close tab (ends session)';
    close.setAttribute('aria-label', 'close tab');

    btn.append(main, close);
    els.tabs.appendChild(btn);

    const tab = {
      id,
      configId: def.configId || null,
      name: def.name || 'session',
      host: def.host || '',
      port: def.port || 22,
      user: def.user || '',
      authType: def.authType || '',
      needsCredentials: Boolean(def.needsCredentials),
      phase: 'idle',
      statusLabel: 'disconnected',
      socket: null,
      target: null,
      fingerprint: '',
      notice: null,
      connectedOnce: false,
      term: null,
      termEl,
      btn,
      main,
      dot,
      label,
    };

    label.textContent = tab.name;
    btn.classList.toggle('active', false);

    main.addEventListener('click', () => activateTab(tab));
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTab(tab);
    });

    tabs.push(tab);
    return tab;
  }

  function ensureTerminal(tab) {
    if (tab.term) return tab.term;
    const term = new Terminal({
      cols: COLS,
      rows: ROWS,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily:
        '"SF Mono", "Berkeley Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 16,
      fontWeight: '400',
      fontWeightBold: '700',
      lineHeight: 1,
      letterSpacing: 0,
      scrollback: 4000,
      allowTransparency: false,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      drawBoldTextInBrightColors: true,
      theme: TERM_THEME,
    });

    term.open(tab.termEl);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch (_) {
      // DOM renderer fallback — everything still works, just slower.
    }

    term.onData((data) => ctx.session.sendInput(tab, encoder.encode(data)));
    term.onBinary((data) => {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i += 1) bytes[i] = data.charCodeAt(i) & 255;
      ctx.session.sendInput(tab, bytes);
    });

    tab.term = term;
    syncTabButton(tab);
    return term;
  }

  function activateTab(tab) {
    if (!tab) return;
    if (ctx.ui.formTab && ctx.ui.formTab !== tab) ctx.ui.hideOverlay();

    if (activeTab && activeTab !== tab) {
      activeTab.termEl.hidden = true;
    }

    activeTab = tab;

    for (const t of tabs) {
      t.main.classList.toggle('active-tab', t === tab);
      t.btn.classList.toggle('active', t === tab);
    }

    tab.termEl.hidden = false;
    ensureTerminal(tab);

    clearActivity(tab);
    syncTabButton(tab);
    ctx.ui.updateStatus();
    ctx.ui.updatePanelClose();

    requestAnimationFrame(() => {
      ctx.fit.fitTerminal(tab);
      if (tab.term) tab.term.focus();
    });

    if (tab.configId && !tab.connectedOnce) {
      if (tab.needsCredentials) {
        ctx.ui.showConnectOverlay(tab, '', 'info', { fromConfig: true });
      } else {
        ctx.session.connectTab(tab, { tabId: tab.configId });
      }
    } else if (!tab.connectedOnce && !tab.configId && !ctx.ui.formTab) {
      // A blank tab created at boot or by the + button waits for the form.
    } else if (tab.notice && tab.phase !== 'ready' && tab.phase !== 'connecting') {
      ctx.ui.showConnectOverlay(tab, tab.notice.text, tab.notice.kind);
    }
  }

  function closeTab(tab) {
    const index = tabs.indexOf(tab);
    if (index === -1) return;

    ctx.session.closeSocket(tab);
    if (tab.term) {
      try {
        tab.term.dispose();
      } catch (_) {}
      tab.term = null;
    }
    tab.termEl.remove();
    tab.btn.remove();
    tabs.splice(index, 1);

    if (ctx.ui.formTab === tab) {
      ctx.ui.hideOverlay();
    }

    if (!tabs.length) {
      if (ctx.config.tabs.length) {
        rebuildConfiguredTabs();
      } else {
        const fresh = addTab({ name: 'session' });
        activateTab(fresh);
        ctx.ui.showConnectOverlay(fresh, '', 'info');
      }
      return;
    }

    if (activeTab === tab) {
      activateTab(tabs[Math.max(0, index - 1)]);
    } else {
      ctx.ui.updatePanelClose();
    }
  }

  function syncTabButton(tab) {
    const visual = phaseVisual(tab.phase);
    tab.dot.className = 'tab-dot ' + visual;
    tab.btn.classList.toggle('active', tab === activeTab);
    tab.main.classList.toggle('active-tab', tab === activeTab);
  }

  function markActivity(tab) {
    if (tab === activeTab) return;
    tab.btn.classList.add('activity');
  }

  function clearActivity(tab) {
    tab.btn.classList.remove('activity');
  }

  function getTab(id) {
    return tabs.find((tab) => tab.id === id) || null;
  }

  function rebuildConfiguredTabs() {
    for (const def of ctx.config.tabs) {
      addTab({
        id: `cfg:${def.id}`,
        configId: def.id,
        name: def.name,
        host: def.host,
        port: def.port,
        user: def.user,
        authType: def.authType,
        needsCredentials: def.needsCredentials,
      });
    }
    if (tabs.length) activateTab(tabs[0]);
  }

  function closeAll() {
    for (const tab of tabs) ctx.session.closeSocket(tab);
  }

  return {
    get tabs() {
      return tabs;
    },
    get activeTab() {
      return activeTab;
    },
    addTab,
    activateTab,
    closeTab,
    syncTabButton,
    markActivity,
    clearActivity,
    getTab,
    rebuildConfiguredTabs,
    closeAll,
  };
}

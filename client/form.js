import { els } from './dom.js';

export function readForm() {
  const host = els.host.value.trim();
  const port = Number(els.port.value) || 22;
  const user = els.user.value.trim();
  const authType = els.auth.value;

  const auth = { type: authType };
  if (authType === 'key') {
    auth.privateKey = els.privateKey.value;
    auth.passphrase = els.passphrase.value;
  } else if (authType === 'password') {
    auth.password = els.password.value;
  }

  return { host, port, user, auth };
}

export function installFormHandlers(ctx) {
  els.auth.addEventListener('change', () => ctx.ui.syncAuthFields());

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const tab = ctx.ui.formTab || ctx.tabs.activeTab;
    if (!tab || tab.phase === 'connecting') return;

    const cfg = readForm();
    if (!cfg.host) {
      ctx.ui.showNotice('Enter a host to connect to.');
      els.host.focus();
      return;
    }
    if (!cfg.user) {
      ctx.ui.showNotice('Enter a username.');
      els.user.focus();
      return;
    }
    if (cfg.auth.type === 'password' && !cfg.auth.password) {
      ctx.ui.showNotice('Enter a password, or switch to key / agent authentication.');
      els.password.focus();
      return;
    }
    if (cfg.auth.type === 'key' && !cfg.auth.privateKey.trim()) {
      ctx.ui.showNotice('Paste an OpenSSH or PEM private key, or switch auth method.');
      return;
    }

    ctx.prefs.save(cfg);
    ctx.ui.showNotice('');
    els.discover.hidden = true;
    ctx.ui.clearFingerprint();

    if (tab.term) tab.term.reset();
    tab.fingerprint = '';
    tab.notice = null;

    if (!tab.configId) {
      tab.name = cfg.user ? `${cfg.user}@${cfg.host}` : cfg.host;
      if (tab.name.length > 28) tab.name = tab.name.slice(0, 27) + '…';
      tab.label.textContent = tab.name;
      tab.host = cfg.host;
      tab.port = cfg.port;
      tab.user = cfg.user;
    }

    ctx.session.connectTab(tab, { ...cfg, tabId: tab.configId || undefined });
  });

  els.newSession.addEventListener('click', (event) => {
    event.preventDefault();
    const tab = ctx.tabs.addTab({ name: `session ${ctx.tabs.tabs.length + 1}` });
    ctx.tabs.activateTab(tab);
    ctx.ui.showConnectOverlay(tab, '', 'info');
  });

  function resumeSession() {
    const tab = ctx.ui.formTab;
    if (tab && tab.phase === 'ready') {
      ctx.ui.hideOverlay();
      els.discover.hidden = true;
      if (tab.term) tab.term.focus();
    }
  }

  els.panelClose.addEventListener('click', () => {
    const tab = ctx.ui.formTab;
    if (!tab) {
      ctx.ui.hideOverlay();
      return;
    }
    if (tab.phase === 'ready') {
      ctx.ui.hideOverlay();
      if (tab.term) tab.term.focus();
      return;
    }
    if (ctx.tabs.tabs.length > 1 && !tab.connectedOnce) {
      ctx.tabs.closeTab(tab);
      return;
    }
    ctx.ui.hideOverlay();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.overlay.hidden && ctx.ui.formTab && ctx.ui.formTab.phase === 'ready') {
      event.preventDefault();
      resumeSession();
    }
  });

  return { resumeSession };
}

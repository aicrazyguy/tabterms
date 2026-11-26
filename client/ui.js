import { els, phaseVisual } from './dom.js';

// Owns the connect-panel form target and every DOM write driven by tab phase.
export function createUi(ctx) {
  let formTab = null;

  function setPhase(tab, next, label) {
    tab.phase = next;
    tab.statusLabel = label || next;
    ctx.tabs.syncTabButton(tab);
    if (tab === ctx.tabs.activeTab) updateStatus();
    if (tab === formTab) setBusy(next === 'connecting');
    updatePanelClose();
  }

  function updateStatus() {
    const tab = ctx.tabs.activeTab;
    const visual = tab ? phaseVisual(tab.phase) : '';
    els.led.className = 'led ' + visual;
    els.dot.className = 'dot ' + visual;
    els.statusText.className = 'status-text ' + visual;
    els.statusText.textContent = tab ? tab.statusLabel || tab.phase : 'disconnected';
    els.statusHost.textContent = tab && tab.target
      ? `${tab.target.user}@${tab.target.host}:${tab.target.port}`
      : tab && tab.host
        ? `${tab.user}@${tab.host}:${tab.port}`
        : 'no session';
    els.statusHost.title = els.statusHost.textContent;
    els.statusFp.hidden = !(tab && tab.fingerprint);
    els.statusFp.textContent = tab ? tab.fingerprint : '';
    if (tab && tab.fingerprint) els.statusFp.title = 'Host key ' + tab.fingerprint;
  }

  function setBusy(busy) {
    els.connectBtn.disabled = busy;
    els.connectLabel.textContent = busy ? 'connecting…' : 'connect';
  }

  function showNotice(text, kind = 'error') {
    els.formError.hidden = !text;
    els.formError.textContent = text || '';
    els.formError.className = 'notice ' + (kind === 'info' ? 'info' : '');
  }

  function syncAuthFields() {
    const type = els.auth.value;
    els.passwordField.hidden = type !== 'password';
    els.keyField.hidden = type !== 'key';
    els.passphraseField.hidden = type !== 'key';
  }

  function clearFingerprint() {
    els.statusFp.hidden = true;
    els.statusFp.textContent = '';
  }

  function fillFormFromTab(tab) {
    if (!tab || !tab.configId) return;
    els.host.value = tab.host || '';
    els.port.value = String(tab.port || 22);
    els.user.value = tab.user || '';
    if (['password', 'key', 'agent'].includes(tab.authType)) els.auth.value = tab.authType;
    els.password.value = '';
    els.privateKey.value = '';
    els.passphrase.value = '';
    syncAuthFields();
  }

  function showConnectOverlay(tab, notice, kind = 'error', opts = {}) {
    formTab = tab || ctx.tabs.activeTab;
    els.overlay.hidden = false;
    els.panelTitle.textContent = formTab && formTab.configId ? formTab.name : 'ssh gateway';
    if (opts.fromConfig) fillFormFromTab(formTab);
    showNotice(notice || '', kind);
    setBusy(Boolean(formTab && formTab.phase === 'connecting'));
    updatePanelClose();
    requestAnimationFrame(() => {
      if (!els.host.value) els.host.focus();
    });
  }

  function hideOverlay() {
    els.overlay.hidden = true;
    showNotice('');
    formTab = null;
    setBusy(false);
    updatePanelClose();
  }

  function updatePanelClose() {
    const canClose = Boolean(
      formTab && !els.overlay.hidden && (formTab.phase === 'ready' || ctx.tabs.tabs.length > 1)
    );
    els.panelClose.hidden = !canClose;
  }

  function setFormTab(tab) {
    formTab = tab;
  }

  return {
    get formTab() {
      return formTab;
    },
    setFormTab,
    setPhase,
    updateStatus,
    setBusy,
    showNotice,
    syncAuthFields,
    clearFingerprint,
    fillFormFromTab,
    showConnectOverlay,
    hideOverlay,
    updatePanelClose,
  };
}

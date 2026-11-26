import { els } from './dom.js';

const PREFS_KEY = 'phosphor.prefs.v2';

export function createPrefs(ctx) {
  function save(cfg) {
    if (!els.remember.checked) {
      try {
        localStorage.removeItem(PREFS_KEY);
      } catch (_) {}
      return;
    }
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          host: cfg.host,
          port: cfg.port,
          user: cfg.user,
          auth: cfg.auth.type,
          remember: true,
        })
      );
    } catch (_) {}
  }

  function load() {
    let prefs = null;
    try {
      prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    } catch (_) {}
    if (prefs && prefs.remember) {
      if (prefs.host) els.host.value = prefs.host;
      if (prefs.port) els.port.value = String(prefs.port);
      if (prefs.user) els.user.value = prefs.user;
      if (prefs.auth && ['password', 'key', 'agent'].includes(prefs.auth)) els.auth.value = prefs.auth;
    }
    const params = new URLSearchParams(location.search);
    if (params.get('host')) els.host.value = params.get('host');
    if (params.get('user')) els.user.value = params.get('user');
    if (params.get('port')) els.port.value = params.get('port');
    ctx.ui.syncAuthFields();
  }

  return { save, load };
}

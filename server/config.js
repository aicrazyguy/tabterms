'use strict';

const fs = require('fs');
const path = require('path');
const { clamp, expandHome } = require('./util');

function createConfig({ rootDir, env }) {
  let source = 'none';
  let tabs = [];

  function normalizeAuth(raw) {
    const auth = raw && typeof raw === 'object' ? raw : {};
    let type = String(auth.type || '').toLowerCase();
    if (!['password', 'key', 'agent'].includes(type)) {
      if (auth.privateKey || auth.privateKeyPath || auth.keyFile) type = 'key';
      else if (auth.password !== undefined && auth.password !== '') type = 'password';
      else type = 'agent';
    }

    const out = { type };
    if (auth.password !== undefined) out.password = String(auth.password);
    if (auth.privateKey !== undefined) out.privateKey = String(auth.privateKey);
    const keyPath = auth.privateKeyPath || auth.keyFile;
    if (keyPath) out.privateKeyPath = String(keyPath);
    if (auth.passphrase !== undefined) out.passphrase = String(auth.passphrase);
    return out;
  }

  function authIsComplete(auth) {
    if (!auth) return false;
    if (auth.type === 'password') return typeof auth.password === 'string' && auth.password.length > 0;
    if (auth.type === 'key') {
      return Boolean((auth.privateKey && auth.privateKey.trim()) || auth.privateKeyPath);
    }
    if (auth.type === 'agent') return true;
    return false;
  }

  function normalizeTab(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const host = String(raw.host || '').trim();
    if (!host) return null;

    let id = String(raw.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) id = `tab-${index + 1}`;

    const port = clamp(Number(raw.port) || 22, 1, 65535);
    const user = String(raw.user || raw.username || env.USER || '').trim();
    const auth = normalizeAuth(
      raw.auth || {
        type: raw.authType,
        password: raw.password,
        privateKey: raw.privateKey,
        privateKeyPath: raw.privateKeyPath || raw.keyFile,
        passphrase: raw.passphrase,
      }
    );

    return {
      id,
      name: String(raw.name || raw.label || `${user || 'ssh'}@${host}`).slice(0, 64),
      host,
      port,
      user,
      auth,
    };
  }

  function normalizeTabs(list, from) {
    const seen = new Set();
    const result = [];
    (Array.isArray(list) ? list : []).forEach((raw, index) => {
      const tab = normalizeTab(raw, index);
      if (!tab) return;
      if (seen.has(tab.id)) {
        let suffix = 2;
        while (seen.has(`${tab.id}-${suffix}`)) suffix += 1;
        tab.id = `${tab.id}-${suffix}`;
      }
      seen.add(tab.id);
      result.push(tab);
    });
    if (result.length) source = from;
    return result;
  }

  function tabFromEnv() {
    if (!env.SSH_HOST) return null;
    const auth = normalizeAuth({
      type: env.SSH_AUTH_TYPE,
      password: env.SSH_PASSWORD,
      privateKey: env.SSH_PRIVATE_KEY,
      privateKeyPath: env.SSH_PRIVATE_KEY_PATH,
      passphrase: env.SSH_PASSPHRASE,
    });
    return normalizeTab(
      {
        name: env.SSH_NAME,
        host: env.SSH_HOST,
        port: env.SSH_PORT,
        user: env.SSH_USER,
        auth,
      },
      0
    );
  }

  function parseTabJson(text, from) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed.tabs;
      return normalizeTabs(list, from);
    } catch (err) {
      console.error(`  ! ${from} is not valid JSON: ${err.message}`);
      return [];
    }
  }

  function loadConfigTabs() {
    if (env.PHOSPHOR_TABS) {
      return parseTabJson(env.PHOSPHOR_TABS, 'env:PHOSPHOR_TABS');
    }

    const single = tabFromEnv();
    if (single) return normalizeTabs([single], 'env:SSH_*');

    const spec = String(env.PHOSPHOR_CONFIG || '').trim();
    if (spec.startsWith('{') || spec.startsWith('[')) {
      return parseTabJson(spec, 'env:PHOSPHOR_CONFIG');
    }

    const file = spec ? expandHome(spec) : path.join(rootDir, 'config.json');
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`  ! Could not read ${file}: ${err.message}`);
      return [];
    }
    return parseTabJson(raw, `file:${path.basename(file)}`);
  }

  tabs = loadConfigTabs();

  function findTab(id) {
    if (!id) return null;
    return tabs.find((tab) => tab.id === id) || null;
  }

  function publicTab(tab) {
    return {
      id: tab.id,
      name: tab.name,
      host: tab.host,
      port: tab.port,
      user: tab.user,
      authType: tab.auth.type,
      needsCredentials: !authIsComplete(tab.auth),
    };
  }

  return {
    tabs,
    source,
    configured: tabs.length > 0,
    findTab,
    publicTabs: () => tabs.map(publicTab),
    authIsComplete,
  };
}

module.exports = { createConfig };

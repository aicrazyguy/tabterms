'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createAccessToken({ rootDir, env }) {
  const value = load();

  function load() {
    const fromEnv = env.ACCESS_TOKEN;
    if (fromEnv !== undefined) {
      const trimmed = fromEnv.trim();
      if (!trimmed || trimmed === 'none' || trimmed === 'off') return null;
      return trimmed;
    }
    const tokenFile = path.join(rootDir, '.access-token');
    try {
      const existing = fs.readFileSync(tokenFile, 'utf8').trim();
      if (existing) return existing;
    } catch (_) {}
    const token = crypto.randomBytes(12).toString('base64url');
    try {
      fs.writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
    } catch (_) {}
    return token;
  }

  function matches(provided) {
    if (!value) return true;
    const a = crypto.createHash('sha256').update(String(provided || '')).digest();
    const b = crypto.createHash('sha256').update(String(value)).digest();
    return crypto.timingSafeEqual(a, b);
  }

  return { value, matches };
}

module.exports = { createAccessToken };

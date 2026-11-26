'use strict';

const os = require('os');
const path = require('path');

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, Number(n)));
}

function expandHome(value) {
  const p = String(value || '');
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

module.exports = { clamp, expandHome };

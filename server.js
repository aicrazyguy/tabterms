#!/usr/bin/env node
'use strict';

/**
 * PHOSPHOR // 80x24 SSH terminal gateway
 *
 * - Serves the static terminal UI
 * - Bridges WebSocket <-> SSH (ssh2) from the server host to any reachable host
 * - Scans the host's local subnets for SSH services
 *
 * Browsers cannot open raw TCP sockets, so the SSH hop is made here.
 */

const path = require('path');
const qrcode = require('qrcode-terminal');

const { clamp } = require('./server/util');
const { createAccessToken } = require('./server/access-token');
const { createConfig } = require('./server/config');
const { createDiscovery } = require('./server/discovery');
const { createGateway } = require('./server/gateway');
const { attachSessions } = require('./server/session');

const ROOT_DIR = __dirname;
const PORT = clamp(Number(process.env.PORT) || 7681, 1, 65535);
const BIND = process.env.HOST || '0.0.0.0';
const MAX_SESSIONS = clamp(Number(process.env.MAX_SESSIONS) || 16, 1, 256);
const COLS = 80;
const ROWS = 24;

// Import order is load-bearing: token file and config are resolved before the
// HTTP/WS server is constructed, and the listener starts last.
const token = createAccessToken({ rootDir: ROOT_DIR, env: process.env });
const config = createConfig({ rootDir: ROOT_DIR, env: process.env });
const discovery = createDiscovery();

const gateway = createGateway({
  token,
  config,
  env: process.env,
  rootDir: ROOT_DIR,
  port: PORT,
  host: BIND,
});
const { server, wss, scheme } = gateway;

attachSessions({ wss, config, discovery, maxSessions: MAX_SESSIONS, cols: COLS, rows: ROWS });

function lanUrls() {
  const urls = [];
  for (const subnet of discovery.localSubnets()) {
    urls.push(`${scheme}://${subnet.address}:${PORT}${token.value ? `/?token=${token.value}` : '/'}`);
  }
  return urls;
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use. Set PORT=<other> and try again.\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, BIND, () => {
  const suffix = token.value ? `/?token=${token.value}` : '/';
  const urls =
    BIND === '127.0.0.1' || BIND === 'localhost'
      ? [`${scheme}://localhost:${PORT}${suffix}`]
      : lanUrls();
  const line = '─'.repeat(64);

  console.log('');
  console.log(`  \x1b[32m${line}\x1b[0m`);
  console.log('  \x1b[1;32mPHOSPHOR\x1b[0m  \x1b[2m80x24 SSH TERMINAL GATEWAY\x1b[0m');
  console.log(`  \x1b[32m${line}\x1b[0m`);
  console.log('');
  for (const url of urls.length ? urls : [`${scheme}://localhost:${PORT}${suffix}`]) {
    console.log(`  →  \x1b[4;32m${url}\x1b[0m`);
  }
  if (token.value) {
    console.log(`\n  \x1b[2maccess token: ${token.value}\x1b[0m`);
    console.log('  \x1b[2m(change with ACCESS_TOKEN=... or disable with ACCESS_TOKEN=none)\x1b[0m');
  } else {
    console.log('\n  \x1b[33m⚠  access token disabled — anyone on this network can use this gateway\x1b[0m');
  }
  if (config.tabs.length) {
    console.log(
      `\n  \x1b[2m${config.tabs.length} tab${config.tabs.length === 1 ? '' : 's'} configured (${config.source})\x1b[0m`
    );
    for (const tab of config.tabs) {
      const note = config.authIsComplete(tab.auth) ? tab.auth.type : `${tab.auth.type}, credentials needed`;
      console.log(`  \x1b[2m· ${tab.name} — ${tab.user}@${tab.host}:${tab.port} (${note})\x1b[0m`);
    }
  } else {
    console.log('\n  \x1b[2mno tabs configured — the connect UI will be shown\x1b[0m');
  }
  if (urls[0] && process.stdout.isTTY) {
    console.log('');
    qrcode.generate(urls[0], { small: true }, (qr) => {
      console.log(qr.replace(/^/gm, '  '));
    });
  }
  console.log('  \x1b[2mListening on ' + BIND + ':' + PORT + ' · Ctrl+C to stop\x1b[0m');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n  \x1b[2mshutting down\x1b[0m');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});

process.on('unhandledRejection', (err) => {
  console.error('unhandled rejection:', err);
});

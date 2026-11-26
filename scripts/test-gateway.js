#!/usr/bin/env node
'use strict';

/**
 * Headless end-to-end test: WebSocket -> gateway -> SSH -> fake shell.
 * Run the gateway and scripts/test-ssh-server.js first.
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 7681;
const tokenFile = path.join(__dirname, '..', '.access-token');
const token = process.env.ACCESS_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');
const url = `ws://127.0.0.1:${PORT}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;

const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';

let output = '';
let ready = false;

const timer = setTimeout(() => fail('timed out'), 15000);

function fail(message) {
  clearTimeout(timer);
  console.error('FAIL:', message);
  console.error('--- output ---');
  console.error(JSON.stringify(output));
  try { ws.close(); } catch (_) {}
  process.exit(1);
}

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'connect', host: '127.0.0.1', port: 2222, user: 'demo', auth: { type: 'password', password: 'demo' } }));
});

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    output += Buffer.from(data).toString('utf8');
    if (ready && output.includes('demo@test')) {
      ws.send(Buffer.from('uname\r'));
    }
    if (output.includes('TestOS testhost')) {
      ws.send(Buffer.from('echo hello-from-ws\r'));
    }
    if (output.includes('hello-from-ws')) {
      console.log('PASS: ssh bridge, pty, echo and command execution all work');
      console.log('--- transcript ---');
      console.log(output.trim());
      clearTimeout(timer);
      ws.close();
      process.exit(0);
    }
    return;
  }

  const msg = JSON.parse(data.toString());
  if (msg.t === 'status' && msg.state === 'ready') ready = true;
  if (msg.t === 'status' && msg.state === 'error') fail(msg.message);
  if (msg.t === 'fingerprint') console.log('fingerprint:', msg.hash);
  if (msg.t === 'status') console.log('status:', msg.state, '-', msg.message);
});

ws.on('error', (err) => fail(err.message));
ws.on('close', () => {
  if (!output.includes('hello-from-ws')) fail('socket closed early');
});

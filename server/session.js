'use strict';

const fs = require('fs');
const { Client } = require('ssh2');
const { clamp, expandHome } = require('./util');

function attachSessions({ wss, config, discovery, maxSessions, cols, rows }) {
  let activeSessions = 0;

  wss.on('connection', (ws) => {
    if (activeSessions >= maxSessions) {
      try { ws.close(1013, 'too many sessions'); } catch (_) {}
      return;
    }

    activeSessions += 1;

    let ssh = null;
    let stream = null;
    let finished = false;
    let ready = false;

    const send = (obj) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(obj));
    };

    const finish = (message) => {
      if (finished) return;
      finished = true;
      if (stream) {
        try { stream.end(); } catch (_) {}
        stream = null;
      }
      if (ssh) {
        try { ssh.end(); } catch (_) {}
        ssh = null;
      }
      if (message !== undefined && message !== null) {
        send({ t: 'status', state: 'closed', message });
      }
      try { ws.close(); } catch (_) {}
      activeSessions = Math.max(0, activeSessions - 1);
    };

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        if (stream && stream.writable) stream.write(raw);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.t === 'scan') {
        discovery.scanLocalNetwork()
          .then((result) => send({ t: 'scan', ...result }))
          .catch((err) => send({ t: 'scan', error: err.message }));
        return;
      }

      if (msg.t === 'disconnect') {
        finish('Session closed.');
        return;
      }

      if (msg.t === 'resize') {
        if (stream) {
          try {
            stream.setWindow(clamp(Number(msg.rows) || rows, 2, 500), clamp(Number(msg.cols) || cols, 2, 500));
          } catch (_) {}
        }
        return;
      }

      if (msg.t === 'connect') {
        if (ssh || finished) {
          send({ t: 'status', state: 'error', message: 'A session is already open.' });
          return;
        }
        startSession(msg).catch((err) => {
          send({ t: 'status', state: 'error', message: err.message || 'Connection failed.' });
          finish(null);
        });
      }
    });

    async function startSession(msg) {
      const tab = config.findTab(msg.tabId);
      const host = String(msg.host || (tab && tab.host) || '').trim();
      const port = clamp(Number(msg.port || (tab && tab.port)) || 22, 1, 65535);
      const username = String(msg.user || (tab && tab.user) || '').trim();
      const auth = msg.auth && msg.auth.type ? msg.auth : (tab && tab.auth) || {};

      if (!host || !username) throw new Error('Host and username are required.');
      if (!/^[a-zA-Z0-9_.:\-\[\]]+$/.test(host)) throw new Error('That hostname looks invalid.');

      send({ t: 'status', state: 'connecting', message: `Dialing ${username}@${host}:${port}…` });
      send({ t: 'remote', host, port, user: username });

      const sshConfig = {
        host,
        port,
        username,
        readyTimeout: 25000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        hostHash: 'sha256',
        hostVerifier: (hash) => {
          const b64 = Buffer.from(hash, 'hex').toString('base64').replace(/=+$/, '');
          send({ t: 'fingerprint', hash: `SHA256:${b64}` });
          return true;
        },
      };

      if (auth.type === 'key') {
        let key = String(auth.privateKey || '').trim();
        if (!key && auth.privateKeyPath) {
          const keyPath = expandHome(auth.privateKeyPath);
          try {
            key = fs.readFileSync(keyPath, 'utf8').trim();
          } catch (err) {
            throw new Error(`Could not read private key ${keyPath}: ${err.message}`);
          }
        }
        if (!key) throw new Error('Paste a private key, or choose another auth method.');
        sshConfig.privateKey = key;
        if (auth.passphrase) sshConfig.passphrase = String(auth.passphrase);
      } else if (auth.type === 'agent') {
        if (!process.env.SSH_AUTH_SOCK) {
          throw new Error('No SSH agent found on the server host (SSH_AUTH_SOCK is unset).');
        }
        sshConfig.agent = process.env.SSH_AUTH_SOCK;
      } else {
        sshConfig.password = String(auth.password || '');
        sshConfig.tryKeyboard = true;
      }

      ssh = new Client();

      ssh.on('banner', (banner) => {
        send({ t: 'banner', message: String(banner).slice(0, 2000) });
      });

      ssh.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finishPrompts) => {
        finishPrompts(prompts.map(() => String(auth.password || '')));
      });

      ssh.on('ready', () => {
        send({ t: 'status', state: 'authenticated', message: 'Authenticated. Opening shell…' });
        ssh.shell({ term: 'xterm-256color', cols, rows }, (err, channel) => {
          if (err) {
            send({ t: 'status', state: 'error', message: `Could not open a shell: ${err.message}` });
            finish(null);
            return;
          }
          stream = channel;
          ready = true;
          send({ t: 'status', state: 'ready', message: 'Connected.' });

          channel.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data);
          });
          channel.stderr.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data);
          });
          channel.on('close', () => {
            if (finished) return;
            send({ t: 'status', state: 'closed', message: 'Remote shell exited.' });
            finish(null);
          });
        });
      });

      ssh.on('error', (err) => {
        if (finished) return;
        send({ t: 'status', state: 'error', message: explainSshError(err) });
        finish(null);
      });

      ssh.on('close', () => {
        if (finished || !ready) return;
        send({ t: 'status', state: 'closed', message: 'Connection closed by remote host.' });
        finish(null);
      });

      ssh.connect(sshConfig);
    }

    ws.on('close', () => finish(null));
    ws.on('error', () => finish(null));
  });
}

function explainSshError(err) {
  if (!err) return 'Connection failed.';
  if (err.level === 'client-authentication') {
    return 'Authentication failed — check the username, password, key, or passphrase.';
  }
  switch (err.code) {
    case 'ECONNREFUSED':
      return 'Connection refused — nothing is listening on that port.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Host not found — check the address or DNS.';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'Host unreachable from this machine.';
    case 'ETIMEDOUT':
      return 'Connection timed out.';
    case 'ECONNRESET':
      return 'Connection reset by the remote host.';
    default:
      return err.message || 'Connection failed.';
  }
}

module.exports = { attachSessions };

#!/usr/bin/env node
'use strict';

/**
 * Throwaway SSH server used to test the gateway end to end.
 * User: demo   Password: demo   Port: 2222
 *
 * Not part of the app. Run with: node scripts/test-ssh-server.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Server } = require('ssh2');

const KEY = path.join(__dirname, '.test_hostkey');
const PORT = Number(process.env.TEST_SSH_PORT || 2222);

if (!fs.existsSync(KEY)) {
  execFileSync('ssh-keygen', ['-t', 'rsa', '-b', '2048', '-m', 'PEM', '-N', '', '-f', KEY, '-q']);
}

const prompt = '\x1b[32mdemo@test\x1b[0m:\x1b[34m~\x1b[0m$ ';

function banner() {
  return (
    '\r\n\x1b[1;32m TEST-SSH 0.1\x1b[0m — a fake shell on port ' +
    PORT +
    '\r\n\x1b[2m commands: help, uname, whoami, ls, date, echo, exit\x1b[0m\r\n\r\n'
  );
}

new Server({ hostKeys: [fs.readFileSync(KEY)] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === 'demo' && ctx.password === 'demo') {
      return ctx.accept();
    }
    if (ctx.method === 'publickey' && ctx.username === 'demo' && ctx.signature) {
      return ctx.accept();
    }
    if (ctx.method === 'none') return ctx.reject(['password']);
    return ctx.reject(['password']);
  });

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();
      session.on('pty', (acceptPty) => acceptPty && acceptPty());
      session.on('window-change', () => {});
      session.on('shell', (acceptShell) => {
        const stream = acceptShell();
        let buffer = '';

        stream.write(banner());
        stream.write(prompt);

        stream.on('data', (chunk) => {
          for (const ch of chunk.toString('utf8')) {
            if (ch === '\r' || ch === '\n') {
              const line = buffer.trim();
              buffer = '';
              stream.write('\r\n');
              if (!line) {
                stream.write(prompt);
                continue;
              }
              if (line === 'exit' || line === 'logout') {
                stream.write('\x1b[2mconnection closed\x1b[0m\r\n');
                stream.exit(0);
                stream.end();
                return;
              }
              stream.write(handle(line));
              stream.write('\r\n' + prompt);
            } else if (ch === '\x7f' || ch === '\b') {
              if (buffer.length) {
                buffer = buffer.slice(0, -1);
                stream.write('\b \b');
              }
            } else if (ch === '\x03') {
              buffer = '';
              stream.write('^C\r\n' + prompt);
            } else if (ch >= ' ') {
              buffer += ch;
              stream.write(ch);
            }
          }
        });
      });
    });
  });

  client.on('error', () => {});
}).listen(PORT, '127.0.0.1', () => {
  console.log(`test ssh server on 127.0.0.1:${PORT} (demo/demo)`);
});

function handle(line) {
  const [cmd, ...rest] = line.split(/\s+/);
  switch (cmd) {
    case 'help':
      return 'commands: help, uname, whoami, ls, date, echo, exit';
    case 'uname':
      return 'TestOS testhost 1.0 fake-kernel x86_64';
    case 'whoami':
      return 'demo';
    case 'ls':
      return 'README.txt  bin  etc  home  tmp  var';
    case 'date':
      return new Date().toString();
    case 'echo':
      return rest.join(' ');
    default:
      return `sh: ${cmd}: command not found`;
  }
}

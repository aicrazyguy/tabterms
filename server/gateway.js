'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

function createGateway({ token, config, env, rootDir, port, host }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok\n'));

  app.get('/api/config', (req, res) => {
    if (!token.matches(req.query.token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      configured: config.configured,
      source: config.source,
      tabs: config.publicTabs(),
    });
  });

  app.use(
    express.static(path.join(rootDir, 'public'), {
      etag: true,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Permissions-Policy', 'clipboard-read=(self), clipboard-write=(self)');
        }
      },
    })
  );

  const server = createServer();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const scheme = server instanceof require('https').Server ? 'https' : 'http';

  function createServer() {
    const certFile = env.TLS_CERT;
    const keyFile = env.TLS_KEY;
    if (certFile && keyFile) {
      const https = require('https');
      return https.createServer(
        { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) },
        app
      );
    }
    const http = require('http');
    return http.createServer(app);
  }

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (_) {
      return socket.destroy();
    }
    if (url.pathname !== '/ws') return socket.destroy();
    if (!token.matches(url.searchParams.get('token'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return { app, server, wss, scheme, port, host };
}

module.exports = { createGateway };

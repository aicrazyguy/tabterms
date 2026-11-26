import { TOKEN, WS_PROTO } from './dom.js';

// Owns WebSocket lifecycle and the inbound control protocol for one tab.
export function createSession(ctx) {
  function wsUrl() {
    return `${WS_PROTO}//${location.host}/ws${TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : ''}`;
  }

  function openSocket() {
    const ws = new WebSocket(wsUrl());
    ws.binaryType = 'arraybuffer';
    return ws;
  }

  function closeSocket(tab) {
    if (!tab || !tab.socket) return;
    const old = tab.socket;
    tab.socket = null;
    try {
      old.close();
    } catch (_) {}
  }

  function connectTab(tab, cfg) {
    closeSocket(tab);

    tab.target = {
      host: cfg.host || tab.host,
      port: cfg.port || tab.port || 22,
      user: cfg.user || tab.user,
    };
    tab.connectedOnce = true;
    tab.notice = null;
    tab.fingerprint = '';
    ctx.ui.setPhase(tab, 'connecting', 'dialing…');

    let ws;
    try {
      ws = openSocket();
    } catch (_) {
      ctx.ui.setPhase(tab, 'error', 'unreachable');
      tab.notice = { text: 'Could not create a WebSocket connection to this gateway.', kind: 'error' };
      if (tab === ctx.tabs.activeTab) ctx.ui.showConnectOverlay(tab, tab.notice.text);
      return;
    }
    tab.socket = ws;

    ws.onopen = () => {
      const message = { t: 'connect' };
      if (cfg.tabId) message.tabId = cfg.tabId;
      if (cfg.host) message.host = cfg.host;
      if (cfg.port) message.port = cfg.port;
      if (cfg.user) message.user = cfg.user;
      if (cfg.auth) message.auth = cfg.auth;
      ws.send(JSON.stringify(message));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        handleControl(tab, msg);
        return;
      }
      if (tab.term) tab.term.write(new Uint8Array(event.data));
      if (tab !== ctx.tabs.activeTab) ctx.tabs.markActivity(tab);
    };

    ws.onclose = () => {
      if (tab.socket !== ws) return;
      tab.socket = null;
      if (tab.phase === 'connecting') {
        ctx.ui.setPhase(tab, 'error', 'unreachable');
        tab.notice = {
          text:
            'The gateway closed the connection before a session started.\n' +
            'Check that the server is running and that this page was opened with its access token.',
          kind: 'error',
        };
        if (tab === ctx.tabs.activeTab) ctx.ui.showConnectOverlay(tab, tab.notice.text);
      } else if (tab.phase === 'ready') {
        ctx.ui.setPhase(tab, 'disconnected', 'session ended');
        tab.notice = { text: 'Session ended.', kind: 'info' };
        if (tab === ctx.tabs.activeTab) ctx.ui.showConnectOverlay(tab, tab.notice.text, 'info');
      }
    };

    ws.onerror = () => {
      // onclose carries the recovery UI.
    };
  }

  function handleControl(tab, msg) {
    switch (msg.t) {
      case 'status': {
        if (msg.state === 'connecting') {
          ctx.ui.setPhase(tab, 'connecting', msg.message ? 'dialing…' : 'connecting…');
        } else if (msg.state === 'authenticated') {
          ctx.ui.setPhase(tab, 'connecting', 'opening shell…');
        } else if (msg.state === 'ready') {
          ctx.ui.setPhase(tab, 'ready', 'connected');
          if (ctx.ui.formTab === tab) ctx.ui.hideOverlay();
          if (tab === ctx.tabs.activeTab) requestAnimationFrame(() => tab.term && tab.term.focus());
        } else if (msg.state === 'error') {
          ctx.ui.setPhase(tab, 'error', 'error');
          tab.notice = { text: msg.message || 'Connection failed.', kind: 'error' };
          if (tab === ctx.tabs.activeTab) ctx.ui.showConnectOverlay(tab, tab.notice.text);
        } else if (msg.state === 'closed') {
          if (tab.phase === 'ready' || tab.phase === 'connecting') {
            ctx.ui.setPhase(tab, 'disconnected', 'session ended');
            tab.notice = { text: msg.message || 'Session ended.', kind: 'info' };
            if (tab === ctx.tabs.activeTab) ctx.ui.showConnectOverlay(tab, tab.notice.text, 'info');
          }
        }
        break;
      }
      case 'remote':
        if (tab.target) {
          tab.target.host = msg.host || tab.target.host;
          if (tab === ctx.tabs.activeTab) ctx.ui.updateStatus();
        }
        break;
      case 'fingerprint':
        tab.fingerprint = msg.hash;
        if (tab === ctx.tabs.activeTab) ctx.ui.updateStatus();
        break;
      case 'banner':
        break;
      default:
        break;
    }
  }

  function sendInput(tab, bytes) {
    if (tab.phase === 'ready' && tab.socket && tab.socket.readyState === WebSocket.OPEN) {
      tab.socket.send(bytes);
    }
  }

  return { wsUrl, openSocket, closeSocket, connectTab, handleControl, sendInput };
}

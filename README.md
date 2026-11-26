# TABTERMS — 80×24 SSH terminal

A green-on-black character terminal in the browser. Exactly **80 columns × 24 rows**, CRT scanlines, WebGL-accelerated rendering (xterm.js), and a server-side SSH client (ssh2) so it can reach **any host on your local network**.

```
   ┌──────────────────────────────────────────────────────────┐
   │  TABTERMS / 80×24                              scan lan  │
   ├──────────────────────────────────────────────────────────┤
   │                                                          │
   │   demo@fileserver:~$ uptime                              │
   │    19:04  up 42 days,  3:11,  2 users,  load 0.14        │
   │                                                          │
   ├──────────────────────────────────────────────────────────┤
   │  ● connected   demo@192.168.1.20:22   SHA256:9f3c…  19:04│
   └──────────────────────────────────────────────────────────┘
```

## Run

```bash
npm install
npm run build
npm start
```

The server prints a LAN URL with an access token, plus a QR code. Open that URL on any device on the same network.

Default port is `7681`. Override with `PORT=9000 npm start`.

## Use

1. Enter a host (or press **discover hosts** — it probes every address on the local subnet for TCP/22 and reads the SSH banner).
2. Choose auth: **password / keyboard-interactive**, **private key** (OpenSSH or PEM, optional passphrase), or **ssh-agent** on the gateway machine.
3. **connect**. The terminal grid is fixed at 80×24; font size scales to fit the window, so phones and 5K displays both work.
4. Use the tab strip to run several independent SSH sessions side by side. **+ tab** opens another session; the × on a tab ends it. Switching tabs keeps every session alive.
5. `esc` or the ✕ in the panel returns to a live session.

Host/user/port/auth preference is remembered locally; **passwords and keys are never stored**.

## Tabs (config.json)

Tabs can be predefined so the connect UI is not shown at all. Copy the example and edit it:

```bash
cp config.example.json config.json
chmod 600 config.json
```

```json
{
  "tabs": [
    {
      "id": "web-01",
      "name": "web-01",
      "host": "192.168.1.20",
      "port": 22,
      "user": "deploy",
      "auth": { "type": "password", "password": "change-me" }
    },
    {
      "id": "db-01",
      "name": "db-01",
      "host": "192.168.1.30",
      "user": "root",
      "auth": { "type": "key", "privateKeyPath": "~/.ssh/id_ed25519" }
    },
    {
      "id": "router",
      "name": "router",
      "host": "192.168.1.1",
      "user": "admin",
      "auth": { "type": "agent" }
    }
  ]
}
```

- `auth.type` is `password`, `key`, or `agent`.
- For keys, use `privateKey` (inline PEM/OpenSSH) or `privateKeyPath` (read on the gateway when connecting).
- A tab whose credentials are missing still appears, but opens the connect panel prefilled with its host/user.
- Every session tab is independent: each has its own WebSocket and SSH connection and keeps running while you switch tabs.
- Each connected tab counts toward `MAX_SESSIONS` (default 16); raise it if you configure more tabs.
- The configuration UI is shown only when **no tabs are defined by environment variables and there is no `config.json`** (or it defines no tabs).
- `config.json` may contain secrets — it is gitignored. Keep it readable only by the service user.

Environment variables take precedence over `config.json`:

| env | meaning |
| --- | --- |
| `TABTERMS_TABS` | inline JSON array of tabs (same schema as `config.json`) |
| `TABTERMS_CONFIG` | path to another JSON file, or inline JSON |
| `SSH_HOST` | define a single tab from env; also accepts `SSH_PORT`, `SSH_USER`, `SSH_NAME`, `SSH_AUTH_TYPE`, `SSH_PASSWORD`, `SSH_PRIVATE_KEY`, `SSH_PRIVATE_KEY_PATH`, `SSH_PASSPHRASE` |

`SSH_HOST` without a password or key defaults to `agent` authentication.

## Deploy (this Mac, LAN)

Installed as a per-user LaunchAgent so it starts at login and restarts if it crashes:

```bash
launchctl print gui/$(id -u)/com.tabterms.term    # status
launchctl kickstart -k gui/$(id -u)/com.tabterms.term  # restart
launchctl bootout gui/$(id -u)/com.tabterms.term  # stop + uninstall
```

- App: `/Users/sam/tabterms` (symlinked from `/Users/sam/Documents/term`)
- LaunchAgent: `~/Library/LaunchAgents/com.tabterms.term.plist`
- Logs: `tabterms.log`, `tabterms.err.log`
- Access token: `.access-token` (persisted so the URL stays stable)

The app lives in the home directory rather than `~/Documents` because macOS privacy
protection blocks launchd-spawned processes from reading `~/Documents` (the service
would hang on its first file read). `~/Documents/term` is a symlink to the real path.

## Configuration

| env | default | meaning |
| --- | --- | --- |
| `PORT` | `7681` | HTTP port |
| `HOST` | `0.0.0.0` | bind address (`127.0.0.1` for local-only) |
| `ACCESS_TOKEN` | generated & saved | required in the URL (`?token=…`); `none` disables |
| `MAX_SESSIONS` | `16` | concurrent WebSocket sessions |
| `TLS_CERT` / `TLS_KEY` | – | serve HTTPS/WSS with a cert + key |

Example HTTPS deployment:

```bash
TLS_CERT=/etc/ssl/term.crt TLS_KEY=/etc/ssl/term.key npm start
```

## Architecture

```
browser ── xterm.js (WebGL) ── WebSocket ── node gateway ── ssh2 ── sshd
```

Browsers cannot open raw TCP sockets, so the gateway keeps the SSH connection and relays PTY bytes over a WebSocket. Terminal output travels as binary frames; control messages (connect, scan, status, fingerprint) are JSON.

`server.js` is a thin entrypoint: it resolves the token and tab config, builds the gateway, attaches session handlers, then starts listening. Everything else lives in one module per responsibility. The browser bundle is assembled by esbuild from `client/main.js`; each module receives a `ctx` object filled in dependency order and keeps its own mutable state private.

Server modules:

| File | Owns |
| --- | --- |
| `server/access-token.js` | token file, token comparison |
| `server/config.js` | tab precedence, normalization, public projection |
| `server/gateway.js` | HTTP routes, static files, TLS choice, `/ws` upgrade auth |
| `server/session.js` | one WebSocket ↔ SSH session, control messages, error wording |
| `server/discovery.js` | subnet scan, probe pool, 15s cache |
| `server/util.js` | `clamp`, `expandHome` |

Client modules:

| File | Owns |
| --- | --- |
| `client/dom.js` | DOM ids, constants, theme, phase visual mapping |
| `client/ui.js` | status bar, connect panel, notices, phase fan-out |
| `client/tabs.js` | tab list, active tab, terminal instances |
| `client/session.js` | WebSocket lifecycle and inbound control protocol |
| `client/discovery.js` | discovery panel and its separate scan socket |
| `client/form.js` | form validation, submit and panel handlers |
| `client/prefs.js` | localStorage preferences (never secrets) |
| `client/fit.js` | 80×24 font-size fit and resize listeners |
| `client/main.js` | dependency wiring, boot, clock, debug hook |

Where to make a change:

| Change | Edit |
| --- | --- |
| New auth method | `server/config.js`, `server/session.js`, `public/index.html`, `client/form.js` |
| New WebSocket control message | `server/session.js`, `client/session.js` |
| New config field | `server/config.js` (normalize + public projection), `client/tabs.js` if shown in UI |
| New discovery field | `server/discovery.js`, `client/discovery.js` |
| New DOM id or class | `public/index.html`, `client/dom.js`, `public/style.css`, and the browser tests |
| New user-facing journey | `.opencode/skills/verify-tabterms/features/` |

`public/` — HTML, CSS, bundled client (`app.js` / `app.css`)
`config.example.json` — tab configuration template (copy to `config.json`)
`scripts/test-ssh-server.js` — throwaway SSH server (demo/demo on :2222)
`scripts/test-gateway.js` — headless test of the SSH bridge
`scripts/smoke.js` — Chrome end-to-end test (layout, session, resize, scan, auth failure)

```bash
npm run build          # bundle client
npm run dev            # unminified bundle + serve
node scripts/test-ssh-server.js &   # test target
node scripts/test-gateway.js        # protocol test
node scripts/smoke.js               # browser test (needs local Chrome)
```

## Security notes

This is a gateway with real credentials — treat it like a door to your network.

- By default the URL requires a **random 96-bit access token**. Anyone with the URL can SSH as anyone;
  keep it private, or put the gateway behind a VPN.
- HTTP on the LAN is **not encrypted**. On untrusted Wi-Fi, use the `TLS_CERT`/`TLS_KEY` option
  (or bind to `127.0.0.1` and tunnel through SSH: `ssh -L 7681:localhost:7681 you@this-mac`).
- SSH **host keys are accepted on first use** and their SHA-256 fingerprint is shown in the status bar.
  There is no persistent known_hosts store, so a MITM is not detected.
- Credentials live only in memory for the length of the session; the server does not log them.
- `ssh-agent` auth uses the agent of the machine running the gateway (`SSH_AUTH_SOCK`).

## Requirements

Node.js ≥ 18. Tested with Node 20 and Chrome/Safari/Firefox.

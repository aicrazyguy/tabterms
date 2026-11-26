// Selector and constant registry. The ids and classes here are a contract with
// public/index.html, public/style.css, and the browser verification journeys.
export const COLS = 80;
export const ROWS = 24;
export const TOKEN = new URLSearchParams(location.search).get('token') || '';
export const WS_PROTO = location.protocol === 'https:' ? 'wss:' : 'ws:';

export const $ = (id) => document.getElementById(id);
export const els = {
  stage: $('stage'),
  terminals: $('terminals'),
  tabs: $('tabs'),
  overlay: $('overlay'),
  form: $('connect-form'),
  formError: $('form-error'),
  panelTitle: $('panel-title'),
  host: $('host'),
  port: $('port'),
  user: $('user'),
  auth: $('auth'),
  password: $('password'),
  passwordField: $('password-field'),
  privateKey: $('private-key'),
  keyField: $('key-field'),
  passphrase: $('passphrase'),
  passphraseField: $('passphrase-field'),
  remember: $('remember'),
  connectBtn: $('connect-btn'),
  connectLabel: $('connect-label'),
  panelClose: $('panel-close'),
  discoverBtn: $('discover-btn'),
  discover: $('discover'),
  discoverTitle: $('discover-title'),
  discoverList: $('discover-list'),
  discoverClose: $('discover-close'),
  scanBtn: $('scan-btn'),
  newSession: $('new-session'),
  led: $('led'),
  dot: $('status-dot'),
  statusText: $('status-text'),
  statusHost: $('status-host'),
  statusFp: $('status-fp'),
  statusClock: $('status-clock'),
};

export const TERM_THEME = {
  background: '#000000',
  foreground: '#3dff86',
  cursor: '#c4ffd8',
  cursorAccent: '#001b0c',
  selectionBackground: 'rgba(61, 255, 134, 0.30)',
  selectionForeground: '#eafff1',
  black: '#020604',
  red: '#ff6b6b',
  green: '#3dff86',
  yellow: '#ffd166',
  blue: '#5aa9ff',
  magenta: '#c08bff',
  cyan: '#5fffd7',
  white: '#c9ffd9',
  brightBlack: '#1a7c3f',
  brightRed: '#ff9a96',
  brightGreen: '#8dffb8',
  brightYellow: '#ffe3a3',
  brightBlue: '#9bcaff',
  brightMagenta: '#dcb8ff',
  brightCyan: '#a7ffe9',
  brightWhite: '#eafff2',
};

export const encoder = new TextEncoder();

export function phaseVisual(phase) {
  if (phase === 'ready') return 'ready';
  if (phase === 'connecting') return 'connecting';
  if (phase === 'error') return 'error';
  return '';
}

export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

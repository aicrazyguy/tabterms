#!/usr/bin/env node
'use strict';

/**
 * Browser-level smoke test using the locally installed Chrome.
 * Requires the gateway + scripts/test-ssh-server.js to be running.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { PNG } = require('pngjs');

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = process.env.PORT || 7681;
const tokenFile = path.join(__dirname, '..', '.access-token');
const token = process.env.ACCESS_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');
const base = `http://127.0.0.1:${PORT}/?token=${encodeURIComponent(token)}`;

const outDir = process.env.SHOT_DIR || '/private/var/folders/zy/yvs528c51dx3zzvd2bfntdd40000gn/T/opencode';

function log(...args) {
  console.log(...args);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  async function shoot(name) {
    await page.screenshot({ path: path.join(outDir, name) });
    log('  screenshot:', path.join(outDir, name));
  }

  function analyze(name) {
    const png = PNG.sync.read(fs.readFileSync(path.join(outDir, name)));
    const total = png.width * png.height;
    let green = 0;
    let dark = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (g > 90 && g > r * 1.4 && g > b * 1.2) green += 1;
      if (r < 24 && g < 24 && b < 24) dark += 1;
    }
    return { greenPct: +((green / total) * 100).toFixed(2), darkPct: +((dark / total) * 100).toFixed(2) };
  }

  // --- desktop layout -----------------------------------------------------
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));

  const geometry = await page.evaluate(() => {
    const screen = document.querySelector('.xterm-screen').getBoundingClientRect();
    const stage = document.getElementById('stage').getBoundingClientRect();
    const term = window.__tabterms.term;
    return {
      cols: term.cols,
      rows: term.rows,
      fontSize: term.options.fontSize,
      screen: { w: Math.round(screen.width), h: Math.round(screen.height) },
      stage: { w: Math.round(stage.width), h: Math.round(stage.height) },
      fits: screen.width <= stage.width && screen.height <= stage.height,
      overlayVisible: !document.getElementById('overlay').hidden,
      bg: getComputedStyle(document.body).backgroundColor,
      fg: getComputedStyle(document.getElementById('status-text')).color,
    };
  });
  log('desktop geometry:', geometry);
  await shoot('01-connect.png');

  // --- connect to the fake ssh server ------------------------------------
  await page.type('#host', '127.0.0.1');
  await page.click('#port', { clickCount: 3 });
  await page.type('#port', '2222');
  await page.type('#user', 'demo');
  await page.type('#password', 'demo');
  await shoot('02-filled.png');

  await page.click('#connect-btn');
  await page.waitForFunction(() => window.__tabterms.phase === 'ready', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));

  const session = await page.evaluate(() => {
    const b = window.__tabterms.term.buffer.active;
    const lines = [];
    for (let i = 0; i < b.length; i += 1) {
      const line = b.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    return {
      text: lines.join('\n'),
      overlayHidden: document.getElementById('overlay').hidden,
      status: document.getElementById('status-text').textContent,
      host: document.getElementById('status-host').textContent,
      fp: document.getElementById('status-fp').textContent,
      fontSize: window.__tabterms.term.options.fontSize,
    };
  });
  log('session:', {
    overlayHidden: session.overlayHidden,
    status: session.status,
    host: session.host,
    fp: session.fp,
    fontSize: session.fontSize,
  });
  log('terminal contains prompt:', /demo@test/.test(session.text));

  await page.type('.xterm-helper-textarea', 'uname\r');
  await new Promise((r) => setTimeout(r, 700));
  const afterCmd = await page.evaluate(() => {
    const b = window.__tabterms.term.buffer.active;
    let text = '';
    for (let i = 0; i < b.length; i += 1) {
      const line = b.getLine(i);
      if (line) text += line.translateToString(true) + '\n';
    }
    return text;
  });
  log('command output arrived:', /TestOS testhost/.test(afterCmd));
  await shoot('03-session.png');

  const afterSessionGeom = await page.evaluate(() => {
    const screen = document.querySelector('.xterm-screen').getBoundingClientRect();
    const stage = document.getElementById('stage').getBoundingClientRect();
    return {
      w: Math.round(screen.width),
      h: Math.round(screen.height),
      fits: screen.width <= stage.width && screen.height <= stage.height,
      cols: window.__tabterms.term.cols,
      rows: window.__tabterms.term.rows,
    };
  });
  log('session geometry:', afterSessionGeom);

  // --- new session -> overlay --------------------------------------------
  await page.click('#new-session');
  await new Promise((r) => setTimeout(r, 300));
  const overlayBack = await page.evaluate(() => !document.getElementById('overlay').hidden);
  log('overlay returns after new session:', overlayBack);

  // --- mobile layout ------------------------------------------------------
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 900));
  const mobile = await page.evaluate(() => {
    const panel = document.querySelector('.panel').getBoundingClientRect();
    const screen = document.querySelector('.xterm-screen').getBoundingClientRect();
    const stage = document.getElementById('stage').getBoundingClientRect();
    return {
      panelW: Math.round(panel.width),
      panelH: Math.round(panel.height),
      panelInside: panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0,
      viewport: { w: innerWidth, h: innerHeight },
      screen: { w: Math.round(screen.width), h: Math.round(screen.height) },
      stage: { w: Math.round(stage.width), h: Math.round(stage.height) },
      fits: screen.width <= stage.width && screen.height <= stage.height,
    };
  });
  log('mobile layout:', mobile);
  await shoot('04-mobile.png');

  // --- scan ---------------------------------------------------------------
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 400));
  await page.click('#scan-btn');
  await page.waitForFunction(
    () => {
      const t = document.getElementById('discover-title').textContent;
      return /found|failed|No SSH/i.test(t);
    },
    { timeout: 40000 }
  );
  const scan = await page.evaluate(() => ({
    title: document.getElementById('discover-title').textContent,
    rows: [...document.querySelectorAll('.host-row')].map((r) => r.textContent.trim()),
    empty: document.querySelector('.discover-empty')?.textContent?.trim() || null,
  }));
  log('scan:', scan);
  await shoot('05-scan.png');
  log('colors (connect screen):', analyze('01-connect.png'));
  log('colors (live session):', analyze('03-session.png'));

  // --- resume a live session after opening the overlay -------------------
  await page.click('#password');
  await page.type('#password', 'demo');
  await page.click('#connect-btn');
  await new Promise((r) => setTimeout(r, 1800));
  log(
    'post-connect state:',
    await page.evaluate(() => ({
      phase: window.__tabterms.phase,
      noticeHidden: document.getElementById('form-error').hidden,
      notice: document.getElementById('form-error').textContent,
      btn: document.getElementById('connect-label').textContent,
      disabled: document.getElementById('connect-btn').disabled,
      host: document.getElementById('host').value,
      port: document.getElementById('port').value,
      user: document.getElementById('user').value,
    }))
  );
  await page.waitForFunction(() => window.__tabterms.phase === 'ready', { timeout: 15000 });
  await page.click('#scan-btn');
  await new Promise((r) => setTimeout(r, 500));
  const closeVisible = await page.evaluate(() => !document.getElementById('panel-close').hidden);
  await page.click('#panel-close');
  await new Promise((r) => setTimeout(r, 250));
  const resumed = await page.evaluate(() => ({
    overlayHidden: document.getElementById('overlay').hidden,
    phase: window.__tabterms.phase,
  }));
  log('panel close while live:', { closeVisible, ...resumed });
  await shoot('06-resumed.png');

  // --- authentication failure --------------------------------------------
  await page.click('#new-session');
  await page.click('#password', { clickCount: 3 });
  await page.type('#password', 'wrong-password');
  await page.click('#connect-btn');
  await page.waitForFunction(
    () => {
      const el = document.getElementById('form-error');
      return !el.hidden && /authentication|failed|denied/i.test(el.textContent);
    },
    { timeout: 15000 }
  );
  const authError = await page.evaluate(() => document.getElementById('form-error').textContent.trim());
  log('auth error shown:', JSON.stringify(authError));
  await shoot('07-auth-error.png');

  log('page errors:', errors.length ? errors : 'none');

  await browser.close();

  const colorsSession = analyze('03-session.png');
  const ok =
    geometry.cols === 80 &&
    geometry.rows === 24 &&
    geometry.fits &&
    session.overlayHidden &&
    /demo@test/.test(session.text) &&
    /TestOS testhost/.test(afterCmd) &&
    afterSessionGeom.fits &&
    mobile.panelInside &&
    mobile.fits &&
    closeVisible &&
    resumed.overlayHidden &&
    resumed.phase === 'ready' &&
    /authentication|failed|denied/i.test(authError) &&
    colorsSession.greenPct > 1 &&
    colorsSession.darkPct > 50;

  if (!ok) {
    console.error('SMOKE TEST FAILED');
    process.exit(1);
  }
  console.log('SMOKE TEST PASSED');
})().catch((err) => {
  console.error('SMOKE TEST ERROR:', err);
  process.exit(1);
});

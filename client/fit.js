import { els, nextFrame } from './dom.js';

// Fits the fixed 80x24 grid by changing font size only. Never changes cols/rows.
export function createFitter(ctx) {
  let fitting = false;
  let refitQueued = null;
  let resizeTimer = null;

  async function fitTerminal(tab) {
    if (!tab || !tab.term) return;
    if (fitting) {
      refitQueued = tab;
      return;
    }
    fitting = true;
    try {
      const term = tab.term;
      const availW = Math.max(120, els.stage.clientWidth - 26);
      const availH = Math.max(80, els.stage.clientHeight - 26);

      let size = 16;
      term.options.fontSize = size;

      for (let i = 0; i < 8; i += 1) {
        await nextFrame();
        if (tab.term !== term) return;
        const screenEl = term.element && term.element.querySelector('.xterm-screen');
        if (!screenEl) break;
        const rect = screenEl.getBoundingClientRect();
        if (!rect.width || !rect.height) break;
        const k = Math.min(availW / rect.width, availH / rect.height);
        if (k > 0.985 && k < 1.015) break;
        const next = Math.round(Math.min(46, Math.max(5, size * k)) * 20) / 20;
        if (Math.abs(next - size) < 0.05) break;
        size = next;
        term.options.fontSize = size;
      }
    } finally {
      fitting = false;
      const queued = refitQueued;
      refitQueued = null;
      if (queued) fitTerminal(queued);
    }
  }

  function scheduleFit() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => fitTerminal(ctx.tabs.activeTab), 80);
  }

  window.addEventListener('resize', scheduleFit);
  window.addEventListener('orientationchange', scheduleFit);
  if ('ResizeObserver' in window) {
    new ResizeObserver(scheduleFit).observe(els.stage);
  }

  return { fitTerminal, scheduleFit };
}

const { Plugin } = require('obsidian');

const EMBED_URL = 'https://naman.world/embeds/bpe.html';

module.exports = class BpeEmbedResize extends Plugin {
  onload() {
    const windows = new WeakSet();
    const originalHeights = new Map();
    const isEmbed = frame => frame.tagName === 'IFRAME' && frame.src === EMBED_URL;
    const requestHeight = frame => {
      // Sandboxed frames have opaque origins, so address their specific window.
      if (isEmbed(frame)) frame.contentWindow?.postMessage({ type: 'bpe:measure' }, '*');
    };
    const attach = win => {
      if (!win || windows.has(win)) return;
      windows.add(win);
      this.registerDomEvent(win, 'message', event => {
        const { type, height } = event.data ?? {};
        if (type !== 'bpe:height' || !Number.isFinite(height) || height <= 0 || height > 20000) return;
        if (event.origin !== 'null' && event.origin !== 'https://naman.world') return;
        for (const frame of win.document.querySelectorAll('iframe')) {
          // Never let another frame or an arbitrary message resize this embed.
          if (!isEmbed(frame) || frame.contentWindow !== event.source) continue;
          if (!originalHeights.has(frame)) originalHeights.set(frame, frame.style.height);
          frame.style.height = `${Math.ceil(height) + 2}px`;
        }
        for (const frame of originalHeights.keys()) {
          if (!frame.isConnected) originalHeights.delete(frame);
        }
      });
      this.registerDomEvent(win.document, 'load', event => requestHeight(event.target), true);
      win.document.querySelectorAll('iframe').forEach(requestHeight);
    };
    attach(window);
    this.app.workspace.iterateAllLeaves(leaf => attach(leaf.view.containerEl.ownerDocument.defaultView));
    this.registerEvent(this.app.workspace.on('window-open', (_, win) => attach(win)));
    this.register(() => {
      for (const [frame, height] of originalHeights) frame.style.height = height;
    });
  }
};

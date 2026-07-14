/* Regenerate the app icons in icons/ from the gradient "TL" mark.
 *
 * Renders them with headless Chrome, so there is no image-library dependency.
 * Only needed if you change the branding — the icons are committed.
 *
 *   node scripts/make-icons.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9444;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  `--user-data-dir=${join(OUT, '..', '.chrome-icons-profile')}`, 'about:blank',
], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, { method: 'PUT' });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome did not start. Set CHROME_PATH if Chrome lives elsewhere.');
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((r) => pending.set(i, r));
};

await send('Page.enable');

// `pad` insets the glyph for maskable icons: Android may crop to a circle, so
// the mark has to sit well inside the edges.
const html = (size, pad, radius) => {
  const inner = size - pad * 2;
  return `<!doctype html><meta charset="utf-8">
  <style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
    body{background:#4f46e5;display:grid;place-items:center}
    .plate{width:${size}px;height:${size}px;border-radius:${radius}px;
      background:linear-gradient(140deg,#4f46e5,#c084fc);display:grid;place-items:center}
    .t{color:#fff;font:700 ${inner * 0.42}px/1 -apple-system,"SF Pro Text","Helvetica Neue",Arial,sans-serif;
      letter-spacing:${-inner * 0.02}px}
  </style>
  <div class="plate"><div class="t">TL</div></div>`;
};

async function shot(size, pad, radius, name) {
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html(size, pad, radius)) });
  await sleep(400);
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(res.result.data, 'base64'));
  console.log('wrote icons/' + name);
}

await shot(192, 0, 38, 'icon-192.png');
await shot(512, 0, 102, 'icon-512.png');
await shot(512, 96, 0, 'icon-maskable-512.png');   // full bleed, glyph inset
await shot(180, 0, 0, 'apple-touch-icon.png');     // iOS applies its own mask

chrome.kill();
process.exit(0);

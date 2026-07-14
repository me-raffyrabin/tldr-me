# TLDR Me

**[▶ Live preview](https://me-raffyrabin.github.io/tldr-me/)** — heads up: the first visit downloads the model (~350 MB), so give it a moment. Every visit after that is instant.

Paste a link, get a swipeable summary. The summarizing model runs **entirely in your browser** — the page you're reading is never sent to a summarization server.

No build step, no bundler, no backend, no API key.

```
index.html              the entire app — UI, engines, summarization
manifest.webmanifest    PWA metadata, so Android can install it
sw.js                   service worker: makes it installable + caches the shell
icons/                  app icons (generated, safe to regenerate)
```

---

## How it works

1. **On launch**, the app downloads a small language model and caches it in the browser. The first visit pays for the download; every visit after that starts in about a second and works offline.
2. **You paste a URL.** The app fetches that page's text and strips it down to readable content.
3. **The local model summarizes it** and returns a one-line TLDR, 3–5 main points, and a few takeaways.
4. **The result renders as swipeable cards** — swipe on touch, arrow keys or on-screen arrows on desktop.

### Two engines, picked automatically

| | Engine | Model | Size | Used when |
|---|---|---|---|---|
| **A** | [WebLLM](https://github.com/mlc-ai/web-llm) (WebGPU) | Qwen2.5-0.5B-Instruct | ~350 MB | WebGPU is available |
| **B** | [Transformers.js](https://github.com/huggingface/transformers.js) (WASM) | DistilBART-CNN | ~150 MB | Fallback, no WebGPU |

Engine A is an instruction-tuned chat model, so it can be asked for structured output directly. Because a 0.5B model cannot reliably hand-write valid JSON, the app uses **grammar-constrained decoding** against a schema — malformed JSON is made structurally impossible rather than something we try to repair after the fact.

Engine B is a dedicated summarization model with a short context window, so the app chunks the article and summarizes each chunk into one card. It exists so that browsers without WebGPU (notably older iOS Safari) still work.

The status chip in the header tells you which engine you got (`Model ready · GPU` / `· CPU`).

---

## Running it

The app must be served over HTTP. Opening `index.html` as a `file://` URL will **not** work — the model libraries load as ES modules and web workers, which the file protocol blocks.

```bash
npx serve          # then open the printed http://localhost:… URL
# or
python3 -m http.server 8000
```

### Deploying

It's static, so any static host works (GitHub Pages, Netlify, Vercel, S3, Cloudflare Pages).

The live preview above is GitHub Pages, served from the repo root: **Settings → Pages → Source: `Deploy from a branch` → `main` / `/ (root)`**. Push, wait a minute, done.

Pages also serves over HTTPS, which isn't just a nicety here — the service worker only registers over HTTPS (or `localhost`), and without it Android will never offer the install prompt.

---

## Browser support

| Browser | Works | Engine |
|---|---|---|
| Chrome / Edge, desktop | Yes | WebGPU |
| Safari 26+, macOS | Yes | WebGPU |
| Chrome, Android | Yes | WebGPU, or WASM on older devices |
| Safari, iOS 26+ | Yes | WebGPU |
| Safari, older iOS | Yes | WASM fallback (slower, smaller model) |

On low-memory phones the WASM path is the realistic one, and summarizing takes noticeably longer than on desktop.

---

## Things you should know before shipping this

**The page fetch is not local.** Browsers cannot read cross-origin pages, so the app fetches article text through public reader/CORS proxies (`r.jina.ai`, with two fallbacks). This means:

- The URL you paste is visible to that third-party proxy.
- **Don't paste links to private, internal, or logged-in pages.**
- Those proxies are rate-limited and can go down. For anything production-facing, replace the `READERS` list in `index.html` with your own fetch endpoint.

The *summarization* is genuinely local. The *fetching* is not, and can't be, in a pure browser app.

**The default model is small.** Qwen2.5-0.5B gets the gist right but will occasionally state something the article didn't. It's a 350 MB model doing a job that frontier models do with hundreds of billions of parameters — treat the output as a preview, not a citation.

If quality matters more than download size, change one line near the top of the script in `index.html`:

```js
const GPU_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';   // ~1.1 GB, noticeably better
```

**Paywalled and JS-heavy pages** often yield little or no readable text. The app will tell you rather than invent a summary.

---

## Customizing

Everything lives in `index.html`.

- **Models** — `GPU_MODEL` / `CPU_MODEL` constants at the top of the script.
- **How the page is fetched** — the `READERS` array.
- **What the summary looks like** — `SCHEMA` and `userPrompt()`.
- **Colors, spacing, dark mode** — the CSS custom properties in `:root`.

### Theme

The header has a light/dark toggle. It defaults to your OS preference, and once you pick a theme explicitly it's remembered in `localStorage` (`tldrme:theme`) and applied before first paint, so there's no flash of the wrong palette on reload.

---

## Add to Home Screen

An **Add to Home Screen** button appears **only on Android and iOS phones/tablets**, and hides itself once the app is already installed. Desktop never sees it.

The two platforms need completely different handling:

- **Android (Chrome)** — the button appears only after Chrome fires `beforeinstallprompt`, i.e. only once it has confirmed the app really is installable. Tapping it opens Chrome's native install dialog. If Chrome never fires the event, the button never appears, so it can't become a dead end.
- **iOS (Safari)** — there is no install API, and Apple provides no way for a site to install itself. The button opens a sheet explaining the two manual taps (Share → Add to Home Screen). This is the only thing any website can do on iOS.

Installability on Android requires all three of a manifest, icons, and a service worker with a fetch handler — which is what `manifest.webmanifest` and `sw.js` are for. **Installing also requires HTTPS** (or `localhost`); over plain `http://` on a LAN address, the service worker won't register and the Android button will never appear.

The service worker deliberately does **not** cache the model weights. WebLLM and Transformers.js maintain their own caches, and copying hundreds of megabytes into a second cache would waste storage and fight their eviction logic.

### Regenerating the icons

The icons are generated from the app's own gradient mark. They're committed, so you only need this if you change the branding — it renders them with headless Chrome:

```bash
node scripts/make-icons.mjs    # see the script for the Chrome debug-port setup
```

---

## Privacy

- Article text and summaries are processed in your browser and are not sent anywhere.
- Model weights are downloaded from a public CDN (Hugging Face / jsDelivr) and cached locally.
- Pasted URLs *are* sent to the reader proxy described above.
- No analytics, no cookies, no accounts.

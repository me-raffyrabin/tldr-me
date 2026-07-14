# TLDR Me

**TLDR Me** is a lightweight, privacy-minded web app that uses a small AI model that moves in once, unpacks on your device, and reads the long stuff so you don't have to. It never phones home — it doesn't even have a phone.

---

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

## Recent links

The last **25** summarized URLs are kept in `localStorage` (`tldrme:recents`) and shown as chips under the input. Tap one to summarize it again. Re-running a link already in the list moves it to the top instead of adding a duplicate, and **Clear all** wipes the list (behind a confirm, since it can't be undone).

Nothing is synced anywhere — clear your browser data and the list is gone with it.

---

## Sharing

Every summary gets a share row: **Copy link, Facebook, X, Instagram, SMS, Email**.

The interesting part is what "Copy link" actually copies. The summary exists *only* on the device that generated it — there is no server to fetch it back from. So the link carries the summary **inside itself**:

```
https://…/?u=<source url>#s=<summary, deflate-compressed then base64url>
```

Opening that link renders the cards **instantly** — no model download, no summarization, not even a re-fetch of the original article. (Verified by opening a share link with every model CDN *and* every reader proxy blocked: all cards still render.)

Two details worth knowing:

- The summary rides in the URL **fragment** (`#s=`), which browsers never send to the server. Even on a hosted deploy, the summary is not transmitted to the host.
- If the compressed summary would push the link past ~1800 characters, it degrades to just `?u=<source url>`, and the recipient's device re-summarizes locally. A slower link beats a broken one.

**Instagram is the odd one out.** It has no web link-sharing endpoint — there is no URL you can open to hand it a link. On mobile the button opens the OS share sheet (where Instagram is a genuine target); on desktop it copies the link and says to paste it. Any site claiming to "share to Instagram" from a web page is doing one of those two things.

SMS also needs per-platform handling: iOS wants `sms:&body=`, Android wants `sms:?body=`. Using the wrong one opens an empty message.

---

## Privacy

- Article text and summaries are processed in your browser and are not sent anywhere.
- Model weights are downloaded from a public CDN (Hugging Face / jsDelivr) and cached locally.
- Pasted URLs *are* sent to the reader proxy described above.
- Recent links stay in `localStorage` on your device.
- Shared links carry the summary in the fragment, which is never sent to the server — but anyone holding the link can read the summary, so treat a share link as public.
- No analytics, no cookies, no accounts.

---

## 📄 License

Released under the [MIT License — use it, fork it, forge with it.](LICENSE). © 2026 realgothamknights.

---

<p align="center">Made with ✨ and a love for forging things.</p>

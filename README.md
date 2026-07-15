# TLDR Me

**TLDR Me** is a lightweight, privacy-minded web app that uses a small AI model that moves in once, unpacks on your device, and reads the long stuff so you don't have to. It never phones home — it doesn't even have a phone.

---

**[▶ Live preview](https://me-raffyrabin.github.io/tldr-me/)** — heads up: the first visit downloads the model (~350 MB), so give it a moment. Every visit after that is instant.

Paste a link, get a swipeable summary. The summarizing model runs **entirely in your browser** — the page you're reading is never sent to a summarization server.

No build step, no bundler, no backend, no API key.

```
index.html              main app — UI, engines, fetching, summarization
trust-engine.js         deterministic Trust & Source signal scoring
manifest.webmanifest    PWA metadata, so Android can install it
sw.js                   service worker: makes it installable + caches the shell
icons/                  app icons (generated, safe to regenerate)
scripts/                 icon tooling + Trust & Source unit tests
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

The interface, fetching, and summarization paths live in `index.html`; the pure, unit-testable Trust & Source scorer lives in `trust-engine.js`.

- **Models** — `GPU_MODEL` / `CPU_MODEL` constants at the top of the script.
- **How the page is fetched** — the `READERS` array.
- **What the summary looks like** — `SCHEMA` and `userPrompt()`.
- **Colors, spacing, dark mode** — the CSS custom properties in `:root`.

### Theme

The header has a light/dark toggle. It defaults to your OS preference, and once you pick a theme explicitly it's remembered in `localStorage` (`tldrme:theme`) and applied before first paint, so there's no flash of the wrong palette on reload.

---

## Tags: refocusing a summary

Each summary comes with **10 topic tags** the model pulled from the article, shown as buttons under the title. Select up to **3** and the cards are **regenerated** — re-summarized through the lens of those tags, not just filtered. Picking `plants` on the photosynthesis article gets you different cards, not the same cards with unrelated ones hidden.

Three implementation notes, since none of this is free:

- **Regenerating needs the article text, not the summary.** The app keeps the fetched text in memory for the current page. Tagging a summary that arrived via a *share link* has no text to work from, so it re-fetches the article first (you'll see "Fetching the article to refocus…").
- **Reset is instant.** The unfocused summary is cached, so clearing the tags re-renders it without running the model again.
- **The WASM engine can't be prompted.** DistilBART only summarizes; it takes no instructions. So on that path tags come from keyword extraction (weighted toward proper nouns), and "focus" means feeding the model only the chunks of the article that actually mention the tag. Different mechanism, same idea.

Tags travel inside share links too, so a recipient can refocus a summary you sent them.

Tag quality tracks model quality: the 0.5B model occasionally invents a tag that isn't really in the article. The 1.5B swap noted above helps here.

---

## Trust & Source

TLDR Me evaluates observable sourcing, attribution, publisher transparency, article freshness, and available corroboration. The meter describes the strength of the available signals; it is **not a truth verdict** and is not a substitute for a professional fact-check.

The final score is calculated locally with deterministic JavaScript rules. The local model may extract structured observations from the article, but it never chooses the score. The five weighted categories are:

| Category | Weight |
|---|---:|
| Evidence and references | 30 |
| Attribution and reporting clarity | 20 |
| Publisher transparency | 20 |
| Freshness and content integrity | 15 |
| Independent corroboration actually identified | 15 |

The score is normalized against the points the browser could genuinely assess. Coverage of 70–84% receives a 3-point uncertainty adjustment; coverage of 50–69% receives a 7-point adjustment and caps the result at 79. Below 50% coverage, the interface shows a question mark and **Limited information available** instead of presenting a weakly supported number.

WebLLM can classify compact semantic signals such as named sourcing, uncertainty, article type, and headline/body consistency. The WASM fallback cannot reliably follow that structured prompt, so it uses conservative JavaScript heuristics for quotations, attribution language, metadata, dates, labels, and evidence links. Both paths use the same final scoring function and methodology version. Missing or unconfirmed corroboration is left unassessed rather than invented.

The assessment excludes political viewpoint, publisher fame, audience size, domain age, and social popularity. A small publication with strong primary evidence can therefore outscore a well-known publication with weak sourcing. A trust signal describes what was observable in this article and its source pages; a professional fact-check investigates whether a particular claim is accurate using additional reporting.

Trust analysis stays on the device. Article URLs already pass through the configured reader proxies, and up to three optional publisher-accountability page checks may use the same proxy. No score is uploaded to a scoring service. Assessments are cached in `localStorage` for 24 hours by a hash of the normalized article URL; full article text is never stored in that cache.

Limitations: reader proxies can omit metadata or links, publisher pages may be unavailable, and local language-model observations can be imperfect. The coverage line makes those gaps visible, and the “Why this score?” disclosure lists concise evidence and limitations without claiming that the article is true, false, unbiased, or verified.

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

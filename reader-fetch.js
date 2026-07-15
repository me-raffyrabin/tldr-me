export class ReaderTimeoutError extends Error {
  constructor(timeoutMs){
    super(`Reader timed out after ${Math.ceil(timeoutMs / 1000)} seconds`);
    this.name = 'ReaderTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function plainMarkdownLine(line){
  return String(line || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function plausibleAuthor(value){
  const author = plainMarkdownLine(value)
    .replace(/^(?:by\s*)+/i, '')
    .replace(/\s+(?:\||•)\s+.*$/, '')
    .trim();
  if (!author || author.length > 120 || /https?:|www\.|@/i.test(author)) return '';
  if (author.split(/\s+/).length > 10 || !/\p{L}/u.test(author)) return '';
  if (/^(?:clicking|using|submitting|continuing|signing|comparison|contrast|design|default|law|the time)\b/i.test(author)) return '';
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’.\-–,&\s]+$/u.test(author)) return '';
  return author;
}

// Jina commonly leaves a publisher's visible byline in the Markdown instead
// of promoting it to an `Author:` metadata field. Only inspect standalone
// lines near the article start so prose containing "by" is never treated as a
// byline.
export function authorFromReaderMarkdown(markdown){
  const lines = String(markdown || '').slice(0, 6000).split(/\r?\n/).slice(0, 60);
  for (let i = 0; i < lines.length; i++){
    const line = plainMarkdownLine(lines[i]);
    const inline = line.match(/^by[\s\u00a0:–—-]+(.+)$/i);
    if (inline){
      const author = plausibleAuthor(inline[1]);
      if (author) return author;
    }
    if (/^by:?$/i.test(line)){
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++){
        const next = plainMarkdownLine(lines[j]);
        if (!next) continue;
        const author = plausibleAuthor(next);
        if (author) return author;
        break;
      }
    }
  }
  return '';
}

// The timeout covers both response headers and the complete body. Promise.race
// is intentional: some WebKit/network combinations do not promptly reject a
// stalled response body when AbortController fires.
export async function fetchTextWithTimeout(url, {
  timeoutMs = 10000,
  headers = {},
  fetchImpl = globalThis.fetch,
} = {}){
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ReaderTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetchImpl(url, { signal:controller.signal, headers });
    const body = response.ok ? await response.text() : '';
    return { response, body };
  })();
  try { return await Promise.race([request, timeout]); }
  finally { clearTimeout(timer); }
}

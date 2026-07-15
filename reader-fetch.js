export class ReaderTimeoutError extends Error {
  constructor(timeoutMs){
    super(`Reader timed out after ${Math.ceil(timeoutMs / 1000)} seconds`);
    this.name = 'ReaderTimeoutError';
    this.timeoutMs = timeoutMs;
  }
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

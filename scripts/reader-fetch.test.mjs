import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../reader-fetch.js', import.meta.url), 'utf8');
const { ReaderTimeoutError, authorFromReaderMarkdown, fetchTextWithTimeout } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('extracts an MS NOW-style standalone byline from reader Markdown', () => {
  const markdown = `Jul. 12, 2026, 6:00 AM EDT\n\nBy Emma Freer\n\nWhen Congress passed a spending package...`;
  assert.equal(authorFromReaderMarkdown(markdown), 'Emma Freer');
});

test('extracts a linked author when the By label is on its own line', () => {
  const markdown = `Published today\n\n**By**\n\n[María O'Neill](https://example.test/authors/maria)\n\nArticle text.`;
  assert.equal(authorFromReaderMarkdown(markdown), "María O'Neill");
});

test('does not infer an author from ordinary prose', () => {
  const markdown = `The bill was passed by lawmakers.\n\nBy comparison, last year's total was lower.`;
  assert.equal(authorFromReaderMarkdown(markdown), '');
});

test('timeout remains active while a response body is stalled', async () => {
  let signal;
  const fetchImpl = async (_url, options) => {
    signal = options.signal;
    return { ok:true, status:200, text:() => new Promise(() => {}) };
  };
  const started = Date.now();
  await assert.rejects(
    fetchTextWithTimeout('https://example.test/article', { timeoutMs:25, fetchImpl }),
    ReaderTimeoutError,
  );
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - started < 250, 'stalled body should not hang indefinitely');
});

test('successful response body is returned before the deadline', async () => {
  const fetchImpl = async () => ({ ok:true, status:200, text:async () => 'article body' });
  const { response, body } = await fetchTextWithTimeout('https://example.test/article', {
    timeoutMs:100,
    fetchImpl,
  });
  assert.equal(response.status, 200);
  assert.equal(body, 'article body');
});

test('HTTP errors return immediately without waiting for a body', async () => {
  let bodyRead = false;
  const fetchImpl = async () => ({
    ok:false,
    status:403,
    text:async () => { bodyRead = true; return 'blocked'; },
  });
  const { response, body } = await fetchTextWithTimeout('https://example.test/article', {
    timeoutMs:100,
    fetchImpl,
  });
  assert.equal(response.status, 403);
  assert.equal(body, '');
  assert.equal(bodyRead, false);
});

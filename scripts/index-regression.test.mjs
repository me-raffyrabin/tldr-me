import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('main submit initializes trust assessment state before using it', () => {
  const submit = between("els.form.addEventListener('submit'", '/* ---------------- 10. start');
  const sequenceAt = submit.indexOf('const assessmentSeq = ++trustSeq');
  const cacheAt = submit.indexOf('const cachedTrust = readTrustCache(target)');
  const useAt = submit.indexOf('cachedTrust.then');
  assert.ok(sequenceAt > -1, 'assessment sequence must be initialized in submit');
  assert.ok(cacheAt > sequenceAt, 'trust cache must be initialized after sequence setup');
  assert.ok(useAt > cacheAt, 'trust cache must be initialized before use');
});

test('tag refocusing does not recalculate article trust state', () => {
  const regenerate = between('async function regenerate()', '/* ---------------- 9. share');
  assert.doesNotMatch(regenerate, /readTrustCache\(|assessmentSeq|completeTrustAnalysis/);
});

test('reader pipeline has a bounded deadline and no rejected CorsProxy fallback', () => {
  const readers = between('const READERS = [', '// r.jina.ai returns');
  assert.match(readers, /PAGE_LOAD_DEADLINE = 24000/);
  assert.match(readers, /Trying backup reader/);
  assert.doesNotMatch(readers, /corsproxy\.io/);
});

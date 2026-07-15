import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../trust-engine.js', import.meta.url), 'utf8');
const {
  compactTrustResult,
  expandCompactTrustResult,
  extractTrustSignals,
  normalizeTrustResult,
  scoreTrustSignals,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const link = (host, category, sameDomain = false) => ({ url: `https://${host}/source`, text: 'Supporting source', host, category, sameDomain });
const article = (overrides = {}) => ({
  title: 'Agency releases climate report after a two-year study',
  published: '2026-07-14T19:30:00Z',
  modified: '2026-07-14T20:00:00Z',
  author: 'Alex Rivera',
  publisher: 'Civic Ledger',
  articleType: 'news',
  text: 'Alex Rivera said the agency published its findings. According to court records, “The study found a 12% change,” Rivera explained. The estimate may change as more data arrives.',
  sourceUrl: 'https://civic.example/report',
  links: [link('agency.gov', 'government'), link('university.edu', 'research'), link('other-news.example', 'news')],
  metadata: { hasArticleType: true, hasStructuredData: true, hasCanonicalUrl: true, linksExtracted: true },
  ...overrides,
});

const strongChecks = {
  aboutAssessed: true, ownershipDisclosed: true, editorialLeadership: true, fundingDisclosed: true,
  standardsAssessed: true, correctionsPolicy: true,
  contactAssessed: true, contactAvailable: true,
};

test('strong original reporting receives a high score with clear coverage', () => {
  const signals = extractTrustSignals(article(), '', {
    articleType: 'news', namedSourceCount: 3, anonymousSourceCount: 0,
    attributedClaimLevel: 'strong', uncertaintyDisclosed: true,
    headlineBodyConsistency: 'consistent', evidenceVsAllegationClear: true,
  }, strongChecks);
  const result = scoreTrustSignals(signals);
  assert.ok(result.score >= 85, `expected >= 85, got ${result.score}`);
  assert.ok(result.coveragePercent >= 85);
  assert.equal(result.sufficientInformation, true);
});

test('publisher fame alone cannot create a high score', () => {
  const weak = article({
    author: '', publisher: 'Famous Global News', modified: '',
    text: 'Sources say something important happened. People believe it may have happened.',
    links: [], metadata: { linksExtracted: true },
  });
  const result = scoreTrustSignals(extractTrustSignals(weak));
  assert.ok(result.score < 70, `expected below 70, got ${result.score}`);
});

test('author and publisher metadata do not affect the assessment', () => {
  const withDetails = scoreTrustSignals(extractTrustSignals(article(), '', null, strongChecks));
  const withoutDetails = scoreTrustSignals(extractTrustSignals(article({ author: '', publisher: '' }), '', null, strongChecks));
  assert.equal(withoutDetails.score, withDetails.score);
  assert.equal(withoutDetails.coveragePercent, withDetails.coveragePercent);
  assert.deepEqual(withoutDetails.categories, withDetails.categories);
  assert.deepEqual(withoutDetails.signals, withDetails.signals);
});

test('small publishers can score well when observable evidence is strong', () => {
  const small = article({ publisher: 'Local Desk', sourceUrl: 'https://small.example/report' });
  const result = scoreTrustSignals(extractTrustSignals(small, '', {
    articleType: 'news', namedSourceCount: 4, anonymousSourceCount: 0,
    attributedClaimLevel: 'strong', uncertaintyDisclosed: true,
    headlineBodyConsistency: 'consistent', evidenceVsAllegationClear: true,
  }, strongChecks));
  assert.ok(result.score >= 80, `expected >= 80, got ${result.score}`);
});

test('clearly labeled opinion is assessed without an opinion penalty', () => {
  const opinion = article({ articleType: 'opinion', text: `Opinion: ${article().text}` });
  const result = scoreTrustSignals(extractTrustSignals(opinion, '', {
    articleType: 'opinion', namedSourceCount: 2, anonymousSourceCount: 0,
    attributedClaimLevel: 'moderate', uncertaintyDisclosed: true,
    headlineBodyConsistency: 'consistent', evidenceVsAllegationClear: true,
  }, strongChecks));
  assert.equal(result.adjustments.some((item) => item.points < 0), false);
});

test('disclosed sponsorship does not create a misconduct deduction', () => {
  const sponsored = article({ articleType: 'sponsored', text: `Sponsored content. ${article().text}` });
  const result = scoreTrustSignals(extractTrustSignals(sponsored));
  assert.equal(result.adjustments.some((item) => item.points < 0), false);
});

test('insufficient metadata and sourcing produces the question-mark state', () => {
  const sparse = article({
    title: 'A short item', published: '', modified: '', author: '', publisher: '', articleType: 'unknown',
    text: 'A brief item with no sourcing details or links.', links: [], metadata: { linksExtracted: false },
  });
  const result = scoreTrustSignals(extractTrustSignals(sparse));
  assert.ok(result.coveragePercent < 50, `expected coverage below 50, got ${result.coveragePercent}`);
  assert.equal(result.sufficientInformation, false);
  assert.equal(result.label, 'Limited information available');
});

test('WASM-style heuristic extraction uses the same deterministic scorer', () => {
  const signals = extractTrustSignals(article(), article().sourceUrl, null, {});
  const first = scoreTrustSignals(signals);
  const second = scoreTrustSignals(signals);
  assert.equal(first.score, second.score);
  assert.equal(first.coveragePercent, second.coveragePercent);
});

test('unavailable optional publisher checks degrade gracefully', () => {
  const result = scoreTrustSignals(extractTrustSignals(article(), '', null, {}));
  assert.ok(Number.isInteger(result.score));
  assert.equal(result.categories.publisherTransparency.assessable, 0);
});

test('compact shared results round-trip and malformed values are clamped', () => {
  const original = scoreTrustSignals(extractTrustSignals(article(), '', null, strongChecks));
  const restored = expandCompactTrustResult(compactTrustResult(original));
  assert.equal(restored.score, original.score);
  assert.equal(restored.coveragePercent, original.coveragePercent);
  assert.equal(normalizeTrustResult({ score: 999, coveragePercent: -5 }).score, 100);
  assert.equal(expandCompactTrustResult(null), null);
});

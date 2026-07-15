export const TRUST_METHOD_VERSION = 2;
export const TRUST_CACHE_TTL = 24 * 60 * 60 * 1000;

const MAXIMUMS = {
  evidence: 30,
  attribution: 15,
  publisherTransparency: 15,
  freshnessIntegrity: 15,
  corroboration: 15,
};
const TOTAL_SCORING_POINTS = Object.values(MAXIMUMS).reduce((sum, points) => sum + points, 0);

const ARTICLE_TYPES = new Set(['news', 'analysis', 'opinion', 'satire', 'sponsored', 'unknown']);
const CLAIM_LEVELS = new Set(['strong', 'moderate', 'weak', 'unknown']);
const CONSISTENCY = new Set(['consistent', 'mixed', 'conflicting', 'unknown']);
const RESULT_LABELS = new Set(['Strong trust signals', 'Generally supported', 'Mixed or incomplete signals', 'Limited supporting evidence', 'Significant concerns identified', 'Limited information available']);
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(n)) ? Number(n) : min));

function safeText(value, max = 240){
  return String(value || '').trim().slice(0, max);
}

function enumValue(value, allowed, fallback = 'unknown'){
  const normalized = String(value || '').toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

export function normalizeModelTrustSignals(value){
  const o = value && typeof value === 'object' ? value : {};
  return {
    articleType: enumValue(o.articleType, ARTICLE_TYPES),
    namedSourceCount: Math.round(clamp(o.namedSourceCount, 0, 20)),
    anonymousSourceCount: Math.round(clamp(o.anonymousSourceCount, 0, 20)),
    attributedClaimLevel: enumValue(o.attributedClaimLevel, CLAIM_LEVELS),
    uncertaintyDisclosed: o.uncertaintyDisclosed === true,
    headlineBodyConsistency: enumValue(o.headlineBodyConsistency, CONSISTENCY),
    evidenceVsAllegationClear: o.evidenceVsAllegationClear === true,
  };
}

function matches(text, expression){
  return (String(text || '').match(expression) || []).length;
}

function unique(values){
  return [...new Set(values.filter(Boolean))];
}

function headlineConsistency(title, text){
  const stop = new Set('the a an and or but for with from into over after before this that these those says said'.split(' '));
  const terms = unique(String(title || '').toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter((w) => !stop.has(w));
  if (terms.length < 3 || !text) return 'unknown';
  const body = String(text).toLowerCase();
  const ratio = terms.filter((term) => body.includes(term)).length / terms.length;
  if (ratio >= .55) return 'consistent';
  if (ratio >= .25) return 'mixed';
  return 'unknown';
}

function articleTypeFromText(article){
  const declared = enumValue(article.articleType, ARTICLE_TYPES);
  if (declared !== 'unknown') return declared;
  const sample = `${article.title || ''} ${article.text || ''}`.slice(0, 1800).toLowerCase();
  if (/\b(sponsored|paid content|advertisement|advertorial)\b/.test(sample)) return 'sponsored';
  if (/\b(opinion|editorial|commentary)\b/.test(sample)) return 'opinion';
  if (/\b(analysis|explainer)\b/.test(sample)) return 'analysis';
  if (/\b(satire|parody)\b/.test(sample)) return 'satire';
  return 'unknown';
}

export function extractTrustSignals(article = {}, articleUrl = '', modelValue = null, publisherChecks = {}){
  const model = normalizeModelTrustSignals(modelValue);
  const text = String(article.text || '');
  const links = Array.isArray(article.links) ? article.links : [];
  const metadata = article.metadata && typeof article.metadata === 'object' ? article.metadata : {};
  const attributionPattern = /\b(said|told|according to|reported by|the report states|data from|court records|the study found|records show|documents show)\b/gi;
  const vaguePattern = /\b(sources say|people familiar with|some believe|it is (?:being reported|rumou?red)|reportedly)\b/gi;
  const uncertaintyPattern = /\b(alleg(?:e|es|ed|edly|ation)|could|may|might|unclear|not independently verified|cannot confirm|preliminary|estimated)\b/gi;
  const namedPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:said|told|wrote|reported|testified|explained|confirmed)\b/g;
  const quoteCount = matches(text, /(?:“[^”]{18,}”|"[^"\n]{18,}")/g);
  const attributedQuoteCount = matches(text, /(?:said|told|wrote|reported|testified|explained|confirmed)[^.!?]{0,90}(?:“|")|(?:”|")[^.!?]{0,70}(?:said|told|wrote|reported|testified|explained|confirmed)/gi);
  const heuristicNamed = unique([...text.matchAll(namedPattern)].map((m) => m[1])).length;
  const heuristicAnonymous = matches(text, vaguePattern);
  const articleType = model.articleType !== 'unknown' ? model.articleType : articleTypeFromText(article);
  const heuristicConsistency = headlineConsistency(article.title, text);
  const headlineBodyConsistency = model.headlineBodyConsistency !== 'unknown'
    ? model.headlineBodyConsistency
    : heuristicConsistency;
  const statisticSentences = (text.match(/[^.!?]*(?:\b\d+(?:\.\d+)?%|\bpercent\b)[^.!?]*[.!?]/gi) || []);
  const attributionTestPattern = /\b(said|told|according to|reported by|the report states|data from|court records|the study found|records show|documents show)\b/i;
  const attributedStatisticCount = statisticSentences.filter((s) => attributionTestPattern.test(s)).length;

  const evidenceLinks = links.filter((l) => ['primary', 'government', 'research', 'document', 'news'].includes(l.category));
  const primaryLinks = evidenceLinks.filter((l) => ['primary', 'government', 'document'].includes(l.category));
  const researchLinks = evidenceLinks.filter((l) => l.category === 'research');
  const independentNewsLinks = evidenceLinks.filter((l) => l.category === 'news' && !l.sameDomain);
  const factCheckLinks = independentNewsLinks.filter((l) => /(^|\.)(factcheck\.org|politifact\.com|snopes\.com|fullfact\.org)$/i.test(l.host || ''));

  return {
    articleUrl: article.sourceUrl || articleUrl || '',
    articleType,
    articleTypeExplicit: !!metadata.hasArticleType,
    hasPublishedDate: !!article.published,
    hasModifiedDate: !!article.modified,
    hasStructuredData: !!metadata.hasStructuredData,
    hasCanonicalUrl: !!metadata.hasCanonicalUrl,
    linksExtracted: metadata.linksExtracted !== false,
    primarySourceCount: primaryLinks.length,
    primarySourceHosts: unique(primaryLinks.map((l) => l.host)).length,
    researchSourceCount: researchLinks.length,
    relevantExternalLinkCount: evidenceLinks.filter((l) => !l.sameDomain).length,
    independentNewsHosts: unique(independentNewsLinks.map((l) => l.host)).length,
    factCheckCount: factCheckLinks.length,
    namedSourceCount: Math.max(heuristicNamed, model.namedSourceCount),
    anonymousSourceCount: Math.max(heuristicAnonymous, model.anonymousSourceCount),
    anonymousContextProvided: /\b(?:spoke|requested anonymity|not authorized)[^.!?]{0,100}\b(?:because|due to|to discuss)\b/i.test(text),
    attributionCount: matches(text, attributionPattern),
    vagueAttributionCount: heuristicAnonymous,
    attributedClaimLevel: model.attributedClaimLevel,
    uncertaintyDisclosed: model.uncertaintyDisclosed || uncertaintyPattern.test(text),
    headlineBodyConsistency,
    headlineConsistencyFromModel: model.headlineBodyConsistency !== 'unknown',
    evidenceVsAllegationClear: model.evidenceVsAllegationClear || /\b(?:alleged|allegation|according to|the (?:report|filing|complaint) (?:says|states|claims))\b/i.test(text),
    quoteCount,
    attributedQuoteCount,
    statisticCount: statisticSentences.length,
    attributedStatisticCount,
    correctionsDisclosed: /\b(correction|clarification|updated to (?:add|reflect|correct))\b/i.test(text.slice(0, 5000)),
    sponsoredDisclosure: articleType === 'sponsored' && /\b(sponsored|paid content|advertisement|advertorial)\b/i.test(text.slice(0, 1800)),
    publisherChecks: publisherChecks && typeof publisherChecks === 'object' ? publisherChecks : {},
  };
}

function category(maximum){
  return { earned: 0, assessable: 0, maximum };
}

function assess(target, points, isAssessable, earned){
  if (!isAssessable) return;
  target.assessable += points;
  if (earned) target.earned += points;
}

function addSignal(list, type, label){
  if (!label || list.some((item) => item.label === label) || list.length >= 6) return;
  list.push({ type, label });
}

export function scoreTrustSignals(signals = {}){
  const categories = Object.fromEntries(Object.entries(MAXIMUMS).map(([key, maximum]) => [key, category(maximum)]));
  const notes = [];
  const linksKnown = signals.linksExtracted !== false;
  const hasTextSignals = Number.isFinite(signals.namedSourceCount) || Number.isFinite(signals.attributionCount);

  assess(categories.evidence, 6, linksKnown, signals.primarySourceCount >= 1);
  assess(categories.evidence, 5, linksKnown, signals.primarySourceHosts >= 2);
  assess(categories.evidence, 4, linksKnown, signals.researchSourceCount >= 1);
  assess(categories.evidence, 4, hasTextSignals, signals.namedSourceCount >= 2);
  assess(categories.evidence, 3, signals.statisticCount > 0, signals.attributedStatisticCount > 0);
  assess(categories.evidence, 3, linksKnown, signals.relevantExternalLinkCount >= 1);
  assess(categories.evidence, 3, true, !!signals.evidenceVsAllegationClear);
  assess(categories.evidence, 2, signals.quoteCount > 0, signals.attributedQuoteCount > 0);
  if (signals.vagueAttributionCount >= 2 && !signals.namedSourceCount) categories.evidence.earned -= 6;
  if (signals.statisticCount > 0 && !signals.attributedStatisticCount) categories.evidence.earned -= 4;
  if ((signals.attributedClaimLevel === 'weak' || signals.attributionCount === 0) && !signals.primarySourceCount && !signals.relevantExternalLinkCount){
    categories.evidence.earned -= 4;
  }

  assess(categories.attribution, 4, hasTextSignals, signals.namedSourceCount >= 1);
  assess(categories.attribution, 3, signals.anonymousSourceCount > 0, !!signals.anonymousContextProvided);
  assess(categories.attribution, 3, true, signals.attributionCount >= 2 || ['strong', 'moderate'].includes(signals.attributedClaimLevel));
  assess(categories.attribution, 2, signals.articleType !== 'unknown' || signals.attributedClaimLevel !== 'unknown', signals.articleType !== 'unknown' || !!signals.evidenceVsAllegationClear);
  assess(categories.attribution, 2, true, !!signals.uncertaintyDisclosed);
  assess(categories.attribution, 1, true, !!signals.articleTypeExplicit);

  const checks = signals.publisherChecks || {};
  assess(categories.publisherTransparency, 4, !!checks.aboutAssessed, !!checks.ownershipDisclosed);
  assess(categories.publisherTransparency, 3, !!checks.aboutAssessed, !!checks.editorialLeadership);
  assess(categories.publisherTransparency, 3, !!checks.standardsAssessed, !!checks.correctionsPolicy);
  assess(categories.publisherTransparency, 2, !!checks.contactAssessed, !!checks.contactAvailable);
  assess(categories.publisherTransparency, 2, signals.articleType === 'sponsored', !!signals.sponsoredDisclosure);
  assess(categories.publisherTransparency, 1, !!checks.aboutAssessed, !!checks.fundingDisclosed);

  assess(categories.freshnessIntegrity, 3, true, !!signals.hasPublishedDate);
  assess(categories.freshnessIntegrity, 2, true, !!signals.hasModifiedDate);
  assess(categories.freshnessIntegrity, 3, signals.headlineBodyConsistency !== 'unknown', signals.headlineBodyConsistency === 'consistent');
  assess(categories.freshnessIntegrity, 1, true, !!signals.hasCanonicalUrl || !!signals.hasStructuredData);
  assess(categories.freshnessIntegrity, 1, !!signals.correctionsDisclosed, true);
  assess(categories.freshnessIntegrity, 1, true, !!signals.articleTypeExplicit);
  if (signals.headlineBodyConsistency === 'conflicting' && signals.headlineConsistencyFromModel){
    categories.freshnessIntegrity.earned -= 5;
  }

  const corroborationFound = signals.primarySourceCount > 0 || signals.independentNewsHosts > 0 || signals.factCheckCount > 0;
  if (corroborationFound){
    categories.corroboration.assessable = 15;
    if (signals.primarySourceCount > 0) categories.corroboration.earned += 6;
    if (signals.independentNewsHosts >= 2) categories.corroboration.earned += 5;
    else if (signals.independentNewsHosts === 1) categories.corroboration.earned += 3;
    if (signals.factCheckCount > 0) categories.corroboration.earned += 1;
  }

  Object.values(categories).forEach((item) => {
    item.assessable = clamp(item.assessable, 0, item.maximum);
    item.earned = clamp(item.earned, 0, item.assessable);
  });

  if (signals.primarySourceCount > 0) addSignal(notes, 'positive', `${signals.primarySourceCount} primary or official source${signals.primarySourceCount === 1 ? '' : 's'} identified`);
  if (signals.namedSourceCount > 0) addSignal(notes, 'positive', `${signals.namedSourceCount} named source${signals.namedSourceCount === 1 ? '' : 's'} identified`);
  if (checks.correctionsPolicy) addSignal(notes, 'positive', 'Publisher corrections or standards policy found');
  if (signals.hasPublishedDate && signals.hasModifiedDate) addSignal(notes, 'positive', 'Publication and update dates available');
  if (signals.anonymousSourceCount > 0) addSignal(notes, 'limitation', `${signals.anonymousSourceCount} anonymous-source reference${signals.anonymousSourceCount === 1 ? '' : 's'} found`);
  if (!corroborationFound) addSignal(notes, 'unassessed', 'Independent corroboration was not established');
  if (!signals.hasPublishedDate) addSignal(notes, 'limitation', 'Publication date was unavailable');

  const adjustments = [];
  if (signals.correctionsDisclosed){
    adjustments.push({ type: 'addition', points: 2, reason: 'A correction or clarification is visibly disclosed.', evidenceUrl: '' });
  }
  const adjustmentTotal = clamp(adjustments.reduce((sum, item) => sum + item.points, 0), -35, 5);
  const earnedPoints = Object.values(categories).reduce((sum, item) => sum + item.earned, 0);
  const assessablePoints = Object.values(categories).reduce((sum, item) => sum + item.assessable, 0);
  const coveragePercent = Math.round(clamp((assessablePoints / TOTAL_SCORING_POINTS) * 100, 0, 100));
  const rawScore = assessablePoints ? (earnedPoints / assessablePoints) * 100 : 0;
  const coveragePenalty = coveragePercent >= 85 ? 0 : coveragePercent >= 70 ? 3 : coveragePercent >= 50 ? 7 : 0;
  let score = Math.round(clamp(rawScore - coveragePenalty + adjustmentTotal, 0, 100));
  if (coveragePercent < 70) score = Math.min(score, 79);
  const sufficientInformation = coveragePercent >= 50;
  const label = sufficientInformation
    ? score >= 85 ? 'Strong trust signals'
      : score >= 70 ? 'Generally supported'
      : score >= 50 ? 'Mixed or incomplete signals'
      : score >= 30 ? 'Limited supporting evidence'
      : 'Significant concerns identified'
    : 'Limited information available';

  const strongestSignal = signals.primarySourceCount > 0
    ? 'Primary evidence identified'
    : signals.namedSourceCount > 0
      ? 'Named sourcing identified'
      : 'Few positive signals were assessable';
  const mainLimitation = !corroborationFound
    ? 'Independent corroboration not established'
    : !signals.hasPublishedDate
      ? 'Publication date unavailable'
      : signals.anonymousSourceCount > 0
        ? 'Some sourcing is anonymous'
        : 'Some signals could not be assessed';

  return normalizeTrustResult({
    score,
    label,
    coveragePercent,
    sufficientInformation,
    summary: sufficientInformation ? `${strongestSignal} · ${mainLimitation}` : 'Not enough sourcing and publisher information was available for a reliable assessment.',
    strongestSignal,
    mainLimitation,
    categories,
    signals: notes,
    adjustments,
    assessedAt: new Date().toISOString(),
    methodologyVersion: TRUST_METHOD_VERSION,
  });
}

export function normalizeTrustResult(value){
  const o = value && typeof value === 'object' ? value : {};
  const coveragePercent = Math.round(clamp(o.coveragePercent, 0, 100));
  const sufficientInformation = o.sufficientInformation !== false && coveragePercent >= 50;
  const score = Math.round(clamp(o.score, 0, 100));
  const fallbackLabel = sufficientInformation
    ? score >= 85 ? 'Strong trust signals' : score >= 70 ? 'Generally supported' : score >= 50 ? 'Mixed or incomplete signals' : score >= 30 ? 'Limited supporting evidence' : 'Significant concerns identified'
    : 'Limited information available';
  const categories = {};
  for (const [key, maximum] of Object.entries(MAXIMUMS)){
    const source = o.categories?.[key] || {};
    const assessable = clamp(source.assessable, 0, maximum);
    categories[key] = {
      earned: clamp(source.earned, 0, assessable),
      assessable,
      maximum,
    };
  }
  const signalTypes = new Set(['positive', 'limitation', 'unassessed']);
  const signals = (Array.isArray(o.signals) ? o.signals : []).slice(0, 6).map((item) => ({
    type: signalTypes.has(item?.type) ? item.type : 'unassessed',
    label: safeText(item?.label, 140),
  })).filter((item) => item.label);
  return {
    score,
    label: RESULT_LABELS.has(o.label) ? o.label : fallbackLabel,
    coveragePercent,
    sufficientInformation,
    summary: /\b(true|false|fake news|verified truth|100% accurate|unbiased|AI approved|publisher is trustworthy)\b/i.test(String(o.summary || ''))
      ? (sufficientInformation ? 'Observable article and source signals were assessed.' : 'Not enough information was available for a reliable assessment.')
      : safeText(o.summary, 220) || (sufficientInformation ? 'Observable article and source signals were assessed.' : 'Not enough information was available for a reliable assessment.'),
    strongestSignal: safeText(o.strongestSignal, 140),
    mainLimitation: safeText(o.mainLimitation, 140),
    categories,
    signals,
    adjustments: (Array.isArray(o.adjustments) ? o.adjustments : []).slice(0, 6).map((item) => ({
      type: item?.type === 'addition' ? 'addition' : 'deduction',
      points: clamp(item?.points, -35, 5),
      reason: safeText(item?.reason, 220),
      evidenceUrl: safeText(item?.evidenceUrl, 500),
    })).filter((item) => item.reason),
    assessedAt: !Number.isNaN(Date.parse(o.assessedAt)) ? new Date(o.assessedAt).toISOString() : new Date().toISOString(),
    methodologyVersion: Math.max(1, Math.round(clamp(o.methodologyVersion, 1, 99))),
  };
}

export function compactTrustResult(value){
  if (!value) return null;
  const result = normalizeTrustResult(value);
  return {
    s: result.score,
    l: result.label,
    c: result.coveragePercent,
    i: result.sufficientInformation ? 1 : 0,
    m: result.summary,
    n: result.signals.map((item) => [item.type[0], item.label]),
    v: result.methodologyVersion,
    a: result.assessedAt,
  };
}

export function expandCompactTrustResult(value){
  if (!value || typeof value !== 'object') return null;
  const typeMap = { p: 'positive', l: 'limitation', u: 'unassessed' };
  return normalizeTrustResult({
    score: value.s,
    label: value.l,
    coveragePercent: value.c,
    sufficientInformation: value.i === 1,
    summary: value.m,
    signals: (Array.isArray(value.n) ? value.n : []).map(([type, label]) => ({ type: typeMap[type] || 'unassessed', label })),
    methodologyVersion: value.v,
    assessedAt: value.a,
  });
}

import type { SearchResult } from '@/types/search';

const PRIMARY_HOST_PATTERNS = [
  /(^|\.)gov$/i,
  /(^|\.)edu$/i,
  /(^|\.)github\.com$/i,
  /(^|\.)arxiv\.org$/i,
  /(^|\.)who\.int$/i,
  /(^|\.)openai\.com$/i,
  /(^|\.)anthropic\.com$/i,
  /(^|\.)claude\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)googleapis\.com$/i,
  /(^|\.)googleblog\.com$/i,
  /(^|\.)deepmind\.google$/i,
  /(^|\.)ai\.google\.dev$/i,
  /(^|\.)openrouter\.ai$/i,
  /(^|\.)meta\.com$/i,
  /(^|\.)mistral\.ai$/i,
  /(^|\.)cohere\.com$/i,
  /(^|\.)huggingface\.co$/i,
];

const OFFICIAL_PATH_HINTS = [
  'competition',
  'competitions',
  'docs',
  'documentation',
  'developer',
  'api',
  'reference',
  'guide',
  'fixtures',
  'matches',
  'match-centre',
  'match-center',
  'results',
  'schedule',
  'scores',
  'standings',
  'blog',
  'news',
  'releases',
  'changelog',
  'readme',
];

const LOW_SIGNAL_HOST_HINTS = [
  'pinterest.',
  'quora.',
  'medium.',
  'linkedin.',
  'facebook.',
  'instagram.',
  'tiktok.',
  'lindleylabs.',
  'aitools.',
  'toolify.',
  'futurepedia.',
  'aimadetools.',
  'digitalapplied.',
  'codingfleet.',
  'mindstudio.',
  'fanrecap.',
  'rumor.',
];

const REFERENCE_HOST_HINTS = [
  'dictionary.',
  'merriam-webster.',
  'cambridge.',
  'oxfordlearnersdictionaries.',
  'thefreedictionary.',
  'dictionary.com',
  'britannica.',
  'wikipedia.',
];

const TREND_SNAPSHOT_HOST_HINTS = [
  'trends24.',
  'xtrends.',
  'whatstrends.',
  'globaltwittertrends.',
  'twitter-trends.',
  'snaplytics.',
  'social-searcher.',
  'trendsmap.',
];

export function rankSearchResults(results: SearchResult[], query: string): SearchResult[] {
  return results
    .map((result) => applySourceQuality(result, query))
    .sort((a, b) => (b.sourceScore || 0) - (a.sourceScore || 0));
}

export function applySourceQuality(result: SearchResult, query: string): SearchResult {
  const url = safeUrl(result.url);
  const host = url?.hostname.replace(/^www\./, '') || '';
  const path = url?.pathname.toLowerCase() || '';
  const queryTerms = importantTerms(query);
  const haystack = `${result.title} ${result.snippet} ${host} ${path}`.toLowerCase();
  const overlap = queryTerms.filter((term) => haystack.includes(term)).length;
  const reasons: string[] = [];
  let score = 50;
  const isPrimaryHost = PRIMARY_HOST_PATTERNS.some((pattern) => pattern.test(host));
  const isExactTopicHost = queryTerms.some((term) =>
    host === `${term}.com` ||
    host === `${term}.org` ||
    host === `${term}.net` ||
    host.startsWith(`${term}.`)
  );
  const lowerQuery = query.toLowerCase();
  const needsPrimaryEvidence = /\b(price|cost|pricing|stock|market|funding|revenue|law|legal|regulation|policy|medical|health|safety|release|released|launch|available|availability|official|docs|documentation|api|model|models)\b/.test(lowerQuery);
  const needsLiveEventEvidence = /\b(schedule|schedules|fixture|fixtures|match|matches|today|tonight|live|score|scores|result|results|winner|winners|loser|losers|standings|table|bracket|tournament|cup|league|championship)\b/.test(lowerQuery);
  const needsTrendEvidence = /\b(twitter|x\.com|reddit|instagram|youtube|tiktok|social media|trending|trends|viral|hot topics?|hashtags?)\b/.test(lowerQuery);
  const wantsDefinition = /\b(define|definition|meaning|synonym|what does|what is the meaning)\b/.test(lowerQuery);
  const looksLikeComparisonContent = /\b(vs|versus|benchmark|benchmarks|compared|wins?|showdown)\b/.test(haystack);

  if (isPrimaryHost) {
    score += 18;
    reasons.push('primary source domain');
  }

  if (OFFICIAL_PATH_HINTS.some((hint) => path.includes(hint))) {
    score += 8;
    reasons.push('official/info path');
  }

  if (host && queryTerms.some((term) => host.includes(term))) {
    score += 8;
    reasons.push('domain matches topic');
  }

  if (isExactTopicHost) {
    score += 18;
    reasons.push('exact topic domain');
  }

  if (overlap > 0) {
    score += Math.min(overlap * 5, 18);
    reasons.push('matches query terms');
  }

  if (result.extracted || result.content) {
    score += 6;
    reasons.push('readable content available');
  }

  if (needsLiveEventEvidence && /\b(schedule|fixtures?|matches|results?|scores?|standings|bracket)\b/.test(haystack)) {
    score += 14;
    reasons.push('event data terms');
  }

  if (needsLiveEventEvidence && /\b(official|federation|association|governing|organizer|tournament)\b/.test(haystack)) {
    score += 8;
    reasons.push('event authority terms');
  }

  if (needsTrendEvidence && /\b(trending|trends|hashtags?|viral|hot topics?|today|now)\b/.test(haystack)) {
    score += 14;
    reasons.push('trend snapshot terms');
  }

  if (needsTrendEvidence && TREND_SNAPSHOT_HOST_HINTS.some((hint) => host.includes(hint))) {
    score += 10;
    reasons.push('trend snapshot host');
  }

  if (needsTrendEvidence && /\b(explore|home|login|signup|for-you)\b/.test(path) && /(^|\.)x\.com$|(^|\.)twitter\.com$|(^|\.)reddit\.com$|(^|\.)instagram\.com$|(^|\.)tiktok\.com$/.test(host)) {
    score -= 18;
    reasons.push('generic social landing page');
  }

  if (LOW_SIGNAL_HOST_HINTS.some((hint) => host.includes(hint))) {
    score -= 12;
    reasons.push('lower-signal host');
  }

  if (!wantsDefinition && REFERENCE_HOST_HINTS.some((hint) => host.includes(hint))) {
    score -= 24;
    reasons.push('reference source for non-definition query');
  }

  if (needsPrimaryEvidence && !isPrimaryHost) {
    score -= 12;
    reasons.push('not a primary source');
  }

  if (needsPrimaryEvidence && looksLikeComparisonContent && !isPrimaryHost) {
    score -= 10;
    reasons.push('comparison page, not primary evidence');
  }

  if (needsLiveEventEvidence && LOW_SIGNAL_HOST_HINTS.some((hint) => host.includes(hint))) {
    score -= 10;
    reasons.push('low-signal event source');
  }

  if (!result.snippet && !result.content) {
    score -= 8;
    reasons.push('limited preview text');
  }

  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    ...result,
    sourceScore: safeScore,
    sourceLabel: labelForScore(safeScore),
    sourceReason: reasons.slice(0, 3).join(', ') || 'general web result',
  };
}

function labelForScore(score: number): string {
  if (score >= 78) return 'Strong';
  if (score >= 64) return 'Useful';
  if (score >= 48) return 'General';
  return 'Weak';
}

function importantTerms(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length >= 4)
      .filter((term) => !['what', 'when', 'where', 'with', 'from', 'about', 'latest', 'current'].includes(term))
      .slice(0, 8)
  ));
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

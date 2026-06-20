import type { SearchResult } from '@/types/search';

const PRIMARY_HOST_PATTERNS = [
  /(^|\.)gov$/i,
  /(^|\.)edu$/i,
  /(^|\.)github\.com$/i,
  /(^|\.)arxiv\.org$/i,
  /(^|\.)who\.int$/i,
  /(^|\.)wikipedia\.org$/i,
  /(^|\.)openai\.com$/i,
  /(^|\.)anthropic\.com$/i,
  /(^|\.)claude\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)googleapis\.com$/i,
  /(^|\.)googleblog\.com$/i,
  /(^|\.)ai\.google\.dev$/i,
  /(^|\.)openrouter\.ai$/i,
  /(^|\.)meta\.com$/i,
  /(^|\.)mistral\.ai$/i,
  /(^|\.)cohere\.com$/i,
];

const OFFICIAL_PATH_HINTS = [
  'docs',
  'documentation',
  'developer',
  'api',
  'reference',
  'guide',
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
  const isModelPricingQuery = /\b(gpt|openai|claude|anthropic|gemini|model|models|pricing|price|cost)\b/.test(query.toLowerCase());
  const looksLikeComparisonContent = /\b(vs|versus|benchmark|benchmarks|compared|wins?|showdown)\b/.test(haystack);

  if (isPrimaryHost) {
    score += 18;
    reasons.push('primary source domain');
  }

  if (OFFICIAL_PATH_HINTS.some((hint) => path.includes(hint))) {
    score += 8;
    reasons.push('documentation/news path');
  }

  if (host && queryTerms.some((term) => host.includes(term))) {
    score += 8;
    reasons.push('domain matches topic');
  }

  if (overlap > 0) {
    score += Math.min(overlap * 5, 18);
    reasons.push('matches query terms');
  }

  if (result.extracted || result.content) {
    score += 6;
    reasons.push('readable content available');
  }

  if (LOW_SIGNAL_HOST_HINTS.some((hint) => host.includes(hint))) {
    score -= 12;
    reasons.push('lower-signal host');
  }

  if (isModelPricingQuery && !isPrimaryHost) {
    score -= 12;
    reasons.push('not an official model source');
  }

  if (isModelPricingQuery && looksLikeComparisonContent && !isPrimaryHost) {
    score -= 10;
    reasons.push('comparison page, not primary evidence');
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

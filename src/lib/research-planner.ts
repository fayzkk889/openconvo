export type ResearchPlan = {
  originalQuery: string;
  queries: string[];
};

type ResearchIntent = {
  freshness: boolean;
  comparison: boolean;
  pricing: boolean;
  official: boolean;
  risk: boolean;
  technical: boolean;
  evidence: boolean;
  purchase: boolean;
  liveEvent: boolean;
  socialTrend: boolean;
};

type ResearchAnalysis = {
  originalQuery: string;
  intent: ResearchIntent;
  subjects: string[];
};

const MAX_PLANNED_QUERIES = 8;
const MAX_DEEP_PLANNED_QUERIES = 7;
const MAX_SUBJECTS = 5;

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'best',
  'better',
  'but',
  'by',
  'can',
  'changed',
  'changes',
  'check',
  'cheapest',
  'choice',
  'choices',
  'choose',
  'compare',
  'comparison',
  'could',
  'current',
  'currently',
  'did',
  'do',
  'does',
  'else',
  'for',
  'from',
  'get',
  'give',
  'has',
  'have',
  'help',
  'how',
  'i',
  'in',
  'is',
  'it',
  'latest',
  'me',
  'more',
  'new',
  'newest',
  'now',
  'of',
  'on',
  'one',
  'ones',
  'option',
  'options',
  'or',
  'pick',
  'please',
  'recent',
  'recommended',
  'right',
  's',
  'should',
  'show',
  'some',
  'tell',
  'than',
  'that',
  'the',
  'their',
  'them',
  'this',
  'to',
  'today',
  'under',
  'up',
  'us',
  'use',
  'versus',
  'vs',
  'want',
  'worth',
  'what',
  'whats',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'year',
  'you',
]);

const INTENT_WORDS = new Set([
  'available',
  'availability',
  'benchmark',
  'benchmarks',
  'buy',
  'buying',
  'cheap',
  'cheaper',
  'choose',
  'cost',
  'costs',
  'difference',
  'differences',
  'docs',
  'documentation',
  'features',
  'fixtures',
  'guide',
  'launched',
  'launch',
  'limitations',
  'losers',
  'match',
  'matches',
  'news',
  'official',
  'past',
  'price',
  'pricing',
  'pros',
  'recommend',
  'recommendation',
  'purchase',
  'purchasing',
  'release',
  'released',
  'review',
  'reviews',
  'risk',
  'risks',
  'safe',
  'safety',
  'source',
  'sources',
  'schedule',
  'schedules',
  'score',
  'scores',
  'specification',
  'specifications',
  'specs',
  'standings',
  'table',
  'topics',
  'trending',
  'trends',
  'tournament',
  'update',
  'updates',
  'winner',
  'winners',
]);

export function planResearchQueries(query: string, options?: { deep?: boolean }): ResearchPlan {
  const originalQuery = normalizeQuery(query);
  const analysis = analyzeResearchQuery(originalQuery);
  const candidates = [
    originalQuery,
    ...priorityIntentQueries(analysis),
    ...subjectQueries(analysis),
    ...intentQueries(analysis),
    `${originalQuery} sources`,
    `${originalQuery} analysis`,
    ...(options?.deep ? deepResearchQueries(analysis) : []),
  ];

  return {
    originalQuery,
    queries: dedupeQueries(candidates).slice(0, options?.deep ? MAX_DEEP_PLANNED_QUERIES : MAX_PLANNED_QUERIES),
  };
}

function analyzeResearchQuery(query: string): ResearchAnalysis {
  return {
    originalQuery: query,
    intent: inferResearchIntent(query),
    subjects: extractCandidateSubjects(query),
  };
}

function inferResearchIntent(query: string): ResearchIntent {
  const lower = query.toLowerCase();
  return {
    freshness: /\b(latest|current|currently|today|recent|newest|news|update|updates|release|released|launch|launched|available|availability|now|202\d)\b/.test(lower),
    comparison: /\b(compare|comparison|versus|vs\.?|alternative|alternatives|better|best|which|choose|recommend|recommendation|difference|differences)\b/.test(lower),
    pricing: /\b(price|cost|pricing|cheap|cheaper|budget|subscription|plan|free tier|market|stock|funding|revenue)\b/.test(lower),
    official: /\b(official|source|sources|cite|citation|verify|fact check|fact-check|docs|documentation)\b/.test(lower),
    risk: /\b(security|privacy|risk|risks|legal|compliance|policy|law|regulation|safety|safe)\b/.test(lower),
    technical: /\b(api|docs|documentation|framework|library|github|open source|opensource|developer|code|spec|specs|specification|specifications)\b/.test(lower),
    evidence: /\b(source|sources|cite|citation|research|verify|fact check|fact-check|evidence|proof)\b/.test(lower),
    purchase: /\b(buy|buying|purchase|purchasing|shop|shopping|recommend|recommendation|budget)\b/.test(lower),
    liveEvent: /\b(schedule|schedules|fixture|fixtures|match|matches|score|scores|result|results|winner|winners|loser|losers|standings|table|bracket|tournament|cup|league|championship)\b/.test(lower),
    socialTrend: /\b(twitter|x\.com|reddit|instagram|youtube|tiktok|social media|trending|trends|viral|hot topics?|hashtags?)\b/.test(lower),
  };
}

function subjectQueries(analysis: ResearchAnalysis): string[] {
  const queries: string[] = [];
  const constraintQuery = buildConstraintSearchQuery(analysis.originalQuery);
  if (constraintQuery) {
    queries.push(constraintQuery);
    queries.push(`${constraintQuery} best options`);
    queries.push(`${constraintQuery} latest price reviews`);
  }

  for (const subject of analysis.subjects.slice(0, MAX_SUBJECTS)) {
    queries.push(`${subject} official`);

    if (analysis.intent.freshness) {
      queries.push(`${subject} latest updates official news`);
    }

    if (analysis.intent.pricing) {
      queries.push(`${subject} official pricing cost`);
    }

    if (analysis.intent.purchase) {
      queries.push(`${subject} buying guide reviews`);
    }

    if (analysis.intent.technical) {
      queries.push(`${subject} documentation GitHub`);
    }

    if (analysis.intent.comparison) {
      queries.push(`${subject} reviews benchmarks limitations`);
    }

    if (analysis.intent.risk) {
      queries.push(`${subject} risks security privacy official`);
    }

    if (analysis.intent.liveEvent) {
      queries.push(`${subject} official schedule fixtures results`);
      queries.push(`${subject} today matches results official`);
      queries.push(`${subject} standings bracket official`);
    }

    if (analysis.intent.socialTrend) {
      queries.push(`${subject} trending topics today snapshot`);
      queries.push(`${subject} hashtags today India`);
      queries.push(`${subject} reddit trending India today`);
    }
  }

  return queries;
}

function priorityIntentQueries(analysis: ResearchAnalysis): string[] {
  return [
    ...socialTrendQueries(analysis),
    ...constraintQueries(analysis),
  ];
}

function socialTrendQueries(analysis: ResearchAnalysis): string[] {
  if (!analysis.intent.socialTrend) return [];

  const scope = extractLocationScope(analysis.originalQuery);
  const timeframe = /\b(today|now|currently|this week|this month)\b/i.exec(analysis.originalQuery)?.[0] || 'today';
  const platforms = extractSocialPlatforms(analysis.originalQuery);
  const targets = platforms.length > 0 ? platforms : ['social media'];
  const scopeSuffix = [scope, timeframe].filter(Boolean).join(' ');

  return dedupeQueries(targets.flatMap((platform) => [
    `${platform} trend tracker ${scopeSuffix}`.trim(),
    `${platform} trends ${scopeSuffix}`.trim(),
    `${platform} trending topics ${scopeSuffix}`.trim(),
    `${platform} hashtags ${scopeSuffix}`.trim(),
  ]));
}

function constraintQueries(analysis: ResearchAnalysis): string[] {
  const constraintQuery = buildConstraintSearchQuery(analysis.originalQuery);
  if (!constraintQuery) return [];
  return [
    constraintQuery,
    `${constraintQuery} best options`,
    `${constraintQuery} latest price reviews`,
  ];
}

function intentQueries(analysis: ResearchAnalysis): string[] {
  const query = analysis.originalQuery;
  const queries: string[] = [];

  if (analysis.intent.official || analysis.intent.technical) {
    queries.push(`${query} official`);
    queries.push(`${query} documentation`);
  }

  if (analysis.intent.freshness) {
    queries.push(`${query} latest updates`);
    queries.push(`${query} official news`);
  }

  if (analysis.intent.comparison) {
    queries.push(`${query} comparison`);
    queries.push(`${query} pros cons`);
  }

  if (analysis.intent.pricing) {
    queries.push(`${query} official pricing`);
    queries.push(`${query} market data`);
  }

  if (analysis.intent.risk) {
    queries.push(`${query} risks official documentation`);
  }

  if (analysis.intent.liveEvent) {
    queries.push(`${query} official schedule fixtures results`);
    queries.push(`${query} live scores today fixtures`);
  }

  if (analysis.intent.socialTrend) {
    queries.push(`${query} trend tracker snapshot`);
    queries.push(`${query} trending hashtags topics`);
  }

  if (queries.length === 0) {
    queries.push(`${query} overview`);
    queries.push(`${query} key facts`);
  }

  return queries;
}

function deepResearchQueries(analysis: ResearchAnalysis): string[] {
  const subject = analysis.subjects[0] || analysis.originalQuery;
  return [
    `${subject} official documentation`,
    `${subject} recent developments`,
    `${subject} expert analysis`,
    `${subject} limitations risks`,
    `${subject} alternatives comparison`,
  ];
}

function extractCandidateSubjects(query: string): string[] {
  const quoted = Array.from(query.matchAll(/"([^"]{2,100})"|'([^']{2,100})'/g)).map((match) => match[1] || match[2]);
  const strippedQuery = stripQuestionFrame(query);
  const namedSubjects = extractNamedSubjects(strippedQuery);
  const listedThingSubjects = extractListedThingSubjects(query);
  const productCategorySubjects = extractProductCategorySubjects(query);
  const purchaseSubjects = extractPurchaseSubjects(query);
  const comparisonParts = extractComparisonSubjects(strippedQuery);
  const prepositionSubjects = Array.from(strippedQuery.matchAll(/\b(?:of|for|about|on|regarding|between)\s+([^?.,;:]{3,120})/gi))
    .map((match) => cleanSubject(match[1] || ''))
    .filter(Boolean);
  const reducedWholeQuery = cleanSubject(strippedQuery);

  return dedupeQueries([
    ...quoted,
    ...namedSubjects,
    ...listedThingSubjects,
    ...productCategorySubjects,
    ...purchaseSubjects,
    ...comparisonParts,
    ...prepositionSubjects,
    reducedWholeQuery,
  ])
    .map(normalizeSubject)
    .filter((subject) => subject.length >= 2)
    .filter((subject) => subject.split(/\s+/).length <= 8)
    .slice(0, MAX_SUBJECTS);
}

function extractNamedSubjects(query: string): string[] {
  const normalized = normalizeSubject(query);
  const matches = Array.from(normalized.matchAll(
    /\b(?:[A-Z]{2,}(?:\s+(?:\d{2,4}|[A-Z][A-Za-z0-9-]+))*|[A-Z][A-Za-z0-9-]+(?:\s+(?:[A-Z][A-Za-z0-9-]+|\d{2,4})){1,5})\b/g
  )).map((match) => cleanSubject(match[0] || ''));

  const acronymWithYear = Array.from(normalized.matchAll(/\b([A-Z]{2,})\s*(20\d{2}|19\d{2})\b/g))
    .map((match) => cleanSubject(`${match[1]} ${match[2]}`));

  const eventWithYear = Array.from(normalized.matchAll(/\b([A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z][A-Za-z0-9-]*){0,4})\s+(20\d{2}|19\d{2})\b/g))
    .map((match) => cleanSubject(`${match[1]} ${match[2]}`))
    .filter((subject) => /\b(cup|league|championship|tournament|open|world|series|season|conference|summit|expo|election|budget)\b/i.test(subject));

  return dedupeQueries([...acronymWithYear, ...eventWithYear, ...matches])
    .filter((subject) => subject.length >= 2)
    .filter((subject) => subject.split(/\s+/).length <= 6)
    .slice(0, MAX_SUBJECTS);
}

function extractPurchaseSubjects(query: string): string[] {
  return Array.from(query.matchAll(/\b(?:buy|purchase|get|choose)\s+(?:a|an|the)?\s*([^?.,;:]{2,80}?)(?:\s+(?:with|under|below|within|for|that|which|and)\b|$)/gi))
    .map((match) => cleanSubject(match[1] || ''))
    .filter((subject) => !/^(?:in|for|under|below|within)\b/i.test(subject))
    .filter(Boolean);
}

function extractProductCategorySubjects(query: string): string[] {
  const normalized = normalizeSubject(query);
  const productWords = '(?:phones?|smartphones?|laptops?|mobiles?|bikes?|motorcycles?|cars?|tablets?|earbuds?|headphones?|monitors?|keyboards?|mice|cameras?)';
  return Array.from(normalized.matchAll(new RegExp(`\\b((?:[a-z0-9]+\\s+){0,3}${productWords})\\b`, 'gi')))
    .map((match) => cleanSubject(match[1] || ''))
    .filter(Boolean);
}

function extractListedThingSubjects(query: string): string[] {
  const normalized = normalizeSubject(query);
  return [
    ...Array.from(normalized.matchAll(/\b(?:list of|list|models? of)\s+([^?.,;:]{2,80}?)(?:\s+(?:which|that|with|under|below|within|for|in|and)\b|$)/gi))
      .map((match) => cleanSubject(match[1] || '')),
    ...Array.from(normalized.matchAll(/\b([^?.,;:]{2,60}?)\s+(?:which|that)\s+(?:are|have|come|fit)\b/gi))
      .map((match) => {
        const tokens = cleanSubject(match[1] || '').split(/\s+/);
        return tokens.slice(-3).join(' ');
      }),
  ].filter(Boolean);
}

function buildConstraintSearchQuery(query: string): string | null {
  const product = extractListedThingSubjects(query)[0] || extractProductCategorySubjects(query)[0] || extractPurchaseSubjects(query)[0] || extractCandidateSubjectsWithoutConstraints(query)[0];
  if (!product) return null;

  const constraints = [
    extractMarketScope(query),
    extractBudgetConstraint(query),
    extractAttributeConstraint(query),
  ].filter(Boolean).join(' ');

  if (!constraints) return null;
  return normalizeSubject(`${product} ${constraints}`);
}

function extractCandidateSubjectsWithoutConstraints(query: string): string[] {
  const strippedQuery = stripQuestionFrame(query);
  const comparisonParts = extractComparisonSubjects(strippedQuery);
  const reducedWholeQuery = cleanSubject(strippedQuery);
  return dedupeQueries([...comparisonParts, reducedWholeQuery])
    .map(normalizeSubject)
    .filter((subject) => subject.length >= 2)
    .filter((subject) => subject.split(/\s+/).length <= 8)
    .slice(0, MAX_SUBJECTS);
}

function extractBudgetConstraint(query: string): string {
  const normalized = normalizeSubject(query);
  const budgetMatch = normalized.match(/\b(?:budget\s+(?:of|is)?|under|below|within|less than|up to)\s+(.{1,80}?)(?:\s+(?:and|with|for|to|want|buy|purchase|available|in)\b|$)/i);
  const value = budgetMatch?.[1]?.trim() || '';
  const compactBudget = normalizeCompactBudget(value, query);
  if (compactBudget) return `under ${compactBudget}`;
  if (!/\b(?:rupees?|rs|inr|lakh|lakhs|crore|crores|dollars?|\$|usd|eur|€|gbp|£)\b/i.test(value)) return '';
  return `under ${value}`;
}

function extractMarketScope(query: string): string {
  if (/\bindia\b/i.test(query)) return 'India';
  if (/\b(?:rupees?|rs|inr|lakh|lakhs|crore|crores|₹)\b/i.test(query)) return 'India';
  if (/\b(?:usd|dollars?|\$)\b/i.test(query)) return 'US';
  if (/\b(?:gbp|£)\b/i.test(query)) return 'UK';
  if (/\b(?:eur|€)\b/i.test(query)) return 'Europe';
  return '';
}

function normalizeCompactBudget(value: string, query: string): string {
  const match = value.match(/\b(\d+(?:\.\d+)?)\s*k\b/i);
  if (!match) return '';
  const amount = Math.round(Number(match[1]) * 1000);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const currency = extractMarketScope(query) === 'India' ? 'rupees' : '';
  return [String(amount), currency].filter(Boolean).join(' ');
}

function extractAttributeConstraint(query: string): string {
  const normalized = normalizeSubject(query)
    .replace(/\batleast\b/gi, 'at least')
    .replace(/\bminimum\b/gi, 'at least');
  const operatorNormalized = query
    .replace(/>=|=>/g, ' at least ')
    .replace(/>/g, ' above ')
    .replace(/\batleast\b/gi, 'at least')
    .replace(/\bminimum\b/gi, 'at least');
  const withMatch = normalized.match(/\bwith\s+([^?.,;:]{2,120})/i);
  const atLeastMatch = operatorNormalized.match(/\bat least\s+([^?.,;:]{2,80})/i);
  const thresholdMatch = operatorNormalized.match(/(?:more than|above|over|at least)\s*([0-9][0-9.,]*\s*(?:cc|bhp|nm|kmpl|mah|hz|gb|tb|mp|inch|inches)\b)/i);
  const withText = cleanupAttributeText(withMatch?.[1] || '');
  const atLeastText = atLeastMatch ? cleanupAttributeText(`at least ${atLeastMatch[1]}`) : '';
  const thresholdText = thresholdMatch ? cleanupAttributeText(`at least ${thresholdMatch[1]}`) : '';
  return dedupeQueries([
    thresholdText,
    withText,
    !thresholdText && atLeastText && !withText.toLowerCase().includes(atLeastText.toLowerCase()) ? atLeastText : '',
  ]).join(' ');
}

function cleanupAttributeText(value: string): string {
  return value
    .replace(/\batleast\b/gi, 'at least')
    .replace(/\s+and\s+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractComparisonSubjects(query: string): string[] {
  const parts = stripQuestionFrame(query).split(/\b(?:vs\.?|versus|compared with|compared to|or)\b/i);
  if (parts.length < 2) return [];

  return parts
    .map((part, index) => {
      const cleaned = cleanSubject(part);
      if (!cleaned) return '';
      const tokens = cleaned.split(/\s+/);
      if (index === 0) return tokens.slice(-5).join(' ');
      if (index === parts.length - 1) return tokens.slice(0, 5).join(' ');
      return tokens.slice(0, 5).join(' ');
    })
    .map(trimLooseConnectors)
    .filter(Boolean);
}

function cleanSubject(value: string): string {
  const tokens = normalizeSubject(stripQuestionFrame(stripAudienceContext(value)))
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token.toLowerCase()))
    .filter((token) => !INTENT_WORDS.has(token.toLowerCase()));

  return trimLooseConnectors(tokens.join(' '));
}

function stripAudienceContext(value: string): string {
  return value.replace(
    /\bfor\s+(?:a|an|the)?\s*(?:small|medium|large|early stage|early-stage)?\s*(?:startup|startups|team|teams|company|companies|business|businesses|personal use|individuals?|students?|developers?|beginners?|creators?)\b/gi,
    ' '
  );
}

function extractSocialPlatforms(query: string): string[] {
  const lower = query.toLowerCase();
  const platforms: string[] = [];
  if (/\b(twitter|x\.com|x)\b/.test(lower)) platforms.push('Twitter X');
  if (/\breddit\b/.test(lower)) platforms.push('Reddit');
  if (/\binstagram\b/.test(lower)) platforms.push('Instagram');
  if (/\byoutube\b/.test(lower)) platforms.push('YouTube');
  if (/\btiktok\b/.test(lower)) platforms.push('TikTok');
  return dedupeQueries(platforms);
}

function extractLocationScope(query: string): string {
  const normalized = normalizeSubject(query);
  const matches = Array.from(normalized.matchAll(/\b(?:in|for|around)\s+([A-Za-z][A-Za-z\s-]{1,50}?)(?:\s+(?:today|now|currently|this week|this month|with|under|below|above|and)\b|$)/gi))
    .map((match) => cleanSubject(match[1] || ''))
    .filter(Boolean);
  return matches[matches.length - 1] || '';
}

function stripQuestionFrame(value: string): string {
  return normalizeSubject(value)
    .replace(/\b(?:can|could|would)\s+(?:you|u)\b/gi, ' ')
    .replace(/\b(?:tell|show|give)\s+(?:me|us)?\b/gi, ' ')
    .replace(/\b(?:which|what)\s+(?:one|ones|option|options|tool|model|product|thing|choice)?\s*(?:is|are|would be)?\s*(?:the)?\s*(?:best|better|cheapest|recommended|right)\b/gi, ' ')
    .replace(/\b(?:should|can|could)\s+(?:i|we|you)\s+(?:use|buy|choose|get|pick)\b/gi, ' ')
    .replace(/\b(?:i|we)\s+(?:want|need|have|am looking|are looking)\s+(?:to|for)?\b/gi, ' ')
    .replace(/\b(?:compare|recommend|suggest|choose|pick)\s+(?:between|from|for)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSubject(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/['’]/g, '')
    .replace(/[`*_#[\](){}<>]/g, ' ')
    .replace(/[?!,;:]+/g, ' ')
    .replace(/\b([a-z]+)(\d{2,5})\b/gi, '$1 $2')
    .replace(/\b(\d{2,5})([a-z]+)\b/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimLooseConnectors(value: string): string {
  return value
    .replace(/^(?:\+|and|or|of|for|about|on|with|between)\s+/i, '')
    .replace(/\s+(?:\+|and|or|of|for|about|on|with|between)$/i, '')
    .trim();
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const normalized = normalizeQuery(query);
    if (!normalized) return false;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(normalizeQuery);
}

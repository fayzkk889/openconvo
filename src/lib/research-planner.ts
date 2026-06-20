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
  'compare',
  'comparison',
  'could',
  'current',
  'currently',
  'did',
  'do',
  'does',
  'for',
  'from',
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
  'or',
  'please',
  'recent',
  'should',
  'show',
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
  'versus',
  'vs',
  'want',
  'worth',
  'what',
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
  'guide',
  'launched',
  'launch',
  'limitations',
  'news',
  'official',
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
  'specification',
  'specifications',
  'specs',
  'update',
  'updates',
]);

export function planResearchQueries(query: string, options?: { deep?: boolean }): ResearchPlan {
  const originalQuery = normalizeQuery(query);
  const analysis = analyzeResearchQuery(originalQuery);
  const candidates = [
    originalQuery,
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
  }

  return queries;
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
  const purchaseSubjects = extractPurchaseSubjects(query);
  const comparisonParts = extractComparisonSubjects(query);
  const prepositionSubjects = Array.from(query.matchAll(/\b(?:of|for|about|on|regarding|between)\s+([^?.,;:]{3,120})/gi))
    .map((match) => cleanSubject(match[1] || ''))
    .filter(Boolean);
  const reducedWholeQuery = cleanSubject(query);

  return dedupeQueries([
    ...quoted,
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

function extractPurchaseSubjects(query: string): string[] {
  return Array.from(query.matchAll(/\b(?:buy|purchase|get|choose)\s+(?:a|an|the)?\s*([^?.,;:]{2,80}?)(?:\s+(?:with|under|below|within|for|that|which|and)\b|$)/gi))
    .map((match) => cleanSubject(match[1] || ''))
    .filter(Boolean);
}

function buildConstraintSearchQuery(query: string): string | null {
  const product = extractPurchaseSubjects(query)[0] || extractCandidateSubjectsWithoutConstraints(query)[0];
  if (!product) return null;

  const constraints = [
    extractBudgetConstraint(query),
    extractAttributeConstraint(query),
  ].filter(Boolean).join(' ');

  if (!constraints) return null;
  return normalizeSubject(`${product} ${constraints}`);
}

function extractCandidateSubjectsWithoutConstraints(query: string): string[] {
  const comparisonParts = extractComparisonSubjects(query);
  const reducedWholeQuery = cleanSubject(query);
  return dedupeQueries([...comparisonParts, reducedWholeQuery])
    .map(normalizeSubject)
    .filter((subject) => subject.length >= 2)
    .filter((subject) => subject.split(/\s+/).length <= 8)
    .slice(0, MAX_SUBJECTS);
}

function extractBudgetConstraint(query: string): string {
  const normalized = normalizeSubject(query);
  const budgetMatch = normalized.match(/\b(?:budget\s+(?:of|is)?|under|below|within|less than|up to)\s+(.{1,80}?)(?:\s+(?:and|with|for|to|want|buy|purchase)\b|$)/i);
  const value = budgetMatch?.[1]?.trim() || '';
  if (!/\b(?:rupees?|rs|inr|lakh|lakhs|crore|crores|dollars?|\$|usd|eur|€|gbp|£)\b/i.test(value)) return '';
  return `under ${value}`;
}

function extractAttributeConstraint(query: string): string {
  const normalized = normalizeSubject(query)
    .replace(/\batleast\b/gi, 'at least')
    .replace(/\bminimum\b/gi, 'at least');
  const withMatch = normalized.match(/\bwith\s+([^?.,;:]{2,120})/i);
  const atLeastMatch = normalized.match(/\bat least\s+([^?.,;:]{2,80})/i);
  const withText = cleanupAttributeText(withMatch?.[1] || '');
  const atLeastText = atLeastMatch ? cleanupAttributeText(`at least ${atLeastMatch[1]}`) : '';
  return dedupeQueries([
    withText,
    atLeastText && !withText.toLowerCase().includes(atLeastText.toLowerCase()) ? atLeastText : '',
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
  const parts = query.split(/\b(?:vs\.?|versus|compared with|compared to|or)\b|\+/i);
  if (parts.length < 2) return [];

  return parts
    .map((part, index) => {
      const cleaned = cleanSubject(part);
      if (!cleaned) return '';
      const tokens = cleaned.split(/\s+/);
      if (index === 0) return tokens.slice(-3).join(' ');
      if (index === parts.length - 1) return tokens.slice(0, 3).join(' ');
      return tokens.slice(0, 3).join(' ');
    })
    .map(trimLooseConnectors)
    .filter(Boolean);
}

function cleanSubject(value: string): string {
  const tokens = normalizeSubject(stripAudienceContext(value))
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

function normalizeSubject(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[`*_#[\](){}<>]/g, ' ')
    .replace(/[?!,;:]+/g, ' ')
    .replace(/\b([a-z]+)(\d{2,5})\b/gi, '$1 $2')
    .replace(/\b(\d{2,5})([a-z]+)\b/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimLooseConnectors(value: string): string {
  return value
    .replace(/^(?:and|or|of|for|about|on|with|between)\s+/i, '')
    .replace(/\s+(?:and|or|of|for|about|on|with|between)$/i, '')
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

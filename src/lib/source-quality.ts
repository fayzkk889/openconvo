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

const GENERIC_QUERY_WORDS = new Set([
  'route',
  'routes',
  'routing',
  'handler',
  'handlers',
  'docs',
  'documentation',
  'developer',
  'guide',
  'guides',
  'code',
  'codes',
  'coding',
  'page',
  'pages',
  'site',
  'sites',
  'help',
  'work',
  'works',
  'working',
  'post',
  'posts',
  'get',
  'gets',
  'api',
  'apis',
  'sdk',
  'sdks',
  'spec',
  'specs',
  'specification',
  'file',
  'files',
  'link',
  'links',
  'read',
  'list',
  'lists',
  'build',
  'test',
  'tests',
  'app',
  'apps',
  'official',
  'explain',
  'research',
  'learn',
  'using',
  'based',
  'about',
  'best',
  'review',
  'reviews',
  'price',
  'pricing',
  'cost',
  'costs',
  'news',
  'update',
  'updates',
  'free',
  'online',
  'data',
  'item',
  'items',
]);

const COMMON_TECH_NAMES = [
  'next.js',
  'nextjs',
  'react',
  'reactjs',
  'vue.js',
  'vuejs',
  'vue',
  'angular',
  'svelte',
  'sveltekit',
  'node.js',
  'nodejs',
  'express.js',
  'express',
  'typescript',
  'javascript',
  'python',
  'rust',
  'golang',
  'docker',
  'kubernetes',
  'sqlite',
  'postgresql',
  'postgres',
  'mongodb',
  'mysql',
  'redis',
  'supabase',
  'prisma',
  'tailwind',
  'graphql',
  'openrouter',
  'anthropic',
  'openai',
  'polaris labs',
  'route handlers',
  'app router',
];

export function extractPrimarySubjects(query: string): string[] {
  const sanitized = query
    .replace(/\b(?:this\s+(?:question|prompt|request|query|task)\s+is\s+)?(?:unrelated\s+to|not\s+related\s+to|not\s+about|excluding)\s+[^.,;\n]+/gi, ' ')
    .replace(/\b(?:do\s+not|don'?t)\s+(?:include|mention|refer\s+to)\s+[^.,;\n]+/gi, ' ');

  const subjects: string[] = [];

  // 1. Tech products / brands with dots or numbers (e.g. Next.js, Vue.js, Node.js, GPT-4, Claude-3)
  const dotTech = sanitized.match(/\b([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+)\b/g);
  if (dotTech) {
    for (const dt of dotTech) {
      if (dt.length >= 3 && !/\b(?:e\.g|i\.e)\b/i.test(dt)) subjects.push(dt);
    }
  }

  // 2. Recognized common tech frameworks and products even in lowercase or without dots
  const lowerSanitized = sanitized.toLowerCase();
  for (const tech of COMMON_TECH_NAMES) {
    const pattern = new RegExp(`\\b${tech.replace('.', '\\.')}\\b`, 'i');
    if (pattern.test(lowerSanitized)) {
      subjects.push(tech);
    }
  }

  // 3. Multi-word capitalized proper nouns (e.g., Route Handlers, Polaris Labs, SQLite)
  const capMatches = sanitized.match(/\b[A-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)?(?:\s+[A-Z][a-zA-Z0-9]*)*\b/g);
  if (capMatches) {
    for (const m of capMatches) {
      const trimmed = m.trim();
      if (trimmed.length >= 3 && !/^(?:Research|Explain|What|How|Why|When|Where|Who|This|That|The|And|For|With|Show|Does|Can|Could|Should)$/i.test(trimmed)) {
        subjects.push(trimmed);
      }
    }
  }

  return Array.from(new Set(subjects.map((s) => s.toLowerCase())));
}

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
  const isMultiTermQuery = queryTerms.length >= 2;
  const isPoorOverlap = isMultiTermQuery ? overlap < 2 : overlap === 0;

  const reasons: string[] = [];
  let score = isPoorOverlap ? 30 : 50;

  if (isPoorOverlap) {
    reasons.push(overlap === 0 ? 'no query term match' : 'isolated single-term match');
  }

  const primarySubjects = extractPrimarySubjects(query);
  const matchesPrimarySubject = primarySubjects.length === 0 || primarySubjects.some((subj) => {
    const cleanSubj = subj.toLowerCase();
    const compactSubj = cleanSubj.replace(/[^a-z0-9]/g, '');
    return haystack.includes(cleanSubj) || (compactSubj.length >= 3 && haystack.includes(compactSubj));
  });

  const isAcademicOrGovQuery = /\b(research|study|paper|clinical|trial|health|medicine|medical|law|legal|statute|regulation|government|policy|academic|journal|university|bereavement|psychology|science|census|tax)\b/i.test(query);
  const isEduOrGovHost = /(^|\.)(gov|edu)$/i.test(host);

  if (!matchesPrimarySubject) {
    score -= 30;
    reasons.push('missing primary subject');
  }

  // An .edu or .gov host is only a primary host if the query is academic/governmental or haystack matches subject
  const isPrimaryHost = !isPoorOverlap &&
    matchesPrimarySubject &&
    PRIMARY_HOST_PATTERNS.some((pattern) => {
      if (pattern.test('.gov') || pattern.test('.edu')) {
        return pattern.test(host) && (isAcademicOrGovQuery || matchesPrimarySubject);
      }
      return pattern.test(host);
    });

  if (isEduOrGovHost && !isAcademicOrGovQuery && !matchesPrimarySubject) {
    score -= 20;
    reasons.push('unrelated edu/gov domain');
  }

  const isExactTopicHost = !isPoorOverlap &&
    matchesPrimarySubject &&
    (
      primarySubjects.some((subj) => {
        const compact = subj.replace(/[^a-z0-9]/g, '');
        return compact.length >= 4 && (
          host === `${compact}.com` ||
          host === `${compact}.org` ||
          host === `${compact}.net` ||
          host === `${compact}.io` ||
          host === `${compact}.dev` ||
          host.startsWith(`${compact}.`)
        );
      }) ||
      queryTerms.some((term) =>
        !GENERIC_QUERY_WORDS.has(term) &&
        term.length >= 4 &&
        (host === `${term}.com` ||
         host === `${term}.org` ||
         host === `${term}.net` ||
         host === `${term}.io` ||
         host === `${term}.dev` ||
         host.startsWith(`${term}.`))
      )
    );
  const lowerQuery = query.toLowerCase();
  const needsPrimaryEvidence = /\b(price|cost|pricing|stock|market|funding|revenue|law|legal|regulation|policy|medical|health|safety|release|released|launch|available|availability|official|docs|documentation|api|model|models)\b/.test(lowerQuery);
  const needsLiveEventEvidence = /\b(schedule|schedules|fixture|fixtures|match|matches|today|tonight|live|score|scores|result|results|winner|winners|loser|losers|standings|table|bracket|tournament|cup|league|championship)\b/.test(lowerQuery);
  const needsTrendEvidence = /\b(twitter|x\.com|reddit|instagram|youtube|tiktok|social media|trending|trends|viral|hot topics?|hashtags?)\b/.test(lowerQuery);
  const wantsDefinition = /\b(define|definition|meaning|synonym|what does|what is the meaning)\b/.test(lowerQuery);
  const looksLikeComparisonContent = /\b(vs|versus|benchmark|benchmarks|compared|wins?|showdown)\b/.test(haystack);
  const needsFreshness = /\b(latest|recent|new|newest|today|currently|now|2024|2025|2026|update|updated)\b/i.test(query);

  if (needsFreshness && result.publishedAt) {
    const pubDate = new Date(result.publishedAt);
    if (!Number.isNaN(pubDate.getTime())) {
      const now = Date.now();
      const ageMs = now - pubDate.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (ageDays >= 0 && ageDays <= 30) {
        score += 20;
        reasons.push('published in last 30 days');
      } else if (ageDays > 30 && ageDays <= 180) {
        score += 15;
        reasons.push('published in last 6 months');
      } else if (ageDays > 180 && ageDays <= 365) {
        score += 10;
        reasons.push('published in past year');
      } else if (ageDays > 730) {
        score -= 10;
        reasons.push('dated publication older than 2 years for fresh query');
      } else {
        score += 5;
        reasons.push('dated publication');
      }

      // Check if query mentions a specific year and publication year matches
      const yearMatch = query.match(/\b(202[0-9])\b/);
      if (yearMatch && pubDate.getFullYear() === Number(yearMatch[1])) {
        score += 10;
        reasons.push(`matches requested year ${yearMatch[1]}`);
      }
    } else {
      score += 5;
      reasons.push('unparseable date string');
    }
  }

  if (isPrimaryHost) {
    score += 18;
    reasons.push('primary source domain');
  }

  if (OFFICIAL_PATH_HINTS.some((hint) => path.includes(hint))) {
    score += 8;
    reasons.push('official/info path');
  }

  if (host && queryTerms.some((term) => !GENERIC_QUERY_WORDS.has(term) && term.length >= 4 && host.includes(term))) {
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

  if (needsPrimaryEvidence && !isPrimaryHost && !isExactTopicHost) {
    score -= 12;
    reasons.push('not a primary source');
  }

  if (needsPrimaryEvidence && looksLikeComparisonContent && !isPrimaryHost && !isExactTopicHost) {
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

  let safeScore = Math.max(0, Math.min(100, Math.round(score)));
  if (isPoorOverlap) {
    safeScore = Math.min(safeScore, 45);
  }
  if (!matchesPrimarySubject) {
    safeScore = Math.min(safeScore, 35);
  }
  if (isEduOrGovHost && !isAcademicOrGovQuery && !matchesPrimarySubject) {
    safeScore = Math.min(safeScore, 25);
  }
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

export interface ConflictingEvidenceReport {
  hasConflict: boolean;
  conflictingTopics: string[];
  summary?: string;
}

export function detectConflictingEvidence(results: SearchResult[]): ConflictingEvidenceReport {
  if (!results || results.length < 2) {
    return { hasConflict: false, conflictingTopics: [] };
  }

  const conflictingTopics: string[] = [];
  const texts = results.map((r) => `${r.title} ${r.snippet || ''} ${r.content || ''}`.toLowerCase());

  // Check 1: Release / status divergence (e.g. released/launched vs delayed/cancelled)
  const hasReleased = texts.some((t) => /\b(is released|has launched|now available|out now)\b/.test(t));
  const hasDelayed = texts.some((t) => /\b(delayed|postponed|not yet released|cancelled|pushed back)\b/.test(t));
  if (hasReleased && hasDelayed) {
    conflictingTopics.push('availability / release timing');
  }

  // Check 2: Pricing divergence (e.g. free vs paid / price discrepancy)
  const hasFree = texts.some((t) => /\b(100% free|completely free|free tier available|no cost)\b/.test(t));
  const hasPaidOnly = texts.some((t) => /\b(requires paid subscription|no free version|paid only|\$\d+\/month)\b/.test(t));
  if (hasFree && hasPaidOnly) {
    conflictingTopics.push('pricing model');
  }

  // Check 3: Factual outcome / winner divergence
  const hasWon = texts.some((t) => /\b(won|victorious|champion|defeated)\b/.test(t));
  const hasLost = texts.some((t) => /\b(lost to|eliminated by|runner-up)\b/.test(t));
  if (hasWon && hasLost && texts.length >= 2) {
    conflictingTopics.push('event / match outcome');
  }

  return {
    hasConflict: conflictingTopics.length > 0,
    conflictingTopics,
    summary: conflictingTopics.length > 0
      ? `Sources contain conflicting evidence regarding: ${conflictingTopics.join(', ')}`
      : undefined,
  };
}

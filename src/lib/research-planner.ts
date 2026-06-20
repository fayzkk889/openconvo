export type ResearchPlan = {
  originalQuery: string;
  queries: string[];
};

const MAX_PLANNED_QUERIES = 8;
const MAX_DEEP_PLANNED_QUERIES = 7;

export function planResearchQueries(query: string, options?: { deep?: boolean }): ResearchPlan {
  const originalQuery = normalizeQuery(query);
  const candidates = [
    originalQuery,
    ...intentQueries(originalQuery),
    `${originalQuery} sources`,
    `${originalQuery} analysis`,
    ...(options?.deep ? deepResearchQueries(originalQuery) : []),
  ];

  return {
    originalQuery,
    queries: dedupeQueries(candidates).slice(0, options?.deep ? MAX_DEEP_PLANNED_QUERIES : MAX_PLANNED_QUERIES),
  };
}

function intentQueries(query: string): string[] {
  const lower = query.toLowerCase();
  const queries: string[] = [];
  const entities = extractResearchEntities(query);

  if (entities.length > 0) {
    queries.push(...entityEvidenceQueries(entities, lower));
  }

  if (/\b(official|docs|documentation|api|github|open source|opensource|developer|framework|library|software|tool|app|platform|service|company|product|model|models)\b/.test(lower)) {
    queries.push(`${query} official`);
    queries.push(`${query} documentation`);
  }

  if (/\b(latest|current|today|recent|newest|2025|2026|news|release|launched?)\b/.test(lower)) {
    queries.push(`${query} latest updates`);
    queries.push(`${query} official news`);
  }

  if (/\b(compare|versus|vs\.?|alternative|best|which|choose|recommend)\b/.test(lower)) {
    queries.push(`${query} comparison`);
    queries.push(`${query} pros cons`);
    queries.push(`${query} official documentation pricing`);
  }

  if (/\b(price|cost|pricing|stock|market|funding|revenue)\b/.test(lower)) {
    queries.push(`${query} pricing market data`);
    queries.push(`${query} official pricing`);
  }

  if (/\b(security|privacy|risk|legal|compliance|policy)\b/.test(lower)) {
    queries.push(`${query} risks official documentation`);
  }

  if (/\b(api|docs|framework|library|github|open source|opensource|developer)\b/.test(lower)) {
    queries.push(`${query} documentation GitHub`);
  }

  return queries.length > 0
    ? queries
    : [`${query} overview`, `${query} key facts`];
}

function entityEvidenceQueries(entities: string[], lowerQuery: string): string[] {
  const wantsPricing = /\b(price|cost|pricing|cheap|cheaper|pocket friendly|subscription|plan|free tier)\b/.test(lowerQuery);
  const wantsRelease = /\b(latest|current|today|recent|newest|release|released|launch|launched|available|availability)\b/.test(lowerQuery);
  const wantsDocs = /\b(api|docs|documentation|github|open source|opensource|developer|framework|library|code)\b/.test(lowerQuery);
  const wantsComparison = /\b(compare|versus|vs\.?|alternative|best|which|choose|recommend|better)\b/.test(lowerQuery);
  const queries: string[] = [];

  for (const entity of entities.slice(0, 5)) {
    queries.push(`${entity} official`);
    if (wantsDocs) queries.push(`${entity} official documentation GitHub`);
    if (wantsPricing) queries.push(`${entity} official pricing`);
    if (wantsRelease) queries.push(`${entity} official latest release news`);
    if (wantsComparison) queries.push(`${entity} reviews benchmarks limitations`);
  }

  return queries;
}

function deepResearchQueries(query: string): string[] {
  return [
    `${query} official documentation`,
    `${query} case studies`,
    `${query} expert analysis`,
    `${query} limitations risks`,
    `${query} alternatives comparison`,
  ];
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function extractResearchEntities(query: string): string[] {
  const knownEntities = query.match(/\b(?:OpenAI|ChatGPT|GPT\s*-?\s*\d(?:\.\d)?|Codex|Claude(?:\s+Code)?|Opus\s+\d(?:\.\d)?|Sonnet\s+\d(?:\.\d)?|Haiku\s+\d(?:\.\d)?|Anthropic|Gemini(?:\s+\d(?:\.\d)?)?|Llama(?:\s+\d(?:\.\d)?)?|Mistral|Cohere|Perplexity|Manus|Cursor|Windsurf|Copilot|Vercel|Supabase|Firebase|Tavily|SearxNG|DuckDuckGo)\b/gi) || [];
  const titleCaseEntities = query.match(/\b[A-Z][A-Za-z0-9.+-]*(?:\s+[A-Z0-9][A-Za-z0-9.+-]*){0,3}\b/g) || [];
  const quotedEntities = Array.from(query.matchAll(/"([^"]{2,80})"|'([^']{2,80})'/g)).map((match) => match[1] || match[2]);
  const subjectPhrases = extractSubjectPhrases(query);

  return dedupeQueries([...knownEntities, ...titleCaseEntities, ...quotedEntities, ...subjectPhrases])
    .map(normalizeEntityPhrase)
    .filter((entity) => !/^(I|You|What|Which|Tell|Can|Should|The|This|That|And|Or|Vs)$/i.test(entity))
    .slice(0, 8);
}

function extractSubjectPhrases(query: string): string[] {
  const phrases: string[] = [];
  const patterns = [
    /\b(?:features|specs|specifications|price|pricing|cost|review|reviews|news|updates|release|launch)\s+(?:of|for|on|about)\s+([^?.,;]{3,80})/gi,
    /\b(?:latest|new|newest|current)\s+([^?.,;]{3,80})/gi,
    /\b(?:what|which|tell me|show me).{0,40}\b(?:of|for|about)\s+([^?.,;]{3,80})/gi,
  ];

  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      if (match[1]) phrases.push(match[1]);
    }
  }

  return phrases.map((phrase) =>
    phrase
      .replace(/\b(latest|current|new|newest|features|specs|specifications|price|pricing|cost|review|reviews|news|updates)\b/gi, ' ')
      .replace(/\b(please|thanks|today|now)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  ).filter((phrase) => phrase.length >= 3);
}

function normalizeEntityPhrase(entity: string): string {
  return entity
    .replace(/^(?:of|for|about|on)\s+/i, '')
    .replace(/\bgt\s*650\b/gi, 'GT 650')
    .replace(/\b([a-z]+)(\d{2,4})\b/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
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

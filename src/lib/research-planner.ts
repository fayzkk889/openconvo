export type ResearchPlan = {
  originalQuery: string;
  queries: string[];
};

const MAX_PLANNED_QUERIES = 4;
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

  if (/\b(gpt|openai|claude|anthropic|gemini|google|llama|meta|mistral|cohere|model|models|pricing|price|cost)\b/.test(lower)) {
    queries.push(...modelOfficialQueries(lower));
  }

  if (/\b(latest|current|today|recent|newest|2025|2026|news|release|launched?)\b/.test(lower)) {
    queries.push(`${query} latest updates`);
  }

  if (/\b(compare|versus|vs\.?|alternative|best|which|choose|recommend)\b/.test(lower)) {
    queries.push(`${query} comparison`);
    queries.push(`${query} pros cons`);
  }

  if (/\b(price|cost|pricing|stock|market|funding|revenue)\b/.test(lower)) {
    queries.push(`${query} pricing market data`);
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

function modelOfficialQueries(lowerQuery: string): string[] {
  const queries: string[] = [];

  if (/\b(gpt|openai)\b/.test(lowerQuery)) {
    queries.push('OpenAI models pricing official');
    queries.push('OpenAI model documentation official');
  }

  if (/\b(claude|anthropic)\b/.test(lowerQuery)) {
    queries.push('Anthropic Claude models pricing official');
    queries.push('Anthropic Claude documentation official');
  }

  if (/\b(gemini|google)\b/.test(lowerQuery)) {
    queries.push('Google Gemini models pricing official');
  }

  if (/\b(llama|meta)\b/.test(lowerQuery)) {
    queries.push('Meta Llama models official');
  }

  return queries.length > 0
    ? queries
    : ['AI model pricing official documentation'];
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

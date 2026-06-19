export type ResearchPlan = {
  originalQuery: string;
  queries: string[];
};

const MAX_PLANNED_QUERIES = 4;

export function planResearchQueries(query: string): ResearchPlan {
  const originalQuery = normalizeQuery(query);
  const candidates = [
    originalQuery,
    ...intentQueries(originalQuery),
    `${originalQuery} sources`,
    `${originalQuery} analysis`,
  ];

  return {
    originalQuery,
    queries: dedupeQueries(candidates).slice(0, MAX_PLANNED_QUERIES),
  };
}

function intentQueries(query: string): string[] {
  const lower = query.toLowerCase();
  const queries: string[] = [];

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

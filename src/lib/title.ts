const MAX_TITLE_CHARS = 64;

const TITLE_STOP_WORDS = new Set([
  'a',
  'about',
  'again',
  'also',
  'an',
  'and',
  'are',
  'as',
  'at',
  'best',
  'better',
  'buy',
  'buying',
  'can',
  'choose',
  'compare',
  'comparison',
  'could',
  'current',
  'currently',
  'do',
  'does',
  'for',
  'from',
  'get',
  'give',
  'have',
  'help',
  'how',
  'i',
  'in',
  'is',
  'it',
  'latest',
  'me',
  'need',
  'new',
  'newest',
  'now',
  'of',
  'on',
  'one',
  'option',
  'options',
  'or',
  'please',
  'purchase',
  'recommend',
  'recommendation',
  'should',
  'show',
  'tell',
  'than',
  'that',
  'the',
  'this',
  'to',
  'today',
  'u',
  'use',
  'versus',
  'vs',
  'want',
  'what',
  'which',
  'with',
  'you',
]);

const FEATURE_WORDS = /\b(feature|features|spec|specs|specification|specifications|release|releases|update|updates|price|pricing|cost|review|reviews)\b/i;

export function buildConversationTitle(content: string): string {
  const normalized = normalizeTitleInput(content);
  if (!normalized) return 'New conversation';

  const comparisonTitle = buildComparisonTitle(normalized);
  if (comparisonTitle) return comparisonTitle;

  const purchaseTitle = buildPurchaseTitle(normalized);
  if (purchaseTitle) return purchaseTitle;

  const featureTitle = buildFeatureTitle(normalized);
  if (featureTitle) return featureTitle;

  const subject = cleanTitleSubject(stripQuestionFrame(normalized));
  return fitTitle(titleCase(subject) || 'New conversation');
}

function buildComparisonTitle(value: string): string {
  const stripped = stripQuestionFrame(value);
  const parts = stripped
    .split(/\b(?:vs\.?|versus|compared with|compared to|or)\b/i)
    .map(cleanTitleSubject)
    .filter(Boolean);

  if (parts.length < 2) return '';

  return fitTitle(`${titleCase(parts[0])} vs ${titleCase(parts[1])}`);
}

function buildPurchaseTitle(value: string): string {
  if (!/\b(buy|purchase|get|choose|recommend|budget|under|within|below|at least)\b/i.test(value)) return '';

  const product = extractProductSubject(value);
  if (!product) return '';

  const budget = extractBudget(value);
  if (budget) return fitTitle(`${titleCase(product)} Under ${titleCase(budget)}`);

  return fitTitle(`${titleCase(product)} Buying Guide`);
}

function buildFeatureTitle(value: string): string {
  if (!FEATURE_WORDS.test(value)) return '';
  const stripped = stripQuestionFrame(value);
  const subject = cleanTitleSubject(stripped.replace(FEATURE_WORDS, ' '));
  if (!subject) return '';

  const featureMatch = value.match(FEATURE_WORDS)?.[1]?.toLowerCase();
  const suffix = featureMatch && /^price|pricing|cost$/.test(featureMatch)
    ? 'Pricing'
    : featureMatch && /^release|releases|update|updates$/.test(featureMatch)
      ? 'Updates'
      : 'Features';

  return fitTitle(`${titleCase(subject)} ${suffix}`);
}

function extractProductSubject(value: string): string {
  const match = value.match(/\b(?:buy|purchase|get|choose|recommend)\s+(?:a|an|the)?\s*([^?.,;:]{2,90}?)(?:\s+(?:with|under|below|within|for|that|which|and|at least)\b|$)/i);
  if (match?.[1]) return cleanTitleSubject(match[1]);

  const stripped = stripQuestionFrame(value)
    .replace(/\b(?:budget|under|below|within|less than|up to|at least)\b.*$/i, ' ')
    .replace(/\b(?:with|having)\b.*$/i, ' ');
  return cleanTitleSubject(stripped);
}

function extractBudget(value: string): string {
  const normalized = value
    .replace(/\batleast\b/gi, 'at least')
    .replace(/\s+/g, ' ');
  const match = normalized.match(/\b(?:budget\s+(?:of|is)?|under|below|within|less than|up to)\s+(.{1,50}?)(?:\s+(?:and|with|for|to|want|buy|purchase|having|at least)\b|$)/i);
  const budget = match?.[1]?.trim() || '';
  if (!/\b(?:rupees?|rs|inr|lakh|lakhs|crore|crores|dollars?|\$|usd|eur|gbp)\b/i.test(budget)) return '';
  return budget;
}

function cleanTitleSubject(value: string): string {
  const tokens = normalizeTitleInput(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !TITLE_STOP_WORDS.has(token.toLowerCase()));

  return trimLooseConnectors(tokens.slice(0, 6).join(' '));
}

function stripQuestionFrame(value: string): string {
  return normalizeTitleInput(value)
    .replace(/\b(?:can|could|would)\s+(?:you|u)\b/gi, ' ')
    .replace(/\b(?:tell|show|give)\s+(?:me|us)?\b/gi, ' ')
    .replace(/\b(?:which|what)\s+(?:one|ones|option|options|tool|model|product|thing)?\s*(?:is|are|would be)?\s*(?:the)?\s*(?:best|better|cheapest|recommended|right)\b/gi, ' ')
    .replace(/\b(?:should|can|could)\s+(?:i|we|you)\s+(?:use|buy|choose|get|pick)\b/gi, ' ')
    .replace(/\b(?:i|we)\s+(?:want|need|have|am looking|are looking)\s+(?:to|for)?\b/gi, ' ')
    .replace(/\b(?:compare|recommend|suggest|choose|pick)\s+(?:between|from|for)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitleInput(value: string): string {
  return value
    .replace(/\[[^\]]*\]/g, ' ')
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

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d+$/.test(word)) return word;
      if (/^(gpu|ram|cpu|api|ui|ux|ai|ml|pdf|url|inr|usd|gbp|eur|gpt|gt)$/i.test(word)) return word.toUpperCase();
      if (/\d/.test(word) && /^[A-Za-z0-9.+-]+$/.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function fitTitle(value: string): string {
  const title = value.replace(/\s+/g, ' ').trim();
  if (title.length <= MAX_TITLE_CHARS) return title;
  return `${title.slice(0, MAX_TITLE_CHARS - 1).trim()}...`;
}

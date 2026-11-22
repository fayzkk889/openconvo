import type { Attachment, TaskType } from '@/types/chat';

export const TASK_PRESETS: Array<{
  id: TaskType;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'auto',
    label: 'Auto',
    shortLabel: 'Auto',
    description: 'Let OpenConvo infer the best workflow.',
  },
  {
    id: 'quick',
    label: 'Quick answer',
    shortLabel: 'Quick',
    description: 'Direct, concise help.',
  },
  {
    id: 'research',
    label: 'Research with sources',
    shortLabel: 'Research',
    description: 'Use web context and cite sources.',
  },
  {
    id: 'deep-research',
    label: 'Deep research',
    shortLabel: 'Deep',
    description: 'Plan more searches, inspect more sources, and synthesize a fuller brief.',
  },
  {
    id: 'file',
    label: 'Analyze file',
    shortLabel: 'File',
    description: 'Focus on uploaded documents or notes.',
  },
  {
    id: 'code',
    label: 'Help me code',
    shortLabel: 'Code',
    description: 'Debug, explain, or implement code.',
  },
  {
    id: 'writing',
    label: 'Improve writing',
    shortLabel: 'Writing',
    description: 'Draft, rewrite, structure, and polish.',
  },
];

export function normalizeTaskType(value: unknown): TaskType {
  return isTaskType(value) ? value : 'auto';
}

export function isTaskType(value: unknown): value is TaskType {
  return (
    value === 'auto' ||
    value === 'quick' ||
    value === 'research' ||
    value === 'deep-research' ||
    value === 'file' ||
    value === 'code' ||
    value === 'writing'
  );
}

export function taskInstruction(taskType?: TaskType): string {
  switch (taskType) {
    case 'quick':
      return 'The user selected Quick answer. Be direct, concise, and useful. Avoid long framing unless it is necessary.';
    case 'research':
      return 'The user selected Research with sources. Synthesize evidence, separate facts from uncertainty, and cite sources when web search results are available.';
    case 'deep-research':
      return 'The user selected Deep research. Produce a structured research brief: summarize the answer, compare evidence across sources, name uncertainties and gaps, cite sources for factual claims, and end with practical takeaways or next steps.';
    case 'file':
      return 'The user selected Analyze file. Prioritize the current attachments and be explicit about which file evidence supports the answer.';
    case 'code':
      return 'The user selected Help me code. Prefer concrete implementation steps, explain tradeoffs briefly, and include code when it helps.';
    case 'writing':
      return 'The user selected Improve writing. Preserve the user intent, improve clarity and structure, and offer polished wording.';
    case 'auto':
    default:
      return '';
  }
}

export function hasExplicitNegativeSearchConstraint(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    /\b(?:do\s+not|don'?t|never|no|stop|without|skip)\s+(?:use\s+)?(?:web\s+)?(?:search|research|browsing|browse|internet|googling)\b/i.test(lower) ||
    /\b(?:do\s+not|don'?t)\s+(?:search|browse|look\s+up\s+online)\b/i.test(lower) ||
    /\b(?:no\s+web\s+search|no\s+search|without\s+search(?:ing)?|without\s+browsing)\b/i.test(lower) ||
    /\b(?:asking\s+for\s+a\s+plan,\s+not\s+(?:actual\s+)?(?:external\s+)?research)\b/i.test(lower) ||
    /\b(?:using\s+(?:only\s+)?(?:the\s+)?(?:information|context|details|text)\s+(?:in|provided\s+in)\s+my\s+message)\b/i.test(lower) ||
    /\b(?:based\s+(?:only\s+)?on\s+(?:the\s+)?(?:information|context|details|text)\s+(?:in|provided\s+in)\s+my\s+message)\b/i.test(lower) ||
    /\b(?:rely\s+(?:only\s+)?on\s+(?:the\s+)?(?:information|context|details|text)\s+(?:in|provided\s+in)\s+my\s+message)\b/i.test(lower) ||
    /\b(?:purely\s+fictional|entirely\s+fictional|this\s+is\s+fictional|my\s+fictional)\b/i.test(lower)
  );
}

export function inferTaskType({
  content,
  attachments,
  searchEnabled,
  researchEnabled,
}: {
  content: string;
  attachments?: Attachment[];
  searchEnabled?: boolean;
  researchEnabled?: boolean;
}): TaskType {
  const rawText = stripLeadingGreeting(content);
  const text = rawText.toLowerCase();

  // Attachments are always local file tasks unless explicit research is active
  if (attachments?.length) return 'file';
  if (isCasualGreeting(content.trim()) || isCasualGreeting(text)) return 'quick';

  // Explicit negative constraint or pure local/fictional context: never infer research
  if (hasExplicitNegativeSearchConstraint(rawText) || isObviouslyLocalOrPersonal(rawText)) {
    if (/\b(code|function|variable|snippet|bug|debug|typescript|javascript|python|react|component|method|class|scope)\b/.test(text)) {
      return 'code';
    }
    if (/\b(write|draft|plan|improve|polish|rewrite|edit)\b/.test(text)) {
      return 'writing';
    }
    return 'quick';
  }

  // Explicit deep research keywords
  if (/\b(deep research|deep dive|comprehensive research|full research|thorough research|market map|research report|literature review|competitive analysis)\b/.test(text)) {
    return 'deep-research';
  }

  // Explicit toggles
  if (researchEnabled) return 'research';
  if (searchEnabled) return 'research';

  // Check local/personal patterns first to avoid false search triggers
  if (isObviouslyLocalOrPersonal(text)) {
    if (/\b(code|function|variable|snippet|bug|debug|typescript|javascript|python|react|component|method|class|scope)\b/.test(text)) {
      return 'code';
    }
    if (/\b(write|draft|plan|improve|polish|rewrite|edit)\b/.test(text)) {
      return 'writing';
    }
    return 'quick';
  }

  // Next check genuine web research needs
  if (needsWebResearch(rawText)) {
    return 'research';
  }

  // Ordinary arithmetic or math expressions must not be classified as code
  const isArithmetic = /^(?:calculate|compute|solve|what\s+is|\d+)\s*[\d\s+\-*/^().%=]+(?:\s*[?.])?$/i.test(text.trim());
  if (isArithmetic) {
    return 'quick';
  }

  if (/\b(code|bug|debug|typescript|javascript|react|next\.?js|api|function|component|error|stack trace|compile|build|database|sql|python)\b/.test(text)) {
    return 'code';
  }

  if (/\b(write|rewrite|draft|edit|improve|polish|tone|copy|email|resume|bio|post|caption|grammar)\b/.test(text)) {
    return 'writing';
  }

  if (text.length < 180 && /\b(what|who|when|where|why|how|define|explain|summarize)\b/.test(text)) {
    return 'quick';
  }

  return 'quick';
}

export interface WorkflowDecision {
  taskType: TaskType;
  searchMode: 'none' | 'search' | 'research' | 'deep-research';
  shouldSearch: boolean;
  isQuickTask: boolean;
  autoRouted: boolean;
}

export function resolveWorkflow({
  content,
  attachments,
  taskType = 'auto',
  searchEnabled = false,
  researchEnabled = false,
}: {
  content: string;
  attachments?: Attachment[];
  taskType?: TaskType;
  searchEnabled?: boolean;
  researchEnabled?: boolean;
}): WorkflowDecision {
  const isGreeting = isCasualGreeting(content.trim());
  const hasNegativeSearch = hasExplicitNegativeSearchConstraint(content);

  // Explicit negative constraint: if the prompt explicitly forbids web search, honor user intent over auto or toggle
  if (hasNegativeSearch) {
    const finalTaskType = (taskType === 'research' || taskType === 'deep-research')
      ? 'quick'
      : (taskType && taskType !== 'auto'
          ? taskType
          : inferTaskType({ content, attachments, searchEnabled: false, researchEnabled: false }));
    return {
      taskType: finalTaskType,
      searchMode: 'none',
      shouldSearch: false,
      isQuickTask: finalTaskType === 'quick',
      autoRouted: !taskType || taskType === 'auto',
    };
  }

  const effectiveTaskType = (!taskType || taskType === 'auto')
    ? inferTaskType({ content, attachments, searchEnabled, researchEnabled })
    : taskType;

  // 1. Casual greetings: ordinary greetings must not trigger unnecessary network requests.
  if (isGreeting && (!taskType || taskType === 'auto' || taskType === 'quick')) {
    return {
      taskType: 'quick',
      searchMode: 'none',
      shouldSearch: false,
      isQuickTask: true,
      autoRouted: !taskType || taskType === 'auto',
    };
  }

  // 2. Explicit Quick mode performs no external research
  if (effectiveTaskType === 'quick') {
    return {
      taskType: 'quick',
      searchMode: 'none',
      shouldSearch: false,
      isQuickTask: true,
      autoRouted: !taskType || taskType === 'auto',
    };
  }

  // 3. Deep research mode performs deeper research
  if (effectiveTaskType === 'deep-research') {
    return {
      taskType: 'deep-research',
      searchMode: 'deep-research',
      shouldSearch: true,
      isQuickTask: false,
      autoRouted: !taskType || taskType === 'auto',
    };
  }

  // 4. Research mode performs research
  if (effectiveTaskType === 'research') {
    const mode = (researchEnabled || !searchEnabled) ? 'research' : 'search';
    return {
      taskType: 'research',
      searchMode: mode,
      shouldSearch: true,
      isQuickTask: false,
      autoRouted: !taskType || taskType === 'auto',
    };
  }

  // 5. File, writing, code: retain task-specific behavior, perform search only if explicit search/research is requested
  const explicitSearch = Boolean(researchEnabled || searchEnabled);
  return {
    taskType: effectiveTaskType,
    searchMode: explicitSearch ? (researchEnabled ? 'research' : 'search') : 'none',
    shouldSearch: explicitSearch,
    isQuickTask: false,
    autoRouted: !taskType || taskType === 'auto',
  };
}

export function needsWebResearch(text: string): boolean {
  const lower = text.toLowerCase();

  if (hasExplicitNegativeSearchConstraint(lower) || isObviouslyLocalOrPersonal(lower)) {
    return false;
  }

  // Explicit verification or citation requests
  if (/\b(source|sources|cite|citation|research|verify|fact check|fact-check|is this true|confirm)\b/.test(lower)) {
    return true;
  }

  // Time-sensitive external events (avoiding bare 'now' / 'plan')
  if (/\b(latest|currently|today|yesterday|tomorrow|this week|this month|this year|recent|newest|breaking news|live score|live updates|as of 202[4-9]|trending|trends|viral|hot topics?|hashtags?|twitter|x\.com|reddit|instagram|youtube|tiktok|social media)\b/.test(lower)) {
    return true;
  }
  if (/\b(?:happening\s+now|right\s+now\s+in|news\s+now|news\s+today|news\s+this\s+week)\b/.test(lower)) {
    return true;
  }

  // Real-world dynamic data: weather, sports, finances, regulations
  if (/\b(weather in|score of|fixture|match schedule|standings|stock price|crypto price|exchange rate|inflation rate|interest rate|election|regulation|visa policy|travel advisory)\b/.test(lower)) {
    return true;
  }

  // Pricing & commercial availability
  if (/\b(pricing|subscription plan|data plan|mobile plan|free tier|pro tier|on road price|ex-showroom price|budget|under|below|within)\b/.test(lower) && /\b(?:rs|inr|rupees?|₹|lakh|lakhs|crore|crores|usd|dollars?|\$|gbp|eur|price|pricing|cost|tier|buy|available|for)\b/.test(lower)) {
    return true;
  }
  if (/\b(?:what is the pricing|what is the price|how much does|how much is)\b/.test(lower)) {
    return true;
  }

  // Release & launch status
  if (/\b(?:is|has|are)\s+[A-Za-z0-9.+-]+\s+(?:released|launched|out|available)(?:\s+yet)?\b/i.test(lower) || /\b(?:release date|launch date|when will\s+[A-Za-z0-9.+-]+\s+be released)\b/i.test(lower)) {
    return true;
  }

  // External documentation & API parameters
  if (/\b(?:docs?|documentation|api\s+reference|api\s+endpoint|api\s+parameters?|parameters\s+for|sdk\s+for)\b/.test(lower) && /\b(?:openrouter|openai|anthropic|stripe|aws|azure|gcp|github|supabase|firebase|cohere|mistral)\b/.test(lower)) {
    return true;
  }

  if (/\b(?:rs|inr|rupees?|₹|lakh|lakhs|crore|crores|usd|dollars?|\$|gbp|eur)\b/.test(lower) && /\b(?:price|cost|budget|under|below|worth)\b/.test(lower)) {
    return true;
  }

  if (/\b(?:cc|bhp|nm|kmpl|mah|hz|gb|tb|mp|inch|inches)\b/.test(lower) && /\b(list|models?|bikes?|cars?|phones?|laptops?|best|buy|recommend|budget|under|below|within)\b/.test(lower)) {
    return true;
  }

  // External decision comparison between real-world products/technologies
  if (/\b(compare|comparison|versus|vs\.?|alternative|alternatives|which is better|which to choose|should i buy|give me the list|list of)\b/.test(lower) && looksLikeExternalDecision(text)) {
    return true;
  }

  return false;
}

export function isObviouslyLocalOrPersonal(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    /\b(my file|attached|attachment|this document|my code|this code|these code snippets|code snippet|this snippet|above text|my note|my notes|rewrite this|rewrite that|summarize this|summarize that|this function|this variable|this class|this component|this method|my project|a plan for my project|our project|this error|this stack trace|this issue)\b/i.test(lower) ||
    /^(?:now\s+)?(?:explain|describe|clarify|summarize|refactor|debug|fix|optimize|review|rewrite|reformat|shorten|simplify)\s+(?:this|these|that|the following|above)\b/i.test(lower) ||
    /^(?:write|create|draft|generate|make)\s+(?:a\s+)?(?:research\s+)?(?:plan|outline|schedule|draft|template|example|function|test|script)(?:\s+and\s+(?:plan|outline|schedule))?\s+for\s+(?:my|our|this|a)\b/i.test(lower) ||
    /\b(?:current\s+value\s+of\s+this|value\s+of\s+(?:this\s+)?variable|in\s+this\s+scope)\b/i.test(lower) ||
    /\b(?:compare\s+these\s+two\s+(?:code\s+)?snippets?)\b/i.test(lower) ||
    /\b(?:in\s+my\s+message|provided\s+in\s+my\s+message|from\s+my\s+message|fictional\s+(?:scenario|project|context|entity|product|service|company|application)|my\s+fictional)\b/i.test(lower) ||
    /^(?:can\s+you\s+)?(?:rewrite|summarize|shorten|simplify|reformat|explain)\s+(?:this|that|it)(?:\s+(?:more\s+concisely|more\s+simply|as\s+a\s+table|better))?/i.test(lower)
  );
}

export function isCasualGreeting(text: string): boolean {
  return /^(hi+|hii+|hey+|hello+|yo+|sup)(?:\s+(?:there|again|friend|bro|buddy))?[\s!.?]*$|^(thanks?|thank you|ok|okay|hmm|lol)[\s!.?]*$/i.test(text.trim());
}

export function stripLeadingGreeting(text: string): string {
  return text
    .trim()
    .replace(/^(?:hi+|hii+|hey+|hello+|yo+|sup)(?:\s+(?:there|again|friend|bro|buddy))?\s*[,!.:-]*\s+/i, '')
    .trim();
}

function looksLikeExternalDecision(text: string): boolean {
  const lower = text.toLowerCase();

  // If comparing local snippets or local code components, it's not external
  if (/\b(snippets?|functions?|variables?|methods?|classes?|code|options? above)\b/.test(lower)) {
    return false;
  }

  if (/\b(product|tool|app|software|service|platform|library|framework|api|model|phone|laptop|camera|car|course|company|vendor|provider|hosting|database|cloud)\b/.test(lower)) {
    return true;
  }

  if (/\b(?:rs|inr|lakh|lakhs|crore|crores|usd|dollars?|\$|gbp|eur)\b/.test(lower)) {
    return true;
  }

  if (/\b(?:gpu|cpu|ram|ssd|battery|display|camera|engine|mileage|benchmark|latency|context|tokens?|pricing|price|cost)\b/.test(lower)) {
    return true;
  }

  if (/\b(postgresql|postgres|mongodb|mysql|sqlite|redis|kafka|supabase|firebase|react|vue|angular|svelte|nextjs|remix|docker|kubernetes|aws|azure|gcp)\b/i.test(lower)) {
    return true;
  }

  if (/\b[A-Z][A-Za-z0-9.+-]{2,}\s+(?:and|or|vs|versus)\s+[A-Z][A-Za-z0-9.+-]{2,}\b/.test(text)) {
    return true;
  }

  return /\b[a-z]+[.-]?[0-9][a-z0-9.-]*\b/i.test(text);
}

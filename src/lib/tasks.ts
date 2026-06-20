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
  const text = content.toLowerCase();

  if (attachments?.length) return 'file';
  if (/\b(deep research|deep dive|comprehensive research|full research|thorough research|market map|research report|literature review|competitive analysis)\b/.test(text)) {
    return 'deep-research';
  }
  if (researchEnabled || searchEnabled) return 'research';
  if (/\b(source|sources|cite|citation|research|latest|current|today|yesterday|tomorrow|this week|this month|recent|newest|news|market|price|stock|weather|score|release|released|launch|launched|available|compare|verify|fact check|fact-check)\b/.test(text)) {
    return 'research';
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

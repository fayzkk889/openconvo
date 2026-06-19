import type { TaskType } from '@/types/chat';

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

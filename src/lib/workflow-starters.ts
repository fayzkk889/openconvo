import type { TaskType } from '@/types/chat';

export type WorkflowStarter = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  taskType: TaskType;
  searchEnabled?: boolean;
  researchEnabled?: boolean;
  compareEnabled?: boolean;
};

export type WorkflowStarterDraft = {
  id: string;
  conversationId: string;
  starter: WorkflowStarter;
};

export const WORKFLOW_STARTERS: WorkflowStarter[] = [
  {
    id: 'research-brief',
    title: 'Research brief',
    description: 'Find the current state of a topic, cite sources, and summarize tradeoffs.',
    prompt: 'Create a research brief on this topic. Cover the current state, key facts, tradeoffs, risks, and cite sources where possible:\n\n',
    taskType: 'research',
    searchEnabled: true,
    researchEnabled: true,
  },
  {
    id: 'deep-research',
    title: 'Deep research',
    description: 'Plan multiple searches, inspect more sources, and produce a fuller brief.',
    prompt: 'Do deep research on this topic. Plan multiple searches, compare source evidence, call out uncertainty, cite sources, and finish with practical takeaways:\n\n',
    taskType: 'deep-research',
    searchEnabled: true,
    researchEnabled: true,
  },
  {
    id: 'file-analysis',
    title: 'Analyze a file',
    description: 'Upload a document and get a structured summary, risks, and next actions.',
    prompt: 'I will attach a file. Analyze it and give me a concise summary, important details, risks or contradictions, and practical next actions. If no file is attached, ask me to upload it first.',
    taskType: 'file',
  },
  {
    id: 'code-review',
    title: 'Code review',
    description: 'Paste code or an error and get bugs, fixes, and test ideas.',
    prompt: 'Review this code or error from first principles. Prioritize bugs, edge cases, security risks, and missing tests. Then suggest the smallest safe fix:\n\n',
    taskType: 'code',
  },
  {
    id: 'compare-models',
    title: 'Compare answers',
    description: 'Run two free models and mark the better response to improve routing.',
    prompt: 'Answer this carefully. I am using compare mode, so focus on accuracy, clarity, and useful reasoning:\n\n',
    taskType: 'auto',
    compareEnabled: true,
  },
  {
    id: 'rewrite',
    title: 'Improve writing',
    description: 'Rewrite text for clarity, tone, structure, or a specific audience.',
    prompt: 'Improve this writing. Keep the original intent, make it clearer and more polished, and explain the main changes briefly:\n\n',
    taskType: 'writing',
  },
  {
    id: 'quick-plan',
    title: 'Make a plan',
    description: 'Turn a rough goal into concrete steps and decisions.',
    prompt: 'Turn this goal into a practical step-by-step plan. Include assumptions, risks, and the first action I should take:\n\n',
    taskType: 'quick',
  },
];

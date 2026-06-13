import { DEFAULT_MODEL_ID } from '@/lib/models';

export interface Settings {
  theme: 'dark' | 'light';
  defaultModel: string;
  systemPrompt: string;
  memory: string;
  memoryEnabled: boolean;
  promptSnippets: PromptSnippet[];
  searchEnabled: boolean;
  onboardingDismissed: boolean;
  openrouterApiKey: string;
  tavilyApiKey: string;
}

export type ExportedSettings = Pick<
  Settings,
  'theme' | 'defaultModel' | 'systemPrompt' | 'memory' | 'memoryEnabled' | 'promptSnippets' | 'searchEnabled'
>;

export interface PromptSnippet {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultModel: DEFAULT_MODEL_ID,
  systemPrompt: '',
  memory: '',
  memoryEnabled: true,
  promptSnippets: [],
  searchEnabled: false,
  onboardingDismissed: false,
  openrouterApiKey: '',
  tavilyApiKey: '',
};

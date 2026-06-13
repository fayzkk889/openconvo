import { AIModel } from '@/types/models';

export const CURATED_FREE_MODELS: AIModel[] = [
  {
    id: 'meta-llama/llama-4-maverick:free',
    name: 'Llama 4 Maverick',
    provider: 'Meta',
    contextLength: 131072,
    description: 'Powerful open-source model with strong reasoning',
    isFree: true,
  },
  {
    id: 'deepseek/deepseek-chat-v3-0324:free',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    contextLength: 131072,
    description: 'Strong all-around model, excels at code',
    isFree: true,
  },
  {
    id: 'microsoft/mai-ds-r1:free',
    name: 'MAI DS R1',
    provider: 'Microsoft',
    contextLength: 131072,
    description: 'Microsoft reasoning model',
    isFree: true,
  },
  {
    id: 'qwen/qwen3-235b-a22b:free',
    name: 'Qwen 3 235B',
    provider: 'Qwen',
    contextLength: 40960,
    description: 'Large parameter model with broad capabilities',
    isFree: true,
  },
  {
    id: 'google/gemma-3-27b-it:free',
    name: 'Gemma 3 27B',
    provider: 'Google',
    contextLength: 96000,
    description: 'Compact and efficient for quick tasks',
    isFree: true,
  },
  {
    id: 'mistralai/devstral-small:free',
    name: 'Devstral Small',
    provider: 'Mistral',
    contextLength: 131072,
    description: 'Coding-focused model from Mistral',
    isFree: true,
  },
  {
    id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1:free',
    name: 'Nemotron Ultra 253B',
    provider: 'NVIDIA',
    contextLength: 131072,
    description: 'NVIDIA\'s large reasoning model',
    isFree: true,
  },
];

export const DEFAULT_MODEL_ID = 'mistralai/devstral-small:free';

export const FALLBACK_CHAIN = [
  DEFAULT_MODEL_ID,
  'google/gemma-3-27b-it:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'qwen/qwen3-235b-a22b:free',
  'meta-llama/llama-4-maverick:free',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
];

export function isSelectableFreeModel(model?: AIModel): model is AIModel {
  return Boolean(model?.isFree && model.id.endsWith(':free'));
}

export function isFreeModelId(modelId?: string | null): modelId is string {
  return Boolean(modelId?.trim().endsWith(':free'));
}

export function resolveSafeModelId(requested: string | undefined | null, available = CURATED_FREE_MODELS): string {
  const requestedModel = requested ? available.find((model) => model.id === requested) : undefined;
  if (isSelectableFreeModel(requestedModel)) return requestedModel.id;

  const defaultModel = available.find((model) => model.id === DEFAULT_MODEL_ID);
  if (isSelectableFreeModel(defaultModel)) return defaultModel.id;

  return available.find(isSelectableFreeModel)?.id || DEFAULT_MODEL_ID;
}

export function getModelById(id: string): AIModel | undefined {
  return CURATED_FREE_MODELS.find((m) => m.id === id);
}

export function getModelName(id: string): string {
  return getModelById(id)?.name ?? id.split('/').pop()?.replace(':free', '') ?? id;
}

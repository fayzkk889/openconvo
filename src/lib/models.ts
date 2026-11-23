import { AIModel } from '@/types/models';

// Offline fallback catalog, used only when the live OpenRouter catalog cannot be
// loaded. Every id was listed as a zero-priced `:free` model in OpenRouter's
// public /api/v1/models catalog on 2026-11-23. Free variants are retired
// regularly; the chat route therefore also filters candidates against the live
// catalog (see getLiveFreeModelIds) instead of trusting this list.
export const CURATED_FREE_MODELS: AIModel[] = [
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B',
    provider: 'Google',
    contextLength: 262144,
    description: 'Dense general-purpose model, good default for chat',
    isFree: true,
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Gemma 4 26B A4B',
    provider: 'Google',
    contextLength: 262144,
    description: 'Fast mixture-of-experts model for quick tasks',
    isFree: true,
  },
  {
    id: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'Nemotron 3.5 Super VL',
    provider: 'NVIDIA',
    contextLength: 1000000,
    description: 'Large-context multimodal model',
    isFree: true,
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'Nemotron 3 Ultra',
    provider: 'NVIDIA',
    contextLength: 1000000,
    description: 'Large reasoning model; slower but thorough',
    isFree: true,
  },
];

export const DEFAULT_MODEL_ID = 'google/gemma-4-31b-it:free';

export const FALLBACK_CHAIN = [
  DEFAULT_MODEL_ID,
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
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

/**
 * Order the model candidates for one chat request. When the live catalog is
 * known, ids it no longer lists are dropped (each retired id would otherwise
 * burn one of the bounded attempts on a 404) and live models are appended so a
 * stale configuration still has somewhere to fall back to.
 */
export function selectCandidateModels(candidates: string[], liveFreeIds: string[] | null): string[] {
  const unique = Array.from(new Set(candidates.filter(isFreeModelId)));
  if (!liveFreeIds?.length) return unique;
  const live = new Set(liveFreeIds.filter(isFreeModelId));
  const listed = unique.filter((id) => live.has(id));
  return Array.from(new Set([...listed, ...live]));
}

export function getModelById(id: string): AIModel | undefined {
  return CURATED_FREE_MODELS.find((m) => m.id === id);
}

export function getModelName(id: string): string {
  return getModelById(id)?.name ?? id.split('/').pop()?.replace(':free', '') ?? id;
}

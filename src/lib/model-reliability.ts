import type { TaskType } from '@/types/chat';
import type { AIModel, ModelReliability } from '@/types/models';
import { normalizeTaskType } from '@/lib/tasks';

export type ModelReliabilitySignal = {
  score: number;
  label: string;
  detail: string;
  recommended: boolean;
  samples: number;
};

export function getReliabilitySignal(
  model: AIModel,
  reliability: ModelReliability[],
  taskType?: TaskType,
  allModels: AIModel[] = []
): ModelReliabilitySignal {
  const normalizedTask = normalizeTaskType(taskType);
  const stat = reliability.find((item) => item.modelId === model.id && item.taskType === normalizedTask);
  const score = scoreReliability(stat, model);
  const samples = (stat?.successes || 0) + (stat?.failures || 0) + (stat?.rateLimits || 0);
  const recommended = isRecommendedModel(model, reliability, normalizedTask, allModels);

  if (!stat || samples === 0) {
    return {
      score,
      label: recommended ? 'Recommended' : 'Untested',
      detail: recommended ? 'Good default for this task' : 'No local runs yet',
      recommended,
      samples,
    };
  }

  const successRate = Math.round((stat.successes / Math.max(samples, 1)) * 100);
  const avgLatency = stat.successes > 0
    ? `, ~${formatDuration(stat.totalLatencyMs / stat.successes)} avg`
    : '';

  return {
    score,
    label: recommended ? 'Recommended' : successRate >= 70 ? 'Reliable' : 'Mixed',
    detail: `${successRate}% ok over ${samples} run${samples === 1 ? '' : 's'}${avgLatency}`,
    recommended,
    samples,
  };
}

function isRecommendedModel(
  model: AIModel,
  reliability: ModelReliability[],
  taskType: TaskType,
  allModels: AIModel[]
): boolean {
  if (!allModels.length || isCoolingDown(model)) return false;
  const candidates = allModels.filter((item) => item.isFree && !isCoolingDown(item));
  if (!candidates.length) return false;
  const ranked = candidates
    .map((item) => ({
      id: item.id,
      score: scoreReliability(
        reliability.find((stat) => stat.modelId === item.id && stat.taskType === taskType),
        item
      ),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.id === model.id;
}

function scoreReliability(stat: ModelReliability | undefined, model: AIModel): number {
  let score = model.contextLength >= 100000 ? 56 : 52;
  if (!stat) return score;

  const samples = stat.successes + stat.failures + stat.rateLimits;
  const successRate = samples > 0 ? stat.successes / samples : 0.5;
  const rateLimitPenalty = stat.rateLimits * 7;
  const failurePenalty = stat.failures * 5;
  const recencyBonus = Date.now() - stat.lastUsedAt < 7 * 24 * 60 * 60 * 1000 ? 4 : 0;
  const latencyPenalty = stat.successes > 0
    ? Math.min((stat.totalLatencyMs / stat.successes) / 4000, 8)
    : 0;

  score += successRate * 34;
  score += Math.min(stat.successes * 3, 12);
  score += recencyBonus;
  score -= rateLimitPenalty + failurePenalty + latencyPenalty;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function isCoolingDown(model: AIModel): boolean {
  return Boolean(model.cooldownUntil && model.cooldownUntil > Date.now());
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(Math.round(ms), 1)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
}

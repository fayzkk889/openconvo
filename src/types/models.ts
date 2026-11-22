export interface AIModel {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  description?: string;
  isFree: boolean;
  cooldownUntil?: number;
}

export type ReliabilityOutcome = 'success' | 'failure' | 'rate_limited' | 'interrupted' | 'empty';

export interface ModelReliability {
  id: string;
  modelId: string;
  taskType: string;
  successes: number;
  failures: number;
  rateLimits: number;
  emptyCount?: number;
  interruptedCount?: number;
  preferenceWins?: number;
  totalLatencyMs: number;
  lastOutcome: ReliabilityOutcome;
  lastUsedAt: number;
  updatedAt: number;
}

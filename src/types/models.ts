export interface AIModel {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  description?: string;
  isFree: boolean;
  cooldownUntil?: number;
}

export interface ModelReliability {
  id: string;
  modelId: string;
  taskType: string;
  successes: number;
  failures: number;
  rateLimits: number;
  preferenceWins?: number;
  totalLatencyMs: number;
  lastOutcome: 'success' | 'failure' | 'rate_limited';
  lastUsedAt: number;
  updatedAt: number;
}

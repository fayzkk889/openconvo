export interface AIModel {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  description?: string;
  isFree: boolean;
  cooldownUntil?: number;
}

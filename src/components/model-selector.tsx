'use client';

import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownLabel,
} from '@/components/ui/dropdown';
import { Button } from '@/components/ui/button';
import type { AIModel } from '@/types/models';

interface ModelSelectorProps {
  models: AIModel[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
  compact?: boolean;
}

export function ModelSelector({
  models,
  selectedModel,
  onSelect,
  compact = false,
}: ModelSelectorProps) {
  const currentModel = models.find((model) => model.id === selectedModel);
  const activeModels = models.filter((model) => !isCoolingDown(model));
  const cooledModels = models.filter(isCoolingDown);
  const groupedActive = groupModels(activeModels);
  const groupedCooling = groupModels(cooledModels);
  const displayName = currentModel?.name || 'Select model';

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-[180px] gap-1.5 text-xs sm:max-w-[220px]">
          <span className="truncate">{compact ? displayName.split('/').pop() : displayName}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </DropdownTrigger>

      <DropdownContent align="start" className="max-h-[390px] w-[340px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[var(--color-border)]">
        {Array.from(groupedActive.entries()).map(([provider, providerModels], idx) => (
          <React.Fragment key={provider}>
            {idx > 0 && <DropdownSeparator />}
            <DropdownLabel>{provider}</DropdownLabel>
            {providerModels.map((model) => (
              <DropdownItem
                key={model.id}
                onClick={() => onSelect(model.id)}
                className="justify-between"
              >
                <ModelOption
                  model={model}
                  selected={model.id === selectedModel}
                />
              </DropdownItem>
            ))}
          </React.Fragment>
        ))}

        {cooledModels.length > 0 && (
          <>
            {activeModels.length > 0 && <DropdownSeparator />}
            <DropdownLabel>Cooling down</DropdownLabel>
            {Array.from(groupedCooling.entries()).map(([provider, providerModels]) => (
              <React.Fragment key={`cooldown-${provider}`}>
                <DropdownLabel>{provider}</DropdownLabel>
                {providerModels.map((model) => (
                  <DropdownItem
                    key={model.id}
                    onClick={() => undefined}
                    className="cursor-not-allowed justify-between opacity-50"
                  >
                    <ModelOption model={model} coolingDown />
                  </DropdownItem>
                ))}
              </React.Fragment>
            ))}
          </>
        )}

        {models.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-[var(--color-text-tertiary)]">
            No models available
          </div>
        )}
      </DropdownContent>
    </Dropdown>
  );
}

function ModelOption({
  model,
  selected = false,
  coolingDown = false,
}: {
  model: AIModel;
  selected?: boolean;
  coolingDown?: boolean;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm">
          <span className="truncate">{model.name}</span>
          {coolingDown ? (
            <span className="shrink-0 rounded-full bg-[var(--color-warning)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
              Rate limited
            </span>
          ) : model.isFree ? (
            <span className="shrink-0 rounded-full bg-[var(--color-accent-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">
              Verified free
            </span>
          ) : null}
        </span>
        {model.description && (
          <span className="truncate text-xs text-[var(--color-text-tertiary)]">
            {model.description}
          </span>
        )}
        <span className="truncate text-[10px] text-[var(--color-text-tertiary)]">
          {model.id} - {coolingDown ? `retry ${formatCooldown(model.cooldownUntil)}` : `${formatContextLength(model.contextLength)} context`}
        </span>
      </div>
      {selected && (
        <Check className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
      )}
    </>
  );
}

function groupModels(models: AIModel[]): Map<string, AIModel[]> {
  const map = new Map<string, AIModel[]>();
  for (const model of models) {
    const existing = map.get(model.provider) || [];
    existing.push(model);
    map.set(model.provider, existing);
  }
  return map;
}

function isCoolingDown(model: AIModel): boolean {
  return Boolean(model.cooldownUntil && model.cooldownUntil > Date.now());
}

function formatCooldown(cooldownUntil?: number): string {
  if (!cooldownUntil) return 'soon';
  const seconds = Math.max(Math.ceil((cooldownUntil - Date.now()) / 1000), 1);
  return seconds <= 1 ? 'in 1s' : `in ${seconds}s`;
}

function formatContextLength(contextLength: number): string {
  if (contextLength >= 1000000) return `${(contextLength / 1000000).toFixed(1)}M`;
  if (contextLength >= 1000) return `${Math.round(contextLength / 1000)}k`;
  return String(contextLength);
}

'use client';

import React from 'react';
import { Route } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';

interface AgentToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

export function AgentToggle({ enabled, onToggle }: AgentToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          icon
          onClick={onToggle}
          className={cn(
            'relative',
            enabled && 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
          )}
          aria-label={enabled ? 'Disable agent mode' : 'Enable agent mode'}
          aria-pressed={enabled}
        >
          <Route className="h-4 w-4" />
          {enabled && (
            <span
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
              style={{ background: 'var(--color-accent)' }}
            />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {enabled ? 'Agent mode enabled' : 'Agent mode'}
      </TooltipContent>
    </Tooltip>
  );
}

'use client';

import React from 'react';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';

interface SearchToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

export function SearchToggle({ enabled, onToggle }: SearchToggleProps) {
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
            enabled && 'text-[var(--color-accent)] bg-[var(--color-accent-muted)]'
          )}
          aria-label={enabled ? 'Disable web search' : 'Enable web search'}
          aria-pressed={enabled}
        >
          <Globe className="h-4 w-4" />
          {enabled && (
            <span
              className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
              style={{ background: 'var(--color-accent)' }}
            />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {enabled ? 'Web search enabled' : 'Search the web'}
      </TooltipContent>
    </Tooltip>
  );
}

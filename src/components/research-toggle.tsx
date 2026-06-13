'use client';

import React from 'react';
import { Microscope } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';

interface ResearchToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

export function ResearchToggle({ enabled, onToggle }: ResearchToggleProps) {
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
            enabled && 'text-[var(--color-warning)] bg-[var(--color-warning)]/10'
          )}
          aria-label={enabled ? 'Disable research mode' : 'Enable research mode'}
          aria-pressed={enabled}
        >
          <Microscope className="h-4 w-4" />
          {enabled && (
            <span
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
              style={{ background: 'var(--color-warning)' }}
            />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {enabled ? 'Research mode enabled' : 'Research mode'}
      </TooltipContent>
    </Tooltip>
  );
}

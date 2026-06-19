'use client';

import React, { useCallback, useState } from 'react';
import { Copy, RefreshCw, Trash2, Check, Trophy } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';

interface MessageActionsProps {
  content: string;
  role: 'user' | 'assistant' | 'system';
  onRegenerate?: () => void;
  onDelete?: () => void;
  onPrefer?: () => void;
  preferred?: boolean;
}

export function MessageActions({
  content,
  role,
  onRegenerate,
  onDelete,
  onPrefer,
  preferred = false,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [content]);

  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={handleCopy}
            className="h-7 w-7"
            aria-label={copied ? 'Copied' : 'Copy message'}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{copied ? 'Copied!' : 'Copy'}</TooltipContent>
      </Tooltip>

      {role === 'assistant' && onRegenerate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              icon
              onClick={onRegenerate}
              className="h-7 w-7"
              aria-label="Regenerate response"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Regenerate</TooltipContent>
        </Tooltip>
      )}

      {role === 'assistant' && onPrefer && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              icon
              onClick={onPrefer}
              className={`h-7 w-7 ${preferred ? 'text-[var(--color-success)]' : ''}`}
              aria-label={preferred ? 'Preferred response' : 'Mark as better response'}
            >
              <Trophy className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{preferred ? 'Preferred' : 'Mark better'}</TooltipContent>
        </Tooltip>
      )}

      {onDelete && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              icon
              onClick={onDelete}
              className="h-7 w-7 hover:text-[var(--color-danger)]"
              aria-label="Delete message"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Delete</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import {
  Paperclip,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Microscope,
  Route,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/lib/markdown';
import { MessageActions } from '@/components/message-actions';
import { getModelName } from '@/lib/models';
import { safeExternalUrl } from '@/lib/utils';
import type { Message as MessageType } from '@/types/chat';

interface MessageProps {
  message: MessageType;
  isLastAssistant?: boolean;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onDelete?: () => void;
}

export function Message({
  message,
  isLastAssistant = false,
  isStreaming = false,
  onRegenerate,
  onDelete,
}: MessageProps) {
  const [sourcesOpen, setSourcesOpen] = useState(message.researchMode === true);
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const hasSearchResults =
    message.searchResults && message.searchResults.length > 0;
  const sourceDomains = hasSearchResults
    ? Array.from(
        new Set(
          message.searchResults!.map((source) => getSourceDomain(source.url)).filter(Boolean)
        )
      )
    : [];
  const showStreamingCursor =
    isStreaming && isAssistant && !message.content && !message.isError;

  if (message.role === 'system') return null;

  return (
    <div
      className={cn(
        'group animate-fade-in w-full py-3 md:py-4'
      )}
    >
      <div className={cn(
        'mx-auto flex w-full max-w-3xl gap-3 md:gap-4',
        isUser && 'justify-end'
      )}>
        {isAssistant && (
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]">
            <Sparkles className="h-4 w-4" />
          </div>
        )}

        <div className={cn(
          'flex min-w-0 flex-col',
          isUser ? 'max-w-[82%] items-end' : 'flex-1'
        )}>
          {/* Header */}
          <div className={cn(
            'mb-1.5 flex flex-wrap items-center gap-2',
            isUser && 'justify-end'
          )}>
            <span className="font-semibold text-sm text-[var(--color-text-primary)]">
              {isUser ? 'You' : getModelName(message.model || 'AI')}
            </span>
            {isAssistant && message.model && (
              <span className="text-[10px] font-medium text-[var(--color-text-tertiary)]">
                {message.model.split('/').pop()?.replace(':free', '')}
              </span>
            )}
            {isAssistant && message.researchMode && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                <Microscope className="h-3 w-3" />
                Research
              </span>
            )}
            {isAssistant && message.agentMode && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent-muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">
                <Route className="h-3 w-3" />
                Agent
              </span>
            )}
          </div>

          <div className={cn(
            'w-full text-sm leading-relaxed',
            isUser && 'rounded-2xl bg-[var(--color-bg-tertiary)] px-4 py-3 text-[var(--color-text-primary)] shadow-sm'
          )}>
            {/* Error state */}
            {message.isError && (
              <div className="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-[var(--color-text-secondary)]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <p>{message.content || 'An error occurred. Please try again.'}</p>
                  {onRegenerate && (
                    <button
                      onClick={onRegenerate}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-text-primary)] hover:underline transition-all"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Retry
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Streaming cursor */}
            {showStreamingCursor && (
              message.agentMode ? (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">
                  <div className="mb-2 flex items-center gap-2 font-semibold text-[var(--color-text-primary)]">
                    <Route className="h-3.5 w-3.5" />
                    Working through the task
                  </div>
                  <div className="grid gap-1.5">
                    <span>Planning the approach</span>
                    <span>Checking available context</span>
                    <span>Preparing the response</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 py-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-text-tertiary)]" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-text-tertiary)] [animation-delay:120ms]" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-text-tertiary)] [animation-delay:240ms]" />
                </div>
              )
            )}

            {/* Content */}
            {!message.isError && message.content && (
              isUser ? (
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              ) : (
                <div className="prose-invert max-w-none w-full">
                  <MarkdownRenderer content={message.content} />
                </div>
              )
            )}

            {/* User attachments */}
            {isUser && message.attachments && message.attachments.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {message.attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)]"
                  >
                    <Paperclip className="h-3 w-3" />
                    <span className="max-w-[150px] truncate">{att.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Search results / Sources */}
          {hasSearchResults && (
            <div className="mt-4 w-full">
              {message.researchMode && (
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
                  <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1">
                    {message.searchResults!.length} sources reviewed
                  </span>
                  {sourceDomains.slice(0, 3).map((domain) => (
                    <span
                      key={domain}
                      className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1"
                    >
                      {domain}
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={() => setSourcesOpen(!sourcesOpen)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 -ml-2 text-xs font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                {sourcesOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>Sources ({message.searchResults!.length})</span>
              </button>

              {sourcesOpen && (
                <div className="mt-2 flex flex-col gap-2">
                  {message.searchResults!.map((source, idx) => {
                    const safeUrl = safeExternalUrl(source.url);
                    const SourceWrapper = safeUrl ? 'a' : 'div';
                    return (
                      <SourceWrapper
                        key={idx}
                        {...(safeUrl ? { href: safeUrl, target: '_blank', rel: 'noopener noreferrer' } : {})}
                        className="group/source flex flex-col gap-1 rounded-md border border-[var(--color-border)] p-3 transition-colors hover:border-[var(--color-border-light)] hover:bg-[var(--color-bg-secondary)]"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">
                            {source.title}
                          </span>
                          {safeUrl && (
                            <ExternalLink className="h-3 w-3 shrink-0 text-[var(--color-text-tertiary)] opacity-0 group-hover/source:opacity-100 transition-opacity" />
                          )}
                        </div>
                        <span className="text-[10px] text-[var(--color-text-tertiary)] truncate">
                          {getSourceDomain(source.url) || source.url}
                        </span>
                        {source.snippet && (
                          <p className="mt-1.5 text-xs text-[var(--color-text-secondary)] line-clamp-2 leading-relaxed">
                            {source.snippet}
                          </p>
                        )}
                      </SourceWrapper>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          {!isStreaming && message.content && (
            <div className={cn(
              'mt-2 transition-opacity md:opacity-0 md:group-hover:opacity-100',
              isUser && 'self-end'
            )}>
              <MessageActions
                content={message.content}
                role={message.role}
                onRegenerate={isLastAssistant ? onRegenerate : undefined}
                onDelete={onDelete}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

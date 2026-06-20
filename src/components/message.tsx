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
  GitCompare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/lib/markdown';
import { MessageActions } from '@/components/message-actions';
import { getModelName } from '@/lib/models';
import { safeExternalUrl } from '@/lib/utils';
import { TASK_PRESETS } from '@/lib/tasks';
import type { Message as MessageType } from '@/types/chat';

interface MessageProps {
  message: MessageType;
  isLastAssistant?: boolean;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onDelete?: () => void;
  onPrefer?: () => void;
}

export function Message({
  message,
  isLastAssistant = false,
  isStreaming = false,
  onRegenerate,
  onDelete,
  onPrefer,
}: MessageProps) {
  const [sourcesOpen, setSourcesOpen] = useState(message.researchMode === true);
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const hasSearchResults =
    message.searchResults && message.searchResults.length > 0;
  const researchTrace = message.researchTrace;
  const taskPreset = message.taskType && message.taskType !== 'auto'
    ? TASK_PRESETS.find((task) => task.id === message.taskType)
    : null;
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
                {message.taskType === 'deep-research' ? 'Deep research' : 'Research'}
              </span>
            )}
            {isAssistant && taskPreset && !message.researchMode && (
              <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                {taskPreset.shortLabel}
              </span>
            )}
            {isAssistant && message.agentMode && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent-muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">
                <Route className="h-3 w-3" />
                Agent
              </span>
            )}
            {isAssistant && message.autoRouted && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]"
                title={message.routingNote || 'OpenConvo inferred the task and routing.'}
              >
                <Route className="h-3 w-3" />
                Auto routed
              </span>
            )}
            {isAssistant && message.compareRun && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                <GitCompare className="h-3 w-3" />
                Compare
              </span>
            )}
            {isAssistant && message.preferred && (
              <span className="inline-flex items-center rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-success)]">
                Preferred
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
              ) : message.researchMode ? (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">
                  <div className="mb-2 flex items-center gap-2 font-semibold text-[var(--color-text-primary)]">
                    <Microscope className="h-3.5 w-3.5" />
                    Drafting from sources
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-text-tertiary)]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-text-tertiary)] [animation-delay:120ms]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-text-tertiary)] [animation-delay:240ms]" />
                    <span>Free models can take a moment. Sources will be attached.</span>
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
                <SourcePills sources={message.searchResults!} />
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
                  {researchTrace && (
                    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[var(--color-text-primary)]">Research trace</span>
                        <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
                          {researchTrace.sourceCount} sources
                        </span>
                        <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
                          {researchTrace.openedCount} opened
                        </span>
                        {(researchTrace.providers || (researchTrace.provider ? [researchTrace.provider] : [])).map((provider) => (
                          <span key={provider} className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
                            {provider}
                          </span>
                        ))}
                      </div>
                      {researchTrace.plannedQueries && researchTrace.plannedQueries.length > 1 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                            Queries
                          </span>
                          <ol className="space-y-1">
                            {researchTrace.plannedQueries.map((query, index) => (
                              <li key={`${query}-${index}`} className="line-clamp-1">
                                {index + 1}. {query}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                      {researchTrace.providerErrors && researchTrace.providerErrors.length > 0 && (
                        <p className="mt-2 text-[var(--color-warning)]">
                          Some providers failed, so OpenConvo used fallback sources.
                        </p>
                      )}
                    </div>
                  )}
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
                        {source.extracted && (
                          <span className="mt-1 w-fit rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-success)]">
                            Opened page
                          </span>
                        )}
                        {source.sourceLabel && (
                          <span
                            className="mt-1 w-fit rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]"
                            title={source.sourceReason}
                          >
                            {source.sourceLabel}{typeof source.sourceScore === 'number' ? ` ${source.sourceScore}` : ''}
                          </span>
                        )}
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
              'mt-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 hover:opacity-100',
              isUser && 'self-end'
            )}>
              <MessageActions
                content={message.content}
                role={message.role}
                onRegenerate={isLastAssistant ? onRegenerate : undefined}
                onDelete={onDelete}
                onPrefer={message.compareRun && !message.isError ? onPrefer : undefined}
                preferred={message.preferred}
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

function SourcePills({ sources }: { sources: NonNullable<MessageType['searchResults']> }) {
  const visibleSources = sources.slice(0, 4);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
      <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1">
        {sources.length} sources reviewed
      </span>
      {visibleSources.map((source, index) => {
        const safeUrl = safeExternalUrl(source.url);
        const domain = getSourceDomain(source.url) || 'source';
        const content = (
          <>
            <span className="font-semibold text-[var(--color-text-primary)]">[{index + 1}]</span>
            <span>{domain}</span>
          </>
        );

        if (!safeUrl) {
          return (
            <span
              key={`${source.url}-${index}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1"
            >
              {content}
            </span>
          );
        }

        return (
          <a
            key={`${source.url}-${index}`}
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1 transition-colors hover:border-[var(--color-border-light)] hover:text-[var(--color-text-primary)]"
            title={source.title}
          >
            {content}
          </a>
        );
      })}
    </div>
  );
}

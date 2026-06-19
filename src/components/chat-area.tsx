'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Message, Attachment, Conversation, TaskType } from '@/types/chat';
import { AIModel } from '@/types/models';
import type { ModelReliability } from '@/types/models';
import { PromptSnippet } from '@/types/settings';
import { Message as MessageComponent } from './message';
import { Composer } from './composer';
import { EmptyState } from './empty-state';
import { ArtifactPanel } from './artifact-panel';
import { Button } from './ui/button';
import { ChevronDown, FileCode2, Gauge } from 'lucide-react';
import { useArtifacts } from '@/hooks/use-artifacts';
import { estimateContextUsage, formatTokenCount } from '@/lib/context-usage';

type ChatAccessMode = 'hosted-free' | 'byok' | 'missing-key';

interface ChatAreaProps {
  conversationId: string | null;
  conversation: Conversation | null;
  messages: Message[];
  isStreaming: boolean;
  error: string | null;
  onSendMessage: (args: { content: string; attachments?: Attachment[]; searchEnabled?: boolean; researchEnabled?: boolean; agentEnabled?: boolean; taskType?: TaskType }) => void;
  onStopStreaming: () => void;
  onRegenerateMessage: (id: string) => void;
  onDeleteMessage: (id: string) => void;
  models: AIModel[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  searchEnabled: boolean;
  onToggleSearch: () => void;
  researchEnabled: boolean;
  onToggleResearch: () => void;
  agentEnabled: boolean;
  onToggleAgent: () => void;
  onCreateNew: () => void;
  showSetupCard: boolean;
  hasTavilyKey: boolean;
  onOpenSettings: () => void;
  onDismissSetup: () => void;
  promptSnippets: PromptSnippet[];
  accessMode: ChatAccessMode;
  hostedFreeDailyLimit: number;
  hostedSearchAvailable: boolean;
  hostedSearchDailyLimit: number;
  modelReliability: ModelReliability[];
}

export function ChatArea({
  conversationId,
  conversation,
  messages,
  isStreaming,
  error,
  onSendMessage,
  onStopStreaming,
  onRegenerateMessage,
  onDeleteMessage,
  models,
  selectedModel,
  onSelectModel,
  searchEnabled,
  onToggleSearch,
  researchEnabled,
  onToggleResearch,
  agentEnabled,
  onToggleAgent,
  onCreateNew,
  showSetupCard,
  hasTavilyKey,
  onOpenSettings,
  onDismissSetup,
  promptSnippets,
  accessMode,
  hostedFreeDailyLimit,
  hostedSearchAvailable,
  hostedSearchDailyLimit,
  modelReliability,
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const { artifacts, updateArtifact, deleteArtifact } = useArtifacts(conversation, messages, isStreaming);
  const selectedModelInfo = models.find((model) => model.id === selectedModel);
  const contextUsage = estimateContextUsage(messages, selectedModelInfo?.contextLength || 4096);

  const scrollToBottom = () => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const handleScroll = () => {
      if (!scrollRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom);
    };

    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollEl.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (scrollEl) {
        scrollEl.removeEventListener('scroll', handleScroll);
      }
    };
  }, []);

  useEffect(() => {
    if (isStreaming) {
      scrollToBottom();
    }
  }, [messages, isStreaming]);

  // Initial scroll to bottom when conversation loads
  useEffect(() => {
    if (messages.length > 0 && !isStreaming) {
      setTimeout(scrollToBottom, 100);
    }
  }, [conversationId, messages.length, isStreaming]);

  if (!conversationId) {
    return (
      <EmptyState
        onCreateNew={onCreateNew}
        showSetupCard={showSetupCard}
        hasTavilyKey={hasTavilyKey}
        onOpenSettings={onOpenSettings}
        onDismissSetup={onDismissSetup}
        accessMode={accessMode}
        hostedFreeDailyLimit={hostedFreeDailyLimit}
      />
    );
  }

  const handleSend = (args: { content: string; attachments?: Attachment[]; searchEnabled?: boolean; researchEnabled?: boolean; agentEnabled?: boolean; taskType?: TaskType }) => {
    onSendMessage(args);
    setTimeout(scrollToBottom, 50);
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-[var(--color-bg-primary)]">
      {artifacts.length > 0 && (
        <button
          onClick={() => setArtifactsOpen(true)}
          className="absolute right-4 top-4 z-10 hidden items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] shadow-lg transition-colors hover:border-[var(--color-border-light)] hover:text-[var(--color-text-primary)] lg:flex"
          aria-label="Open artifacts"
        >
          <FileCode2 className="h-4 w-4" />
          Artifacts
          <span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px]">
            {artifacts.length}
          </span>
        </button>
      )}

      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 pb-44 pt-6 md:px-8 md:pt-8"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-1">
          {messages.map((message, index) => {
            const isLastAssistant =
              message.role === 'assistant' &&
              !messages.slice(index + 1).some((m) => m.role === 'assistant');

            return (
            <MessageComponent
              key={message.id}
              message={message}
              isLastAssistant={isLastAssistant}
              isStreaming={isStreaming && index === messages.length - 1}
              onRegenerate={() => onRegenerateMessage(message.id)}
              onDelete={() => onDeleteMessage(message.id)}
            />
            );
          })}
          <div ref={bottomRef} className="h-4" />
        </div>
      </div>

      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-36 left-1/2 -translate-x-1/2 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] p-2 rounded-full shadow-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-all z-10"
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={20} />
        </button>
      )}

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[var(--color-bg-primary)] via-[var(--color-bg-primary)] to-transparent px-3 pb-4 pt-14 md:px-6 md:pb-6">
        <div className="mx-auto max-w-4xl">
          {error && !messages[messages.length - 1]?.isError && (
            <div className="mb-4 text-sm text-[var(--color-danger)] bg-[var(--color-danger)]/10 p-3 rounded-lg border border-[var(--color-danger)]/20 text-center animate-fade-in">
              {error}
            </div>
          )}
          {messages.length > 0 && (
            <div className="mb-2 flex justify-end">
              <div
                className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-xs text-[var(--color-text-tertiary)] shadow-sm"
                title="Estimated context usage. Actual token counts vary by model."
              >
                <Gauge
                  className={
                    contextUsage.label === 'high'
                      ? 'h-3.5 w-3.5 text-[var(--color-danger)]'
                      : contextUsage.label === 'medium'
                        ? 'h-3.5 w-3.5 text-[var(--color-warning)]'
                        : 'h-3.5 w-3.5 text-[var(--color-text-tertiary)]'
                  }
                />
                <span>
                  {formatTokenCount(contextUsage.estimatedTokens)} / {formatTokenCount(contextUsage.contextLength)} est. tokens
                </span>
                <span
                  className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]"
                  aria-hidden="true"
                >
                  <span
                    className={
                      contextUsage.label === 'high'
                        ? 'block h-full bg-[var(--color-danger)]'
                        : contextUsage.label === 'medium'
                          ? 'block h-full bg-[var(--color-warning)]'
                          : 'block h-full bg-[var(--color-accent)]'
                    }
                    style={{ width: `${Math.max(contextUsage.ratio * 100, 3)}%` }}
                  />
                </span>
              </div>
            </div>
          )}
          <Composer
            onSend={handleSend}
            isStreaming={isStreaming}
            onStop={onStopStreaming}
            models={models}
            selectedModel={selectedModel}
            onSelectModel={onSelectModel}
            searchEnabled={searchEnabled}
            onToggleSearch={onToggleSearch}
            researchEnabled={researchEnabled}
            onToggleResearch={onToggleResearch}
            agentEnabled={agentEnabled}
            onToggleAgent={onToggleAgent}
            promptSnippets={promptSnippets}
            accessMode={accessMode}
            hostedFreeDailyLimit={hostedFreeDailyLimit}
            hostedSearchAvailable={hostedSearchAvailable && !hasTavilyKey}
            hostedSearchDailyLimit={hostedSearchDailyLimit}
            modelReliability={modelReliability}
          />
        </div>
      </div>

      <ArtifactPanel
        artifacts={artifacts}
        open={artifactsOpen}
        onClose={() => setArtifactsOpen(false)}
        onUpdate={updateArtifact}
        onDelete={deleteArtifact}
      />
    </div>
  );
}

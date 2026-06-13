'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowUp, BookOpen, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FileUpload } from '@/components/file-upload';
import { SearchToggle } from '@/components/search-toggle';
import { ResearchToggle } from '@/components/research-toggle';
import { AgentToggle } from '@/components/agent-toggle';
import { ModelSelector } from '@/components/model-selector';
import type { Attachment } from '@/types/chat';
import type { AIModel } from '@/types/models';
import type { PromptSnippet } from '@/types/settings';

type ChatAccessMode = 'hosted-free' | 'byok' | 'missing-key';

interface ComposerProps {
  onSend: (payload: {
    content: string;
    attachments?: Attachment[];
    searchEnabled?: boolean;
    researchEnabled?: boolean;
    agentEnabled?: boolean;
  }) => void;
  isStreaming: boolean;
  onStop: () => void;
  models: AIModel[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  searchEnabled: boolean;
  onToggleSearch: () => void;
  researchEnabled: boolean;
  onToggleResearch: () => void;
  agentEnabled: boolean;
  onToggleAgent: () => void;
  promptSnippets: PromptSnippet[];
  accessMode: ChatAccessMode;
  hostedFreeDailyLimit: number;
}

export function Composer({
  onSend,
  isStreaming,
  onStop,
  models,
  selectedModel,
  onSelectModel,
  searchEnabled,
  onToggleSearch,
  researchEnabled,
  onToggleResearch,
  agentEnabled,
  onToggleAgent,
  promptSnippets,
  accessMode,
  hostedFreeDailyLimit,
}: ComposerProps) {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = content.trim().length > 0 && !isStreaming;

  const handleSend = useCallback(() => {
    if (!canSend) return;

    onSend({
      content: content.trim(),
      attachments: attachments.length > 0 ? attachments : undefined,
      searchEnabled,
      researchEnabled,
      agentEnabled,
    });
    setContent('');
    setAttachments([]);
  }, [canSend, content, attachments, searchEnabled, researchEnabled, agentEnabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleAttach = useCallback((attachment: Attachment) => {
    setAttachments((prev) => [...prev, attachment]);
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleInsertSnippet = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const snippet = promptSnippets.find((item) => item.id === event.target.value);
    event.target.value = '';
    if (!snippet) return;
    setContent((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed}\n\n${snippet.content}` : snippet.content;
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [promptSnippets]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="w-full">
      <div className="mx-auto max-w-3xl rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 shadow-2xl shadow-black/20 transition-all focus-within:border-[var(--color-border-light)]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-tertiary)]">
          <span>
            {accessMode === 'byok' && 'Using your OpenRouter key'}
            {accessMode === 'hosted-free' && `Hosted free mode: ${hostedFreeDailyLimit} messages/day`}
            {accessMode === 'missing-key' && 'Add an OpenRouter key in Settings to chat'}
          </span>
          {accessMode === 'hosted-free' && (
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
              Shared capacity
            </span>
          )}
        </div>

        {attachments.length > 0 && (
          <div className="mb-2">
            <FileUpload
              attachments={attachments}
              onAttach={handleAttach}
              onRemove={handleRemoveAttachment}
            />
          </div>
        )}

        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message OpenConvo..."
          maxHeight={200}
          className="min-h-[44px] text-sm"
          disabled={false}
        />

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {attachments.length === 0 && (
              <FileUpload
                attachments={attachments}
                onAttach={handleAttach}
                onRemove={handleRemoveAttachment}
              />
            )}
            <SearchToggle enabled={searchEnabled} onToggle={onToggleSearch} />
            <ResearchToggle enabled={researchEnabled} onToggle={onToggleResearch} />
            <AgentToggle enabled={agentEnabled} onToggle={onToggleAgent} />
            {promptSnippets.length > 0 && (
              <div className="relative">
                <BookOpen className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                <select
                  defaultValue=""
                  onChange={handleInsertSnippet}
                  className="h-8 max-w-[150px] rounded-md border border-transparent bg-transparent py-1 pl-7 pr-2 text-xs text-[var(--color-text-secondary)] outline-none transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] focus:border-[var(--color-border)] sm:max-w-[190px]"
                  aria-label="Insert prompt"
                >
                  <option value="">Prompts</option>
                  {promptSnippets.map((snippet) => (
                    <option key={snippet.id} value={snippet.id}>
                      {snippet.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <ModelSelector
              models={models}
              selectedModel={selectedModel}
              onSelect={onSelectModel}
              compact
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {isStreaming ? (
              <Button
                variant="secondary"
                size="sm"
                icon
                onClick={onStop}
                aria-label="Stop generating"
                className="h-8 w-8"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                icon
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send message"
                className="h-8 w-8"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

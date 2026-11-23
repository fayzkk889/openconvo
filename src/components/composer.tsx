'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowUp, BookOpen, Check, ChevronDown, GitCompare, Paperclip, Square, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseFile } from '@/lib/file-parser';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FileUpload } from '@/components/file-upload';
import { AgentToggle } from '@/components/agent-toggle';
import { SearchToggle } from '@/components/search-toggle';
import { ResearchToggle } from '@/components/research-toggle';
import { ModelSelector } from '@/components/model-selector';
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
} from '@/components/ui/dropdown';
import type { Attachment, TaskType, RequestLifecycleState } from '@/types/chat';
import type { AIModel } from '@/types/models';
import type { ModelReliability } from '@/types/models';
import type { PromptSnippet } from '@/types/settings';
import { TASK_PRESETS } from '@/lib/tasks';
import type { WorkflowStarterDraft } from '@/lib/workflow-starters';

type ChatAccessMode = 'hosted-free' | 'byok' | 'missing-key';

interface ComposerProps {
  onSend: (payload: {
    content: string;
    attachments?: Attachment[];
    searchEnabled?: boolean;
    researchEnabled?: boolean;
    agentEnabled?: boolean;
    taskType?: TaskType;
    compareEnabled?: boolean;
  }) => void;
  isStreaming: boolean;
  isBusy?: boolean;
  lifecycleState?: RequestLifecycleState;
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
  hostedSearchAvailable: boolean;
  hostedSearchDailyLimit: number;
  modelReliability: ModelReliability[];
  workflowDraft?: WorkflowStarterDraft | null;
  onWorkflowDraftApplied?: () => void;
}

export function Composer({
  onSend,
  isStreaming,
  isBusy,
  lifecycleState,
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
  hostedSearchAvailable,
  hostedSearchDailyLimit,
  modelReliability,
  workflowDraft,
  onWorkflowDraftApplied,
}: ComposerProps) {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [taskType, setTaskType] = useState<TaskType>('auto');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const dragCounterRef = useRef(0);
  // Parses can overlap (a second drop or paste while the first file is still
  // parsing). Track them with a counter so Send stays disabled until all finish,
  // and check duplicates against the latest attachments rather than a stale render.
  const pendingParsesRef = useRef(0);
  const attachmentsRef = useRef<Attachment[]>([]);
  attachmentsRef.current = attachments;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isWorking = isStreaming || Boolean(isBusy);
  const canSend = (content.trim().length > 0 || attachments.length > 0) && !isWorking && !isParsingFiles;

  const handleSend = useCallback(() => {
    if (!canSend) return;

    const trimmed = content.trim();
    const effectiveContent = trimmed || (attachments.length > 0 ? 'Analyze the attached document and summarize key points.' : '');
    if (!effectiveContent) return;

    const currentAttachments = attachments.length > 0 ? attachments : undefined;
    setContent('');
    setAttachments([]);
    setFileError(null);
    setTaskType((prev) => (prev === 'file' ? 'auto' : prev));

    onSend({
      content: effectiveContent,
      attachments: currentAttachments,
      searchEnabled,
      researchEnabled,
      agentEnabled,
      taskType: attachments.length > 0 && taskType === 'auto' ? 'file' : taskType,
      compareEnabled,
    });
  }, [canSend, content, attachments, searchEnabled, researchEnabled, agentEnabled, taskType, compareEnabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter while an IME composition is active confirms the candidate text
      // (CJK input); it must not send a half-composed message.
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const processFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setFileError(null);
      pendingParsesRef.current += 1;
      setIsParsingFiles(true);

      try {
        for (const file of files) {
          if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)) {
            setFileError('Images are not supported for text extraction; please upload PDF, TXT, MD, CSV, or code files.');
            continue;
          }

          const isDuplicate = attachmentsRef.current.some((a) => a.name === file.name && a.size === file.size);
          if (isDuplicate) {
            setFileError(`"${file.name}" is already attached.`);
            continue;
          }

          try {
            const attachment = await parseFile(file);
            setAttachments((prev) => {
              if (prev.some((a) => a.name === attachment.name && a.size === attachment.size)) {
                return prev;
              }
              return [...prev, attachment];
            });
            setTaskType((prev) => (prev === 'auto' ? 'file' : prev));
          } catch (err) {
            console.error('Failed to parse file:', err);
            setFileError(err instanceof Error ? err.message : `Failed to read ${file.name}`);
          }
        }
      } finally {
        pendingParsesRef.current = Math.max(0, pendingParsesRef.current - 1);
        if (pendingParsesRef.current === 0) setIsParsingFiles(false);
      }
    },
    []
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      dragCounterRef.current += 1;
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0) {
        await processFiles(files);
      }
    },
    [processFiles]
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const files = e.clipboardData?.files ? Array.from(e.clipboardData.files) : [];
      if (files.length === 0) {
        // Normal text paste proceeds without interference
        return;
      }

      // Pasted files detected
      e.preventDefault();
      await processFiles(files);
    },
    [processFiles]
  );

  const handleAttach = useCallback((attachment: Attachment) => {
    setAttachments((prev) => [...prev, attachment]);
    setTaskType((prev) => (prev === 'auto' ? 'file' : prev));
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const next = prev.filter((a) => a.id !== id);
      if (next.length === 0) {
        setTaskType((current) => (current === 'file' ? 'auto' : current));
      }
      return next;
    });
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

  useEffect(() => {
    if (!workflowDraft) return;
    setContent(workflowDraft.starter.prompt);
    setTaskType(workflowDraft.starter.taskType);
    setCompareEnabled(Boolean(workflowDraft.starter.compareEnabled));
    setAttachments([]);
    onWorkflowDraftApplied?.();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [onWorkflowDraftApplied, workflowDraft]);

  return (
    <div className="w-full">
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
        className={cn(
          'relative mx-auto max-w-3xl rounded-lg border bg-[var(--color-bg-secondary)] p-3 shadow-2xl shadow-black/20 transition-all focus-within:border-[var(--color-border-light)]',
          isDragging
            ? 'border-dashed border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/20 bg-[var(--color-accent)]/5'
            : 'border-[var(--color-border)]'
        )}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-[var(--color-bg-secondary)]/90 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-center text-sm font-medium text-[var(--color-accent)]">
              <Paperclip className="h-6 w-6 animate-bounce" />
              <span>Drop files here to attach (PDF, TXT, MD, CSV, code)</span>
            </div>
          </div>
        )}

        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-tertiary)]">
          <span className="min-w-0">
            {accessMode === 'byok' && 'Using your OpenRouter key'}
            {accessMode === 'hosted-free' && `Hosted free mode: ${hostedFreeDailyLimit} messages/day`}
            {accessMode === 'missing-key' && 'This deployment uses your own free OpenRouter key; add it in Settings to chat. Keys stay in this browser.'}
            {hostedSearchAvailable && (
              <>
                {' '}
                Search trial: {hostedSearchDailyLimit}/day
              </>
            )}
            {compareEnabled && ' Compare uses 2 model runs.'}
          </span>
          {accessMode === 'hosted-free' && (
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
              Shared capacity
            </span>
          )}
        </div>

        {fileError && (
          <div className="mb-2 flex items-center justify-between rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-1.5 text-xs text-[var(--color-danger)]">
            <span>{fileError}</span>
            <button
              type="button"
              onClick={() => setFileError(null)}
              className="ml-2 text-xs font-semibold hover:opacity-80"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2">
            <FileUpload
              attachments={attachments}
              onAttach={handleAttach}
              onRemove={handleRemoveAttachment}
              onFilesSelected={processFiles}
              isParsing={isParsingFiles}
            />
          </div>
        )}

        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            attachments.length > 0
              ? 'Ask a question about the attached document, or send to analyze...'
              : 'Message OpenConvo...'
          }
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
                onFilesSelected={processFiles}
                isParsing={isParsingFiles}
              />
            )}
            <Dropdown>
              <DropdownTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 max-w-[160px] gap-1.5 px-2 text-xs text-[var(--color-text-secondary)]"
                  aria-label="Task preset"
                  title={TASK_PRESETS.find((task) => task.id === taskType)?.description}
                >
                  <Workflow className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-tertiary)]" />
                  <span className="truncate">
                    {TASK_PRESETS.find((task) => task.id === taskType)?.shortLabel || 'Auto'}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                </Button>
              </DropdownTrigger>
              <DropdownContent align="start" className="w-64">
                {TASK_PRESETS.map((task) => (
                  <DropdownItem
                    key={task.id}
                    onClick={() => setTaskType(task.id)}
                    className="items-start justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                        {task.label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-tertiary)]">
                        {task.description}
                      </span>
                    </span>
                    {task.id === taskType && <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" />}
                  </DropdownItem>
                ))}
              </DropdownContent>
            </Dropdown>
            <SearchToggle enabled={searchEnabled} onToggle={onToggleSearch} />
            <ResearchToggle enabled={researchEnabled} onToggle={onToggleResearch} />
            <AgentToggle enabled={agentEnabled} onToggle={onToggleAgent} />
            <button
              type="button"
              onClick={() => setCompareEnabled((prev) => !prev)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                compareEnabled
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
              aria-label="Compare models"
              title="Compare the selected model with another strong free model"
            >
              <GitCompare className="h-4 w-4" />
            </button>
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
              taskType={taskType}
              reliability={modelReliability}
              compact
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {isParsingFiles && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-accent)] animate-pulse">
                <Paperclip className="h-3.5 w-3.5" />
                <span>Reading file...</span>
              </span>
            )}
            {isWorking ? (
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

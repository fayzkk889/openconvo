'use client';

import React from 'react';
import { ArrowRight, Brain, CheckCircle2, FileText, Globe, Key, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ChatAccessMode = 'hosted-free' | 'byok' | 'missing-key';

interface EmptyStateProps {
  onCreateNew: () => void;
  showSetupCard: boolean;
  hasTavilyKey: boolean;
  onOpenSettings: () => void;
  onDismissSetup: () => void;
  accessMode: ChatAccessMode;
  hostedFreeDailyLimit: number;
}

const features = [
  {
    icon: Brain,
    title: 'Switch models',
    description: 'Use free OpenRouter models without changing your workflow.',
  },
  {
    icon: Globe,
    title: 'Search when needed',
    description: 'Ground answers with web context only when the task calls for it.',
  },
  {
    icon: FileText,
    title: 'Bring context',
    description: 'Attach notes, PDFs, code, or docs before you ask.',
  },
];

export function EmptyState({
  onCreateNew,
  showSetupCard,
  hasTavilyKey,
  onOpenSettings,
  onDismissSetup,
  accessMode,
  hostedFreeDailyLimit,
}: EmptyStateProps) {
  return (
    <div className="flex h-full w-full items-start justify-center overflow-y-auto px-4 py-4 sm:px-5 sm:py-6 md:px-8 lg:px-10">
      <div className="empty-state-shell w-full max-w-4xl">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <img
            src="/logo-transparent.png"
            alt="OpenConvo"
            className="logo-image empty-state-logo mb-3 h-auto w-36 object-contain opacity-95 sm:w-44 md:w-52"
          />

          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-text-primary)]" />
            Local-first AI workspace
          </div>

          <h1 className="max-w-2xl text-balance text-2xl font-semibold leading-tight text-[var(--color-text-primary)] sm:text-3xl lg:text-4xl">
            Start a focused conversation.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-text-secondary)] sm:text-base">
            A clean place for model switching, grounded answers, and file-aware chats.
          </p>

          <Button
            size="lg"
            onClick={onCreateNew}
            className="mt-5 h-11 rounded-lg px-5 text-sm font-semibold sm:mt-6 md:h-12 md:px-6"
          >
            Start a conversation
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {showSetupCard && (
          <div className="empty-setup-card mx-auto mt-5 max-w-2xl rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-left shadow-sm sm:mt-6 sm:p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]">
                <Key className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                      Local setup
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
                      {accessMode === 'hosted-free'
                        ? `No account is required. This hosted instance includes shared free capacity: ${hostedFreeDailyLimit} messages per day.`
                        : 'No account is required. Add your own free API keys locally, or use server environment keys if this instance already has them.'}
                    </p>
                  </div>
                  <button
                    onClick={onDismissSetup}
                    className="rounded p-1 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                    aria-label="Dismiss setup"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                    <CheckCircle2 className={accessMode !== 'missing-key' ? 'h-4 w-4 text-[var(--color-accent)]' : 'h-4 w-4 text-[var(--color-text-tertiary)]'} />
                    {accessMode === 'byok' && 'OpenRouter key saved'}
                    {accessMode === 'hosted-free' && 'Hosted free mode ready'}
                    {accessMode === 'missing-key' && 'OpenRouter key needed for chat'}
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                    <CheckCircle2 className={hasTavilyKey ? 'h-4 w-4 text-[var(--color-accent)]' : 'h-4 w-4 text-[var(--color-text-tertiary)]'} />
                    Tavily key {hasTavilyKey ? 'saved' : 'for search'}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={onOpenSettings}>
                    Open settings
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onDismissSetup}>
                    Not now
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="empty-features mt-5 grid gap-3 sm:mt-6 md:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="flex gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-left shadow-sm transition-colors hover:border-[var(--color-border-light)] md:block"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] md:mb-4">
                <feature.icon className="h-[18px] w-[18px]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {feature.title}
                </h3>
                <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)] md:mt-2">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { useState, useRef } from 'react';
import { Settings as SettingsType } from '@/types/settings';
import { AIModel, ModelReliability } from '@/types/models';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { ConfirmDialog } from './confirm-dialog';
import { Brain, Library, Moon, Sun, Download, Upload, Trash2, Monitor, Palette, Database, Cpu, Key, Plus, BarChart3 } from 'lucide-react';
import { TASK_PRESETS, normalizeTaskType } from '@/lib/tasks';
import { getReliabilitySignal } from '@/lib/model-reliability';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SettingsType;
  onUpdateSettings: (updates: Partial<SettingsType>) => void;
  models: AIModel[];
  modelReliability: ModelReliability[];
  onClearData: () => void;
  onClearModelReliability: () => void;
  onExportModelReliability: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

type Tab = 'general' | 'keys' | 'models' | 'memory' | 'prompts' | 'system' | 'data' | 'about';

export function SettingsModal({
  open,
  onOpenChange,
  settings,
  onUpdateSettings,
  models,
  modelReliability,
  onClearData,
  onClearModelReliability,
  onExportModelReliability,
  onExport,
  onImport,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [modelTaskFilter, setModelTaskFilter] = useState('auto');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showClearModelLearningConfirm, setShowClearModelLearningConfirm] = useState(false);
  const [selectedSnippetId, setSelectedSnippetId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedSnippet =
    settings.promptSnippets.find((snippet) => snippet.id === selectedSnippetId) ||
    settings.promptSnippets[0] ||
    null;
  const defaultModelInfo = models.find((model) => model.id === settings.defaultModel);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
    }
    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCreateSnippet = () => {
    const now = Date.now();
    const snippet = {
      id: `snippet-${now}-${Math.random().toString(36).slice(2, 8)}`,
      title: 'New prompt',
      content: '',
      createdAt: now,
      updatedAt: now,
    };
    onUpdateSettings({ promptSnippets: [snippet, ...settings.promptSnippets] });
    setSelectedSnippetId(snippet.id);
  };

  const handleUpdateSnippet = (updates: { title?: string; content?: string }) => {
    if (!selectedSnippet) return;
    onUpdateSettings({
      promptSnippets: settings.promptSnippets.map((snippet) =>
        snippet.id === selectedSnippet.id
          ? { ...snippet, ...updates, updatedAt: Date.now() }
          : snippet
      ),
    });
  };

  const handleDeleteSnippet = () => {
    if (!selectedSnippet) return;
    const next = settings.promptSnippets.filter((snippet) => snippet.id !== selectedSnippet.id);
    onUpdateSettings({ promptSnippets: next });
    setSelectedSnippetId(next[0]?.id || '');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 flex flex-col md:h-[620px] md:flex-row gap-0 rounded-lg"
          style={{ width: 'min(760px, calc(100vw - 2rem))', maxWidth: '760px' }}
        >
          
          {/* Sidebar Tabs */}
          <div className="w-full shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:w-56 md:border-b-0 md:border-r md:p-4 flex flex-row md:flex-col gap-1 overflow-x-auto">
            <h2 className="mb-3 hidden px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)] md:block">Settings</h2>
            
            <button
              onClick={() => setActiveTab('general')}
              className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'general' 
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' 
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Palette size={16} />
              General
            </button>
            <button
              onClick={() => setActiveTab('keys')}
              className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'keys' 
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' 
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Key size={16} />
              API Keys
            </button>
            <button
              onClick={() => setActiveTab('models')}
              className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'models' 
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' 
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <BarChart3 size={16} />
              Models
            </button>
            <button
              onClick={() => setActiveTab('memory')}
              className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'memory' 
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' 
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Brain size={16} />
              Memory
            </button>
            <button
              onClick={() => setActiveTab('system')}
              className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'system' 
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' 
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Cpu size={16} />
              System Prompt
            </button>
            <button
              onClick={() => setActiveTab('prompts')}
              className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'prompts' 
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' 
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Library size={16} />
              Prompts
            </button>
            <button
              onClick={() => setActiveTab('data')}
              className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'data' 
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' 
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Database size={16} />
              Data
            </button>
            <button
              onClick={() => setActiveTab('about')}
              className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'about' 
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' 
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Monitor size={16} />
              About
            </button>
          </div>

          {/* Content Area */}
          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg-primary)] p-5 md:p-7">
            <DialogTitle className="mb-6 text-2xl font-semibold tracking-tight">
              {activeTab === 'general' && 'General Settings'}
              {activeTab === 'keys' && 'API Keys'}
              {activeTab === 'models' && 'Model Report Cards'}
              {activeTab === 'memory' && 'Memory'}
              {activeTab === 'system' && 'System Prompt'}
              {activeTab === 'prompts' && 'Prompt Library'}
              {activeTab === 'data' && 'Data Management'}
              {activeTab === 'about' && 'About OpenConvo'}
            </DialogTitle>
            
            <DialogDescription className="sr-only">
              Configure your OpenConvo workspace settings.
            </DialogDescription>

            {activeTab === 'general' && (
              <div className="space-y-6 animate-fade-in">
                <div className="space-y-3">
                  <label className="text-sm font-medium text-[var(--color-text-secondary)]">Theme</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => onUpdateSettings({ theme: 'dark' })}
                      className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-md border p-4 transition-all ${
                        settings.theme === 'dark' 
                          ? 'border-[var(--color-text-primary)] bg-[var(--color-bg-secondary)]' 
                          : 'border-[var(--color-border)] bg-transparent hover:border-[var(--color-border-light)]'
                      }`}
                    >
                      <Moon size={24} className={settings.theme === 'dark' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'} />
                      <span className="text-sm font-medium">Dark</span>
                    </button>
                    <button
                      onClick={() => onUpdateSettings({ theme: 'light' })}
                      className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-md border p-4 transition-all ${
                        settings.theme === 'light' 
                          ? 'border-[var(--color-text-primary)] bg-[var(--color-bg-secondary)]' 
                          : 'border-[var(--color-border)] bg-transparent hover:border-[var(--color-border-light)]'
                      }`}
                    >
                      <Sun size={24} className={settings.theme === 'light' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'} />
                      <span className="text-sm font-medium">Light</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-[var(--color-text-secondary)]">Default Model</label>
                  <select
                    value={settings.defaultModel}
                    onChange={(e) => onUpdateSettings({ defaultModel: e.target.value })}
                    className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-md p-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-text-primary)] focus:border-transparent transition-all"
                  >
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} ({model.provider})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    This model will be selected by default for new conversations.
                  </p>
                  <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs leading-5 text-[var(--color-text-tertiary)]">
                    OpenConvo only lists zero-price models with a <span className="font-mono">:free</span> model id, and chat requests also enforce a zero max price with OpenRouter.
                  </p>
                  {defaultModelInfo && (
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {defaultModelInfo.name}
                        </span>
                        {defaultModelInfo.isFree && (
                          <span className="rounded-full bg-[var(--color-accent-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--color-accent)]">
                            Free
                          </span>
                        )}
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-[var(--color-text-secondary)] sm:grid-cols-2">
                        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2">
                          Provider: {defaultModelInfo.provider}
                        </div>
                        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2">
                          Context: {formatContextLength(defaultModelInfo.contextLength)} tokens
                        </div>
                      </div>
                      {defaultModelInfo.description && (
                        <p className="mt-3 text-xs leading-5 text-[var(--color-text-tertiary)]">
                          {defaultModelInfo.description}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'keys' && (
              <div className="space-y-6 animate-fade-in">
                <div className="space-y-3">
                  <label className="text-sm font-medium text-[var(--color-text-secondary)]">OpenRouter API Key</label>
                  <Input
                    type="password"
                    placeholder="sk-or-v1-..."
                    value={settings.openrouterApiKey || ''}
                    onChange={(e) => onUpdateSettings({ openrouterApiKey: e.target.value })}
                  />
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    Required for chat. Get your free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">openrouter.ai/keys</a>.
                    If left blank, the app will try to use the server's environment variable.
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-[var(--color-text-secondary)]">Tavily API Key</label>
                  <Input
                    type="password"
                    placeholder="tvly-..."
                    value={settings.tavilyApiKey || ''}
                    onChange={(e) => onUpdateSettings({ tavilyApiKey: e.target.value })}
                  />
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    Required for web search. Get your free key at <a href="https://tavily.com" target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">tavily.com</a>.
                    If left blank, the app will try to use the server's environment variable.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'models' && (
              <div className="space-y-5 animate-fade-in">
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Local model learning</h3>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                        OpenConvo learns from successful responses, rate limits, failures, and compare preferences in this browser only.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={onExportModelReliability}
                        disabled={modelReliability.length === 0}
                      >
                        <Download size={15} />
                        Export
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowClearModelLearningConfirm(true)}
                        disabled={modelReliability.length === 0}
                      >
                        <Trash2 size={15} />
                        Reset
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {modelReliability.length === 0
                        ? 'No local model results recorded yet.'
                        : `${modelReliability.length} local model-task records saved.`}
                    </p>
                    <select
                      value={modelTaskFilter}
                      onChange={(event) => setModelTaskFilter(event.target.value)}
                      className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none"
                      aria-label="Model report task"
                    >
                      {TASK_PRESETS.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-3">
                  {rankModelsForTask(models, modelReliability, modelTaskFilter).map(({ model, signal, stats }) => (
                    <div key={model.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{model.name}</h3>
                            {signal.recommended && (
                              <span className="rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-success)]">
                                Recommended
                              </span>
                            )}
                            {model.cooldownUntil && model.cooldownUntil > Date.now() && (
                              <span className="rounded-full bg-[var(--color-warning)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                                Cooling down
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">{model.id}</p>
                          <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">{signal.detail}</p>
                        </div>
                        <div className="text-left sm:text-right">
                          <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{signal.score}</div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">Score</div>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <Metric label="Success" value={stats?.successes || 0} />
                        <Metric label="Failures" value={stats?.failures || 0} />
                        <Metric label="Rate limits" value={stats?.rateLimits || 0} />
                        <Metric label="Picked" value={stats?.preferenceWins || 0} />
                      </div>
                    </div>
                  ))}

                  {models.length === 0 && (
                    <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
                      No models available yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'system' && (
              <div className="space-y-4 animate-fade-in flex flex-col h-full">
                <div className="flex justify-between items-end">
                  <label className="text-sm font-medium text-[var(--color-text-secondary)]">Custom Instructions</label>
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    {settings.systemPrompt.length} chars
                  </span>
                </div>
                <Textarea
                  value={settings.systemPrompt}
                  onChange={(e) => onUpdateSettings({ systemPrompt: e.target.value })}
                  placeholder="E.g., You are a concise and helpful expert programmer. Always provide brief answers."
                  className="flex-1 min-h-[200px] resize-none"
                />
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  These instructions will be prepended to all new conversations to guide the assistant's behavior.
                </p>
                <div className="flex justify-end pt-2">
                  <Button variant="ghost" onClick={() => onUpdateSettings({ systemPrompt: '' })}>
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'memory' && (
              <div className="space-y-5 animate-fade-in flex flex-col h-full">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                  <div>
                    <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Use memory in chats</h3>
                    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                      Memory is local to this browser.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ memoryEnabled: !settings.memoryEnabled })}
                    className={`relative h-6 w-11 rounded-full border transition-colors ${
                      settings.memoryEnabled
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                        : 'border-[var(--color-border)] bg-[var(--color-bg-tertiary)]'
                    }`}
                    aria-pressed={settings.memoryEnabled}
                    aria-label={settings.memoryEnabled ? 'Disable memory' : 'Enable memory'}
                  >
                    <span
                      className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                        settings.memoryEnabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex justify-between items-end">
                  <label className="text-sm font-medium text-[var(--color-text-secondary)]">Saved Memory</label>
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    {settings.memory.length} chars
                  </span>
                </div>
                <Textarea
                  value={settings.memory}
                  onChange={(e) => onUpdateSettings({ memory: e.target.value })}
                  placeholder="Examples: preferred tone, recurring project context, coding preferences, personal facts you want reused."
                  className="flex-1 min-h-[260px] resize-none"
                />
                <div className="flex justify-end pt-2">
                  <Button variant="ghost" onClick={() => onUpdateSettings({ memory: '' })}>
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'prompts' && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Save reusable prompts and insert them from the composer.
                  </p>
                  <Button size="sm" onClick={handleCreateSnippet}>
                    <Plus size={16} />
                    New
                  </Button>
                </div>

                {settings.promptSnippets.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center">
                    <Library className="mx-auto mb-3 h-8 w-8 text-[var(--color-text-tertiary)]" />
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      No saved prompts yet.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-[190px_1fr]">
                    <div className="min-h-[280px] space-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2">
                      {settings.promptSnippets.map((snippet) => (
                        <button
                          key={snippet.id}
                          onClick={() => setSelectedSnippetId(snippet.id)}
                          className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                            selectedSnippet?.id === snippet.id
                              ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                          }`}
                        >
                          <span className="block truncate">{snippet.title}</span>
                        </button>
                      ))}
                    </div>

                    {selectedSnippet && (
                      <div className="space-y-3">
                        <Input
                          value={selectedSnippet.title}
                          onChange={(event) => handleUpdateSnippet({ title: event.target.value })}
                          placeholder="Prompt title"
                        />
                        <Textarea
                          value={selectedSnippet.content}
                          onChange={(event) => handleUpdateSnippet({ content: event.target.value })}
                          placeholder="Write the reusable prompt..."
                          className="min-h-[260px] resize-none"
                        />
                        <div className="flex justify-end">
                          <Button variant="ghost" size="sm" onClick={handleDeleteSnippet} className="hover:text-[var(--color-danger)]">
                            <Trash2 size={16} />
                            Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'data' && (
              <div className="space-y-6 animate-fade-in">
                <div className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                  <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Export & Import</h3>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Backup your conversations to a JSON file, or restore from a previous backup.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="secondary" onClick={onExport} className="flex-1">
                      <Download size={16} />
                      Export Data
                    </Button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept=".json"
                      onChange={handleFileChange}
                    />
                    <Button variant="secondary" onClick={handleImportClick} className="flex-1">
                      <Upload size={16} />
                      Import Data
                    </Button>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-4">
                  <h3 className="text-sm font-medium text-[var(--color-danger)]">Danger Zone</h3>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Permanently delete all your conversations and reset settings to default. This action cannot be undone.
                  </p>
                  <Button 
                    variant="danger" 
                    onClick={() => setShowClearConfirm(true)}
                  >
                    <Trash2 size={16} />
                    Clear All Data
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'about' && (
              <div className="space-y-6 animate-fade-in flex flex-col items-center justify-center h-full text-center pb-12">
                <div className="mb-6 flex w-56 justify-center">
                  <img src="/logo-transparent.png" alt="OpenConvo Logo" className="logo-image h-auto w-full object-contain" />
                </div>
                <p className="text-[var(--color-text-secondary)] max-w-sm">
                  A local-first, model-agnostic AI chat workspace built for speed, privacy, and elegance.
                </p>
                <div className="flex gap-4 mt-6">
                  <span className="px-3 py-1 bg-[var(--color-bg-secondary)] rounded-full text-xs font-mono text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                    v0.1.0
                  </span>
                </div>
                
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="Clear All Data?"
        description="Are you sure you want to delete all conversations and reset all settings? This action cannot be undone unless you have a backup."
        confirmLabel="Yes, delete everything"
        variant="danger"
        onConfirm={() => {
          onClearData();
          setShowClearConfirm(false);
          onOpenChange(false);
        }}
      />
      <ConfirmDialog
        open={showClearModelLearningConfirm}
        onOpenChange={setShowClearModelLearningConfirm}
        title="Reset Model Learning?"
        description="This clears local model scores, rate-limit history, and compare preferences in this browser. Your conversations, files, settings, and keys stay untouched."
        confirmLabel="Reset learning"
        variant="danger"
        onConfirm={() => {
          onClearModelReliability();
          setShowClearModelLearningConfirm(false);
        }}
      />
    </>
  );
}

function formatContextLength(contextLength: number): string {
  if (contextLength >= 1000000) return `${(contextLength / 1000000).toFixed(1)}M`;
  if (contextLength >= 1000) return `${Math.round(contextLength / 1000)}k`;
  return String(contextLength);
}

function rankModelsForTask(models: AIModel[], reliability: ModelReliability[], taskType: string) {
  const normalizedTask = normalizeTaskType(taskType);
  return models
    .map((model) => {
      const stats = reliability.find((item) => item.modelId === model.id && item.taskType === normalizedTask);
      const signal = getReliabilitySignal(model, reliability, normalizedTask, models);
      return { model, stats, signal };
    })
    .sort((a, b) => b.signal.score - a.signal.score);
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2">
      <div className="text-sm font-semibold text-[var(--color-text-primary)]">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">{label}</div>
    </div>
  );
}

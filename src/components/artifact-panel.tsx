'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileCode2, Save, Trash2, X } from 'lucide-react';
import { Artifact } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface ArtifactPanelProps {
  artifacts: Artifact[];
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Artifact>) => void;
  onDelete: (id: string) => void;
}

export function ArtifactPanel({ artifacts, open, onClose, onUpdate, onDelete }: ArtifactPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('');
  const [content, setContent] = useState('');
  const [copied, setCopied] = useState(false);

  const selected = useMemo(() => {
    if (artifacts.length === 0) return null;
    return artifacts.find((artifact) => artifact.id === selectedId) || artifacts[artifacts.length - 1];
  }, [artifacts, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setTitle(selected.title);
    setLanguage(selected.language);
    setContent(selected.content);
  }, [selected]);

  if (!open || !selected) return null;

  const dirty =
    title !== selected.title ||
    language !== selected.language ||
    content !== selected.content;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleSave = () => {
    onUpdate(selected.id, {
      title: title.trim() || selected.title,
      language: language.trim() || 'text',
      content,
    });
  };

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-20 hidden w-[420px] border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/30 lg:flex lg:flex-col">
      <div className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-4">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-4 w-4 text-[var(--color-text-secondary)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Canvas</span>
          <span className="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-tertiary)]">
            {artifacts.length}
          </span>
        </div>
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close canvas">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3 border-b border-[var(--color-border)] p-3">
        <select
          value={selected.id}
          onChange={(event) => setSelectedId(event.target.value)}
          className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-light)]"
        >
          {artifacts.map((artifact) => (
            <option key={artifact.id} value={artifact.id}>
              {artifact.title}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-[1fr_110px] gap-2">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          <Input value={language} onChange={(event) => setLanguage(event.target.value)} />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(selected.id)}
              className="hover:text-[var(--color-danger)]"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!dirty}>
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
      </div>

      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        autoResize={false}
        className="h-full flex-1 rounded-none border-0 bg-[var(--color-bg-primary)] p-4 font-mono text-xs leading-6 text-[var(--color-text-secondary)]"
      />
    </aside>
  );
}

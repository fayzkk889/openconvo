'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  Trash2,
  Settings,
  X,
  MessageSquare,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  Folder,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatRelativeTime, truncate } from '@/lib/utils';
import type { Conversation, Project } from '@/types/chat';
import type { AIModel } from '@/types/models';

interface SidebarProps {
  conversations: Conversation[];
  projects: Project[];
  models: AIModel[];
  activeProject: Project | null;
  activeId: string | null;
  activeProjectId: string | null;
  onSelect: (id: string) => void;
  onSelectProject: (id: string | null) => void;
  onCreateProject: () => void;
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
  onDeleteProject: (id: string) => void;
  onCreateNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onTogglePinned: (id: string) => void;
  onToggleArchived: (id: string) => void;
  onOpenSettings: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  showArchived: boolean;
  onToggleShowArchived: () => void;
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  conversations,
  projects,
  models,
  activeProject,
  activeId,
  activeProjectId,
  onSelect,
  onSelectProject,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onCreateNew,
  onRename,
  onDelete,
  onTogglePinned,
  onToggleArchived,
  onOpenSettings,
  searchQuery,
  onSearchChange,
  showArchived,
  onToggleShowArchived,
  isOpen,
  onClose,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectInstructions, setProjectInstructions] = useState('');
  const [projectDefaultModel, setProjectDefaultModel] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    id: string;
    title: string;
  }>({ open: false, id: '', title: '' });
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback(
    (conv: Conversation, e: React.MouseEvent) => {
      e.stopPropagation();
      setRenamingId(conv.id);
      setRenameValue(conv.title);
    },
    []
  );

  const submitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, onRename]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitRename();
      } else if (e.key === 'Escape') {
        cancelRename();
      }
    },
    [submitRename, cancelRename]
  );

  const confirmDelete = useCallback(
    (conv: Conversation, e: React.MouseEvent) => {
      e.stopPropagation();
      setDeleteConfirm({ open: true, id: conv.id, title: conv.title });
    },
    []
  );

  const handleDelete = useCallback(() => {
    onDelete(deleteConfirm.id);
    setDeleteConfirm({ open: false, id: '', title: '' });
  }, [deleteConfirm.id, onDelete]);

  // Focus rename input when renaming starts
  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (activeProject && projectSettingsOpen) {
      setProjectName(activeProject.name);
      setProjectInstructions(activeProject.instructions || '');
      setProjectDefaultModel(activeProject.defaultModel || '');
    }
  }, [activeProject, projectSettingsOpen]);

  const openProjectSettings = useCallback(() => {
    if (!activeProject) return;
    setProjectName(activeProject.name);
    setProjectInstructions(activeProject.instructions || '');
    setProjectDefaultModel(activeProject.defaultModel || '');
    setProjectSettingsOpen(true);
  }, [activeProject]);

  const saveProjectSettings = useCallback(() => {
    if (!activeProject || !projectName.trim()) return;
    onUpdateProject(activeProject.id, {
      name: projectName.trim(),
      instructions: projectInstructions.trim() || undefined,
      defaultModel: projectDefaultModel || undefined,
    });
    setProjectSettingsOpen(false);
  }, [activeProject, projectName, projectInstructions, projectDefaultModel, onUpdateProject]);

  const sidebarContent = (
    <div
      className="flex h-full w-full flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
    >
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b border-[var(--color-border)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-bg-tertiary)] ring-1 ring-[var(--color-border)]">
            <img src="/mark-transparent.png" alt="Logo" className="logo-image h-7 w-7 object-contain" />
          </div>
          <span className="truncate text-sm font-semibold tracking-tight text-[var(--color-text-primary)]">
            OpenConvo
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={onToggleCollapse}
            className="hidden md:inline-flex"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={onCreateNew}
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </Button>
          {/* Mobile close button */}
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={onClose}
            className="md:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations..."
            className="h-9 rounded-md bg-[var(--color-bg-tertiary)] pl-9 text-sm"
          />
        </div>
      </div>

      {/* Projects */}
      <div className="border-b border-[var(--color-border)] px-2 pb-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
            Projects
          </span>
          <button
            onClick={onCreateProject}
            className="rounded p-1 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            aria-label="New project"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => onSelectProject(null)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
              activeProjectId === null
                ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
            )}
          >
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span className="truncate">All chats</span>
          </button>
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => onSelectProject(project.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                activeProjectId === project.id
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              )}
            >
              <Folder className="h-4 w-4 shrink-0" />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
        </div>
        {activeProject && (
          <button
            onClick={openProjectSettings}
            className="mt-2 flex w-full items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-2.5 py-2 text-left text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-light)] hover:text-[var(--color-text-primary)]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Project settings</span>
          </button>
        )}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[var(--color-border)]">
        <div className="mb-1 flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
            {showArchived ? 'Archived' : 'Chats'}
          </span>
          <button
            onClick={onToggleShowArchived}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          >
            {showArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            {showArchived ? 'Active' : 'Archive'}
          </button>
        </div>
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            {showArchived ? (
              <Archive className="mb-2 h-8 w-8 text-[var(--color-text-tertiary)]" />
            ) : (
              <MessageSquare className="mb-2 h-8 w-8 text-[var(--color-text-tertiary)]" />
            )}
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {searchQuery ? 'No conversations found' : showArchived ? 'No archived chats' : 'No conversations yet'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 py-1">
            {conversations.map((conv) => {
              const isActive = conv.id === activeId;
              const isRenaming = conv.id === renamingId;

              return (
                <div
                  key={conv.id}
                  onClick={() => !isRenaming && onSelect(conv.id)}
                  className={cn(
                    'group/item relative flex cursor-pointer items-center rounded-md border border-transparent px-3 py-2.5 transition-colors',
                    isActive
                      ? 'border-[var(--color-border-light)] bg-[var(--color-bg-active)]'
                      : 'hover:border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]'
                  )}
                  role="button"
                  tabIndex={0}
                >
                  {isRenaming ? (
                    <div className="flex w-full items-center gap-1">
                      <Input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={submitRename}
                        className="h-7 text-xs flex-1"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        onClick={(e) => {
                          e.stopPropagation();
                          submitRename();
                        }}
                        className="h-6 w-6"
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            'flex items-center gap-1.5 truncate text-sm leading-5',
                            isActive
                              ? 'text-[var(--color-text-primary)] font-medium'
                              : 'text-[var(--color-text-secondary)]'
                          )}
                        >
                          {conv.pinned && <Pin className="h-3 w-3 shrink-0 text-[var(--color-accent)]" />}
                          <span className="truncate">{truncate(conv.title, 30)}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
                          {formatRelativeTime(conv.updatedAt)}
                        </p>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
                        {!conv.archived && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onTogglePinned(conv.id);
                            }}
                            className="rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-hover)] transition-colors"
                            aria-label={conv.pinned ? 'Unpin' : 'Pin'}
                          >
                            {conv.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                          </button>
                        )}
                        <button
                          onClick={(e) => startRename(conv, e)}
                          className="rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                          aria-label="Rename"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleArchived(conv.id);
                          }}
                          className="rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                          aria-label={conv.archived ? 'Unarchive' : 'Archive'}
                        >
                          {conv.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                        </button>
                        <button
                          onClick={(e) => confirmDelete(conv, e)}
                          className="rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-hover)] transition-colors"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Settings button */}
      <div className="border-t border-[var(--color-border)] p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenSettings}
          className="w-full justify-start gap-2 text-[var(--color-text-secondary)]"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Button>
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) =>
          setDeleteConfirm((prev) => ({ ...prev, open }))
        }
        title="Delete conversation"
        description={`Are you sure you want to delete "${truncate(deleteConfirm.title, 40)}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        variant="danger"
      />

      <Dialog open={projectSettingsOpen} onOpenChange={setProjectSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            Set project-level context that will be added to chats in this workspace.
          </DialogDescription>

          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                Name
              </label>
              <Input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Project name"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                Instructions
              </label>
              <Textarea
                value={projectInstructions}
                onChange={(event) => setProjectInstructions(event.target.value)}
                placeholder="Describe the project, preferred style, constraints, important context, or recurring goals."
                className="min-h-[160px] resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                Default model
              </label>
              <select
                value={projectDefaultModel}
                onChange={(event) => setProjectDefaultModel(event.target.value)}
                className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-light)]"
              >
                <option value="">Use global default</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.provider})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  if (!activeProject) return;
                  onDeleteProject(activeProject.id);
                  setProjectSettingsOpen(false);
                }}
              >
                Delete project
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setProjectSettingsOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveProjectSettings} disabled={!projectName.trim()}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  const collapsedContent = (
    <div className="flex h-full w-full flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-3">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-bg-tertiary)] ring-1 ring-[var(--color-border)]">
        <img src="/mark-transparent.png" alt="" className="logo-image h-7 w-7 object-contain" />
      </div>

      <div className="flex flex-col gap-1">
        <Button
          variant="ghost"
          size="sm"
          icon
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon
          onClick={onCreateNew}
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-auto">
        <Button
          variant="ghost"
          size="sm"
          icon
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className={cn(
        'hidden md:flex h-full shrink-0 relative z-20 transition-[width] duration-200',
        isCollapsed ? 'w-[64px]' : 'w-[304px]'
      )}>
        {isCollapsed ? collapsedContent : sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* Sidebar */}
          <div className="relative z-10 h-full w-[320px] max-w-[86vw] animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}

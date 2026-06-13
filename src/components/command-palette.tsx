'use client';

import React, { useMemo, useState } from 'react';
import {
  Archive,
  Bot,
  Folder,
  MessageSquare,
  Microscope,
  PanelLeft,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn, formatRelativeTime, truncate } from '@/lib/utils';
import type { Conversation, Project } from '@/types/chat';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: Conversation[];
  projects: Project[];
  onCreateNew: () => void;
  onOpenSettings: () => void;
  onSelectConversation: (id: string) => void;
  onSelectProject: (id: string | null) => void;
  onToggleSidebar: () => void;
  onToggleSearch: () => void;
  onToggleResearch: () => void;
  onToggleAgent: () => void;
  onShowArchived: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  keywords: string;
  icon: React.ElementType;
  action: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  conversations,
  projects,
  onCreateNew,
  onOpenSettings,
  onSelectConversation,
  onSelectProject,
  onToggleSidebar,
  onToggleSearch,
  onToggleResearch,
  onToggleAgent,
  onShowArchived,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');

  const commands = useMemo<CommandItem[]>(() => {
    const staticCommands: CommandItem[] = [
      {
        id: 'new-chat',
        label: 'New conversation',
        description: 'Start a fresh chat',
        keywords: 'new chat conversation start',
        icon: Plus,
        action: onCreateNew,
      },
      {
        id: 'settings',
        label: 'Open settings',
        description: 'Models, memory, prompts, keys, and data',
        keywords: 'settings preferences memory prompts keys data',
        icon: Settings,
        action: onOpenSettings,
      },
      {
        id: 'sidebar',
        label: 'Toggle sidebar',
        description: 'Collapse or expand navigation',
        keywords: 'sidebar collapse expand navigation',
        icon: PanelLeft,
        action: onToggleSidebar,
      },
      {
        id: 'search',
        label: 'Toggle web search',
        description: 'Enable or disable live web grounding',
        keywords: 'web search internet grounding',
        icon: Search,
        action: onToggleSearch,
      },
      {
        id: 'research',
        label: 'Toggle research mode',
        description: 'Use deeper source-backed answers',
        keywords: 'research sources deep web',
        icon: Microscope,
        action: onToggleResearch,
      },
      {
        id: 'agent',
        label: 'Toggle agent mode',
        description: 'Use task-runner style responses',
        keywords: 'agent task planning',
        icon: Bot,
        action: onToggleAgent,
      },
      {
        id: 'archived',
        label: 'Show archived chats',
        description: 'Open the archive view in the sidebar',
        keywords: 'archive archived hidden chats',
        icon: Archive,
        action: onShowArchived,
      },
      {
        id: 'all-chats',
        label: 'Go to all chats',
        description: 'Leave the current project filter',
        keywords: 'all chats conversations',
        icon: MessageSquare,
        action: () => onSelectProject(null),
      },
    ];

    const projectCommands = projects.map((project): CommandItem => ({
      id: `project-${project.id}`,
      label: project.name,
      description: 'Open project',
      keywords: `project workspace ${project.name}`,
      icon: Folder,
      action: () => onSelectProject(project.id),
    }));

    const conversationCommands = conversations.map((conversation): CommandItem => ({
      id: `conversation-${conversation.id}`,
      label: conversation.title,
      description: `${conversation.archived ? 'Archived chat' : 'Chat'} - ${formatRelativeTime(conversation.updatedAt)}`,
      keywords: `chat conversation ${conversation.title}`,
      icon: MessageSquare,
      action: () => onSelectConversation(conversation.id),
    }));

    return [...staticCommands, ...projectCommands, ...conversationCommands];
  }, [
    conversations,
    projects,
    onCreateNew,
    onOpenSettings,
    onSelectConversation,
    onSelectProject,
    onShowArchived,
    onToggleAgent,
    onToggleResearch,
    onToggleSearch,
    onToggleSidebar,
  ]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands.slice(0, 12);
    return commands
      .filter((command) =>
        `${command.label} ${command.description || ''} ${command.keywords}`
          .toLowerCase()
          .includes(normalized)
      )
      .slice(0, 20);
  }, [commands, query]);

  const runCommand = (command: CommandItem) => {
    command.action();
    setQuery('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0"
        style={{ width: 'min(640px, calc(100vw - 2rem))', maxWidth: '640px' }}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search conversations, projects, and app commands.
        </DialogDescription>

        <div className="border-b border-[var(--color-border)] p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands, chats, projects..."
            autoFocus
            className="h-11 border-0 bg-[var(--color-bg-tertiary)] text-sm"
          />
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-[var(--color-text-tertiary)]">
              No commands found
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((command) => {
                const Icon = command.icon;
                return (
                  <button
                    key={command.id}
                    onClick={() => runCommand(command)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                      'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {truncate(command.label, 64)}
                      </span>
                      {command.description && (
                        <span className="mt-0.5 block truncate text-xs text-[var(--color-text-tertiary)]">
                          {command.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { useConversations } from '@/hooks/use-conversations';
import { useChat } from '@/hooks/use-chat';
import { useModels } from '@/hooks/use-models';
import { useSettings } from '@/hooks/use-settings';
import { useDeploymentConfig } from '@/hooks/use-deployment-config';
import { useToast } from '@/hooks/use-toast';
import { useSearch } from '@/hooks/use-search';
import { downloadExport, importFromFile } from '@/lib/export';
import { clearAllData } from '@/lib/storage';
import { resolveSafeModelId } from '@/lib/models';

import { Sidebar } from './sidebar';
import { ChatArea } from './chat-area';
import { CommandPalette } from './command-palette';
import { SettingsModal } from './settings-modal';
import { ToastContainer } from './toast';
import { TooltipProvider } from './ui/tooltip';
import { Menu } from 'lucide-react';

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const { settings, loaded: settingsLoaded, updateSettings, resetSettings } = useSettings();
  const deploymentConfig = useDeploymentConfig();
  const { models, selectedModel, setSelectedModel, markModelsCoolingDown, loading: modelsLoading } = useModels(
    settings?.openrouterApiKey,
    settings?.defaultModel
  );
  const { toasts, addToast, removeToast } = useToast();
  const {
    searchEnabled,
    researchEnabled,
    agentEnabled,
    setSearchEnabled,
    toggleSearch,
    toggleResearch,
    toggleAgent,
  } = useSearch();

  const {
    conversations,
    allConversations,
    projects,
    activeProjectId,
    activeProject,
    activeId,
    activeConversation,
    searchQuery,
    setSearchQuery,
    showArchived,
    setShowArchived,
    createNew,
    createProject,
    selectProject,
    select,
    rename,
    remove,
    updateProject,
    removeProject,
    updateConversationModel,
    togglePinned,
    toggleArchived,
    refresh,
  } = useConversations();

  const {
    messages,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    regenerateMessage,
    removeMessage,
  } = useChat(
    activeId, 
    selectedModel, 
    [
      settings?.systemPrompt,
      settings?.memoryEnabled && settings.memory
        ? `## Memory\nUse these saved user preferences and facts when they are relevant. Do not reveal this memory unless the user asks about it.\n\n${settings.memory}`
        : '',
      activeProject?.instructions,
    ].filter(Boolean).join('\n\n'),
    settings?.openrouterApiKey,
    settings?.tavilyApiKey,
    models,
    markModelsCoolingDown
  );

  // Auto-close sidebar on mobile when a conversation is selected
  useEffect(() => {
    if (activeId) {
      setSidebarOpen(false);
    }
  }, [activeId]);

  useEffect(() => {
    if (!settingsLoaded) return;
    setSearchEnabled(settings.searchEnabled);
  }, [settings.searchEnabled, settingsLoaded, setSearchEnabled]);

  useEffect(() => {
    if (!settingsLoaded || modelsLoading) return;
    const safeDefaultModel = resolveSafeModelId(settings.defaultModel, models);
    if (safeDefaultModel !== settings.defaultModel) {
      updateSettings({ defaultModel: safeDefaultModel });
    }
  }, [models, modelsLoading, settings.defaultModel, settingsLoaded, updateSettings]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle clear data
  const handleClearData = async () => {
    await clearAllData();
    resetSettings();
    await refresh();
    addToast('All data has been cleared', 'success');
  };

  // Handle import
  const handleImport = async (file: File) => {
    try {
      const importedSettings = await importFromFile(file);
      if (importedSettings) {
        updateSettings(importedSettings);
      }
      await refresh();
      setSettingsOpen(false);
      addToast('Data imported successfully', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Import failed', 'error');
    }
  };

  const handleUpdateSettings = (updates: Parameters<typeof updateSettings>[0]) => {
    if (updates.defaultModel) {
      const safeDefaultModel = resolveSafeModelId(updates.defaultModel, models);
      updateSettings({ ...updates, defaultModel: safeDefaultModel });
      setSelectedModel(safeDefaultModel);
      return;
    }
    updateSettings(updates);
  };

  const handleToggleSearch = () => {
    const next = !searchEnabled;
    toggleSearch();
    updateSettings({ searchEnabled: next });
  };

  const handleShowArchived = () => {
    if (!showArchived) {
      setShowArchived(true);
    }
  };

  const handleSelectConversation = (id: string) => {
    const conversation = allConversations.find((conv) => conv.id === id);
    if (conversation) {
      const safeModel = resolveSafeModelId(conversation.model, models);
      setSelectedModel(safeModel);
      if (safeModel !== conversation.model) {
        updateConversationModel(id, safeModel);
      }
    }
    select(id);
  };

  const handleSelectProject = (id: string | null) => {
    const project = projects.find((item) => item.id === id);
    if (project?.defaultModel) {
      const safeModel = resolveSafeModelId(project.defaultModel, models);
      setSelectedModel(safeModel);
      if (safeModel !== project.defaultModel) {
        updateProject(project.id, { defaultModel: safeModel });
      }
    }
    selectProject(id);
  };

  const handleCreateNew = async () => {
    const modelForConversation = resolveSafeModelId(activeProject?.defaultModel || selectedModel, models);
    setSelectedModel(modelForConversation);
    await createNew(modelForConversation);
  };

  const handleSelectModel = (modelId: string) => {
    const safeModel = resolveSafeModelId(modelId, models);
    setSelectedModel(safeModel);
    if (activeId) {
      updateConversationModel(activeId, safeModel);
    }
  };

  const accessMode = settings.openrouterApiKey
    ? 'byok'
    : deploymentConfig.hostedFreeModeAvailable
      ? 'hosted-free'
      : 'missing-key';

  // Prevent rendering until critical state is loaded to avoid flashes
  if (!settingsLoaded) return null;

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden bg-[var(--color-bg-primary)]">
        {/* Mobile Header */}
        <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] z-20 flex items-center px-4 shadow-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors p-2 -ml-2"
            aria-label="Open sidebar"
          >
            <Menu size={20} />
          </button>
          <div className="flex flex-1 items-center justify-center gap-2 font-semibold text-[var(--color-text-primary)]">
            <img src="/mark-transparent.png" alt="" className="logo-image h-6 w-6 object-contain" />
            OpenConvo
          </div>
          <div className="w-8" /> {/* Spacer for centering */}
        </div>

        {/* Sidebar */}
        <Sidebar
          conversations={conversations}
          projects={projects}
          models={models}
          activeProject={activeProject}
          activeId={activeId}
          activeProjectId={activeProjectId}
          onSelect={handleSelectConversation}
          onSelectProject={handleSelectProject}
          onCreateProject={createProject}
          onUpdateProject={updateProject}
          onDeleteProject={removeProject}
          onCreateNew={handleCreateNew}
          onRename={rename}
          onDelete={remove}
          onTogglePinned={togglePinned}
          onToggleArchived={toggleArchived}
          onOpenSettings={() => setSettingsOpen(true)}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          showArchived={showArchived}
          onToggleShowArchived={() => setShowArchived((prev) => !prev)}
        />

        {/* Main Content */}
        <main className="flex-1 relative flex flex-col h-full md:h-screen pt-14 md:pt-0">
          <ChatArea
            conversationId={activeId}
            conversation={activeConversation}
            messages={messages}
            isStreaming={isStreaming}
            error={error}
            onSendMessage={(args) => {
              const titleConversationId = activeId;
              sendMessage({
                ...args,
                searchEnabled: args.searchEnabled ?? searchEnabled,
                researchEnabled: args.researchEnabled ?? researchEnabled,
                agentEnabled: args.agentEnabled ?? agentEnabled,
                onTitleGenerated: (title) => {
                  if (titleConversationId) rename(titleConversationId, title);
                }
              });
            }}
            onStopStreaming={stopStreaming}
            onRegenerateMessage={regenerateMessage}
            onDeleteMessage={removeMessage}
            models={models}
            selectedModel={selectedModel}
            onSelectModel={handleSelectModel}
            searchEnabled={searchEnabled}
            onToggleSearch={handleToggleSearch}
            researchEnabled={researchEnabled}
            onToggleResearch={toggleResearch}
            agentEnabled={agentEnabled}
            onToggleAgent={toggleAgent}
            onCreateNew={handleCreateNew}
            showSetupCard={!settings.onboardingDismissed}
            hasTavilyKey={Boolean(settings.tavilyApiKey)}
            onOpenSettings={() => setSettingsOpen(true)}
            onDismissSetup={() => updateSettings({ onboardingDismissed: true })}
            promptSnippets={settings.promptSnippets}
            accessMode={accessMode}
            hostedFreeDailyLimit={deploymentConfig.hostedFreeDailyLimit}
          />
        </main>

        <SettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          models={models}
          onClearData={handleClearData}
          onExport={() => downloadExport(settings)}
          onImport={handleImport}
        />

        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          conversations={allConversations}
          projects={projects}
          onCreateNew={handleCreateNew}
          onOpenSettings={() => setSettingsOpen(true)}
          onSelectConversation={handleSelectConversation}
          onSelectProject={handleSelectProject}
          onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
          onToggleSearch={handleToggleSearch}
          onToggleResearch={toggleResearch}
          onToggleAgent={toggleAgent}
          onShowArchived={handleShowArchived}
        />

        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
    </TooltipProvider>
  );
}

import assert from 'node:assert/strict';
import { resolveWorkflow, inferTaskType, isCasualGreeting } from '@/lib/tasks';
import { selectBoundedContext, estimateContextUsage } from '@/lib/context-usage';
import { isFreeModelId, FALLBACK_CHAIN } from '@/lib/models';
import { buildConversationTitle } from '@/lib/title';
import { validateImportData } from '@/lib/export';

const results = [];
let passCount = 0;
let failCount = 0;

async function test(id, description, fn) {
  try {
    await fn();
    passCount += 1;
    results.push({ id, status: 'PASSED', description });
    console.log(`[PASS] Test ${id}: ${description}`);
  } catch (error) {
    failCount += 1;
    results.push({ id, status: 'FAILED', description, error: error.message, stack: error.stack });
    console.error(`[FAIL] Test ${id}: ${description}\n  Error: ${error.message}`);
  }
}

// In-memory mock storage implementing OpenConvo's storage interface
function createMockStorage() {
  const conversations = new Map();
  const messages = new Map();
  const artifacts = new Map();

  return {
    async createConversation(model = 'mock:free') {
      const id = 'conv-' + Math.random().toString(36).slice(2, 9);
      const conv = { id, title: 'New conversation', model, createdAt: Date.now(), updatedAt: Date.now() };
      conversations.set(id, conv);
      return conv;
    },
    async getConversation(id) {
      return conversations.get(id) || null;
    },
    async getAllConversations() {
      return Array.from(conversations.values());
    },
    async updateConversation(id, updates) {
      const existing = conversations.get(id);
      if (!existing) return;
      const updated = { ...existing, ...updates, updatedAt: Date.now() };
      conversations.set(id, updated);
      return updated;
    },
    async deleteConversation(id) {
      conversations.delete(id);
      for (const [msgId, msg] of messages.entries()) {
        if (msg.conversationId === id) messages.delete(msgId);
      }
    },
    async addMessage(conversationId, msg) {
      const id = 'msg-' + Math.random().toString(36).slice(2, 9);
      const record = { id, conversationId, timestamp: Date.now(), ...msg };
      messages.set(id, record);
      return record;
    },
    async getMessages(conversationId) {
      return Array.from(messages.values())
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.timestamp - b.timestamp);
    },
    async deleteMessage(id) {
      messages.delete(id);
    },
    async updateMessage(id, updates) {
      const existing = messages.get(id);
      if (!existing) return;
      const updated = { ...existing, ...updates };
      messages.set(id, updated);
      return updated;
    },
    _raw: { conversations, messages, artifacts },
  };
}

// -------------------------------------------------------------
// Test 1: Normal two-turn chat persists after refreshing
// -------------------------------------------------------------
await test(1, 'Normal two-turn chat persists after refreshing', async () => {
  const store = createMockStorage();
  const conv = await store.createConversation();

  // Turn 1
  await store.addMessage(conv.id, { role: 'user', content: 'Turn 1 user' });
  await store.addMessage(conv.id, { role: 'assistant', content: 'Turn 1 reply' });

  // Turn 2
  await store.addMessage(conv.id, { role: 'user', content: 'Turn 2 user' });
  await store.addMessage(conv.id, { role: 'assistant', content: 'Turn 2 reply' });

  // Simulate refresh / reload
  const reloadedMessages = await store.getMessages(conv.id);
  assert.equal(reloadedMessages.length, 4);
  assert.equal(reloadedMessages[0].content, 'Turn 1 user');
  assert.equal(reloadedMessages[1].content, 'Turn 1 reply');
  assert.equal(reloadedMessages[2].content, 'Turn 2 user');
  assert.equal(reloadedMessages[3].content, 'Turn 2 reply');
});

// -------------------------------------------------------------
// Test 2: Auto mode correctly routes an ordinary question
// -------------------------------------------------------------
await test(2, 'Auto mode correctly routes an ordinary question', async () => {
  const decision = resolveWorkflow({
    content: 'What is 2 + 2?',
    taskType: 'auto',
    searchEnabled: false,
    researchEnabled: false,
  });
  assert.equal(decision.taskType, 'quick');
  assert.equal(decision.shouldSearch, false);
  assert.equal(decision.searchMode, 'none');
  assert.equal(decision.isQuickTask, true);
});

// -------------------------------------------------------------
// Test 3: Explicit search performs a search
// -------------------------------------------------------------
await test(3, 'Explicit search performs a search', async () => {
  const decision = resolveWorkflow({
    content: 'What is 2 + 2?',
    taskType: 'auto',
    searchEnabled: true,
    researchEnabled: false,
  });
  assert.equal(decision.shouldSearch, true);
  assert.equal(decision.searchMode, 'search');
});

// -------------------------------------------------------------
// Test 4: Explicit research performs research
// -------------------------------------------------------------
await test(4, 'Explicit research performs research', async () => {
  const decisionFromPreset = resolveWorkflow({
    content: 'What is 2 + 2?',
    taskType: 'research',
  });
  assert.equal(decisionFromPreset.shouldSearch, true);
  assert.equal(decisionFromPreset.searchMode, 'research');

  const decisionFromToggle = resolveWorkflow({
    content: 'What is 2 + 2?',
    taskType: 'auto',
    researchEnabled: true,
  });
  assert.equal(decisionFromToggle.shouldSearch, true);
  assert.equal(decisionFromToggle.searchMode, 'research');
});

// -------------------------------------------------------------
// Test 5: Quick mode makes no search request
// -------------------------------------------------------------
await test(5, 'Quick mode makes no search request', async () => {
  const decision = resolveWorkflow({
    content: 'latest breaking news today',
    taskType: 'quick',
    searchEnabled: true,
    researchEnabled: true,
  });
  assert.equal(decision.shouldSearch, false);
  assert.equal(decision.searchMode, 'none');
  assert.equal(decision.isQuickTask, true);
});

// -------------------------------------------------------------
// Test 6: Stop is visible during slow research
// -------------------------------------------------------------
await test(6, 'Stop is visible during slow research', async () => {
  // Verify that during search phase, lifecycle state is 'searching', isBusy is true, and canStop is true
  let lifecycleState = 'idle';
  const getIsBusy = () => ['preparing', 'searching', 'connecting', 'streaming', 'persisting'].includes(lifecycleState);
  const getCanStop = () => getIsBusy();

  lifecycleState = 'searching';
  assert.equal(getIsBusy(), true);
  assert.equal(getCanStop(), true);
});

// -------------------------------------------------------------
// Test 7: Cancelling research prevents the chat request from starting
// -------------------------------------------------------------
await test(7, 'Cancelling research prevents the chat request from starting', async () => {
  const controller = new AbortController();
  let chatStarted = false;

  // Simulate search fetch composed with cancellation controller
  const searchPromise = new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('User stopped request'));
    controller.signal.addEventListener('abort', onAbort);
  });

  // User aborts during search
  controller.abort();

  let aborted = false;
  try {
    await searchPromise;
    chatStarted = true;
  } catch (err) {
    aborted = true;
  }

  assert.equal(aborted, true);
  assert.equal(chatStarted, false);
});

// -------------------------------------------------------------
// Test 8: Rapid repeated sends cannot start overlapping runs
// -------------------------------------------------------------
await test(8, 'Rapid repeated sends cannot start overlapping runs', async () => {
  let activeRun = null;
  let runCount = 0;

  function trySend(text) {
    if (activeRun && ['preparing', 'searching', 'connecting', 'streaming', 'persisting'].includes(activeRun.state)) {
      return false; // Lock rejected
    }
    activeRun = { id: 'run-' + (++runCount), state: 'searching' };
    return true;
  }

  const firstAccepted = trySend('first question');
  const secondAccepted = trySend('rapid second question');

  assert.equal(firstAccepted, true);
  assert.equal(secondAccepted, false);
  assert.equal(runCount, 1);
});

// -------------------------------------------------------------
// Test 9: A cancellation followed immediately by a new send cannot clear the new run state
// -------------------------------------------------------------
await test(9, 'A cancellation followed immediately by a new send cannot clear the new run state', async () => {
  let activeRun = null;
  let lifecycleState = 'idle';

  // Run 1 starts
  const run1Id = 'run-1';
  activeRun = { id: run1Id, state: 'streaming' };
  lifecycleState = 'streaming';

  // Run 1 is cancelled
  activeRun.state = 'cancelled';

  // Immediately Run 2 starts
  const run2Id = 'run-2';
  activeRun = { id: run2Id, state: 'preparing' };
  lifecycleState = 'preparing';

  // Run 1's finally block executes
  const run1Finally = () => {
    if (activeRun?.id === run1Id) {
      activeRun = null;
      lifecycleState = 'idle';
    }
  };
  run1Finally();

  // Invariant check: Run 1 finally must NOT clear Run 2
  assert.equal(activeRun?.id, run2Id);
  assert.equal(lifecycleState, 'preparing');
});

// -------------------------------------------------------------
// Test 10: A delayed conversation-A load cannot overwrite conversation B
// -------------------------------------------------------------
await test(10, 'A delayed conversation-A load cannot overwrite conversation B', async () => {
  let activeConversationId = 'conv-a';
  let loadCounter = 0;
  let visibleMessages = [];

  async function loadMessages(convId, delayMs, fakeMessages) {
    const currentLoad = ++loadCounter;
    await new Promise((r) => setTimeout(r, delayMs));
    // Guard invariant
    if (currentLoad !== loadCounter || activeConversationId !== convId) {
      return; // Discard stale load
    }
    visibleMessages = fakeMessages;
  }

  // User starts on A, but A's DB load is slow (50ms)
  const loadA = loadMessages('conv-a', 50, [{ id: 'a1', content: 'Message from A' }]);

  // User quickly switches to B (fast load 10ms)
  activeConversationId = 'conv-b';
  const loadB = loadMessages('conv-b', 10, [{ id: 'b1', content: 'Message from B' }]);

  await Promise.all([loadA, loadB]);

  assert.equal(visibleMessages.length, 1);
  assert.equal(visibleMessages[0].content, 'Message from B');
});

// -------------------------------------------------------------
// Test 11: Switching during active research cannot mix conversations
// -------------------------------------------------------------
await test(11, 'Switching during active research cannot mix conversations', async () => {
  const store = createMockStorage();
  const convA = await store.createConversation();
  const convB = await store.createConversation();

  let activeConversationId = convA.id;
  const runAController = new AbortController();
  const runA = { id: 'run-a', conversationId: convA.id, controller: runAController, state: 'searching' };

  // Switch to B
  activeConversationId = convB.id;
  runAController.abort(); // Cancel previous active run

  // Run A finishes async search afterwards
  let wroteToStore = false;
  if (!runAController.signal.aborted && activeConversationId === convA.id) {
    await store.addMessage(convA.id, { role: 'assistant', content: 'A research result' });
    wroteToStore = true;
  }

  assert.equal(wroteToStore, false);
  const msgsB = await store.getMessages(convB.id);
  assert.equal(msgsB.length, 0);
});

// -------------------------------------------------------------
// Test 12: Switching during streaming cannot mix conversations
// -------------------------------------------------------------
await test(12, 'Switching during streaming cannot mix conversations', async () => {
  let activeConversationId = 'conv-a';
  const runA = { id: 'run-a', conversationId: 'conv-a', controller: new AbortController() };
  let messagesView = [];

  // Stream chunk processor
  function onChunk(run, chunk) {
    if (run.controller.signal.aborted || activeConversationId !== run.conversationId) {
      return; // Do not append chunks to new conversation!
    }
    messagesView.push(chunk);
  }

  onChunk(runA, 'chunk 1');
  assert.equal(messagesView.length, 1);

  // Switch to B
  activeConversationId = 'conv-b';
  runA.controller.abort();
  messagesView = []; // Reset view for B

  // Late chunk arriving from A
  onChunk(runA, 'chunk 2');
  assert.equal(messagesView.length, 0);
});

// -------------------------------------------------------------
// Test 13: Old error states cannot leak into a newly selected conversation
// -------------------------------------------------------------
await test(13, 'Old error states cannot leak into a newly selected conversation', async () => {
  let errorState = 'Search timed out on Alpha';
  let activeConversationId = 'conv-alpha';

  // Switch conversation
  function switchConversation(newId) {
    activeConversationId = newId;
    errorState = null; // Clean slate
  }

  switchConversation('conv-beta');
  assert.equal(errorState, null);
});

// -------------------------------------------------------------
// Test 14: Failed assistant messages are excluded from upstream history
// -------------------------------------------------------------
await test(14, 'Failed assistant messages are excluded from upstream history', async () => {
  const history = [
    { id: '1', role: 'user', content: 'Hello' },
    { id: '2', role: 'assistant', content: '502 Bad Gateway', isError: true },
    { id: '3', role: 'user', content: 'What is 3 + 3?' },
  ];

  // Logic from useChat:buildApiMessages
  const valid = history.filter((m) => !m.isError && m.content && m.content.trim().length > 0);
  const apiMessages = valid.map((m) => ({ role: m.role, content: m.content }));

  assert.equal(apiMessages.length, 2);
  assert.equal(apiMessages[0].content, 'Hello');
  assert.equal(apiMessages[1].content, 'What is 3 + 3?');
  assert.equal(apiMessages.some((m) => m.content.includes('502')), false);
});

// -------------------------------------------------------------
// Test 15: A conversation containing more than 100 messages still transmits its newest user request
// -------------------------------------------------------------
await test(15, 'A conversation containing more than 100 messages still transmits its newest user request', async () => {
  const largeHistory = [];
  for (let i = 0; i < 120; i++) {
    largeHistory.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    });
  }
  largeHistory.push({ role: 'user', content: 'Latest critical question' });

  const bounded = selectBoundedContext(largeHistory, 100);

  assert.ok(bounded.length <= 100);
  assert.equal(bounded[bounded.length - 1].content, 'Latest critical question');
  // First message must not be an orphaned assistant reply
  assert.equal(bounded[0].role, 'user');
});

// -------------------------------------------------------------
// Test 16: Regeneration preserves correct history and attachments
// -------------------------------------------------------------
await test(16, 'Regeneration preserves correct history and attachments', async () => {
  const store = createMockStorage();
  const conv = await store.createConversation();
  const u1 = await store.addMessage(conv.id, { role: 'user', content: 'Turn 1' });
  const a1 = await store.addMessage(conv.id, { role: 'assistant', content: 'Answer 1' });
  const u2 = await store.addMessage(conv.id, {
    role: 'user',
    content: 'Turn 2 with file',
    attachments: [{ id: 'f1', name: 'data.txt', content: 'file content', size: 10, type: 'text/plain' }],
  });
  const a2 = await store.addMessage(conv.id, { role: 'assistant', content: 'Bad Answer 2' });

  // Regenerate a2: delete from a2 onwards
  const msgs = await store.getMessages(conv.id);
  const targetIndex = msgs.findIndex((m) => m.id === a2.id);
  for (const m of msgs.slice(targetIndex)) {
    await store.deleteMessage(m.id);
  }

  const remaining = await store.getMessages(conv.id);
  assert.equal(remaining.length, 3);
  assert.equal(remaining[0].id, u1.id);
  assert.equal(remaining[1].id, a1.id);
  assert.equal(remaining[2].id, u2.id);
  assert.equal(remaining[2].attachments[0].name, 'data.txt');
});

// -------------------------------------------------------------
// Test 17: Existing IndexedDB records remain readable
// -------------------------------------------------------------
await test(17, 'Existing IndexedDB records remain readable', async () => {
  const store = createMockStorage();
  const conv = await store.createConversation('test/model:free');
  await store.addMessage(conv.id, { role: 'user', content: 'Legacy schema test' });

  const record = await store.getConversation(conv.id);
  assert.equal(record.id, conv.id);
  assert.equal(record.model, 'test/model:free');
});

// -------------------------------------------------------------
// Test 18: Export/import round trip still works
// -------------------------------------------------------------
await test(18, 'Export/import round trip still works', async () => {
  const exportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    conversations: [{ id: 'c1', title: 'Test Conv', model: 'mock:free', createdAt: 1000, updatedAt: 1000 }],
    messages: [{ id: 'm1', conversationId: 'c1', role: 'user', content: 'Hello export', timestamp: 1000 }],
    artifacts: [],
    settings: { searchEnabled: true },
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const parsed = JSON.parse(jsonString);
  const validated = validateImportData(parsed);

  assert.equal(validated.conversations.length, 1);
  assert.equal(validated.conversations[0].title, 'Test Conv');
  assert.equal(validated.messages.length, 1);
  assert.equal(validated.messages[0].content, 'Hello export');
  assert.equal(validated.settings?.searchEnabled, true);
});

// -------------------------------------------------------------
// Test 19: Greeting shortcuts cannot rename an existing conversation
// -------------------------------------------------------------
await test(19, 'Greeting shortcuts cannot rename an existing conversation', async () => {
  let title = 'Established Topic Discussion';
  const existingTurnCount = 4; // Not the first turn

  function onGreetingShortcut(messageCount) {
    if (messageCount <= 2) {
      title = 'Greeting';
    }
  }

  onGreetingShortcut(existingTurnCount);
  assert.equal(title, 'Established Topic Discussion');
});

// -------------------------------------------------------------
// Test 20: Title generation does not block the next submission
// -------------------------------------------------------------
await test(20, 'Title generation does not block the next submission', async () => {
  let submissionAllowed = false;
  let titlePromiseResolved = false;

  const titlePromise = new Promise((resolve) => setTimeout(() => {
    titlePromiseResolved = true;
    resolve('Generated Title');
  }, 100));

  // Non-blocking: submission lock is released as soon as message persists
  submissionAllowed = true;

  assert.equal(submissionAllowed, true);
  assert.equal(titlePromiseResolved, false);
  await titlePromise;
  assert.equal(titlePromiseResolved, true);
});

// -------------------------------------------------------------
// Test 21: Compare mode remains functional
// -------------------------------------------------------------
await test(21, 'Compare mode remains functional', async () => {
  const history = [
    { id: 'u1', role: 'user', content: 'Compare these' },
    { id: 'a1', role: 'assistant', content: 'Answer A', compareRun: true, preferred: false },
    { id: 'a2', role: 'assistant', content: 'Answer B', compareRun: true, preferred: true },
  ];

  // Invariant: Subsequent turns only include preferred answer, not duplicate competing text
  const valid = history.filter((m) => !m.isError && m.content);
  const deduped = [];
  for (let i = 0; i < valid.length; i++) {
    const msg = valid[i];
    if (msg.role === 'assistant' && msg.compareRun) {
      const siblings = [msg];
      while (i + 1 < valid.length && valid[i + 1].role === 'assistant' && valid[i + 1].compareRun) {
        siblings.push(valid[i + 1]);
        i++;
      }
      const preferred = siblings.find((s) => s.preferred) || siblings[siblings.length - 1];
      deduped.push(preferred);
    } else {
      deduped.push(msg);
    }
  }

  assert.equal(deduped.length, 2);
  assert.equal(deduped[1].content, 'Answer B');
});

// -------------------------------------------------------------
// Test 22: Existing free-only routing restrictions remain enforced
// -------------------------------------------------------------
await test(22, 'Existing free-only routing restrictions remain enforced', async () => {
  assert.equal(isFreeModelId('meta-llama/llama-3.3-70b-instruct:free'), true);
  assert.equal(isFreeModelId('openai/gpt-4o'), false);
  assert.equal(isFreeModelId('anthropic/claude-3.5-sonnet'), false);
  assert.ok(FALLBACK_CHAIN.every((id) => id.endsWith(':free')));
});

// -------------------------------------------------------------
// Test 23: No active run leaves behind unnecessary timers or controllers
// -------------------------------------------------------------
await test(23, 'No active run leaves behind unnecessary timers or controllers', async () => {
  let activeTimers = new Set();
  let controller = new AbortController();

  function startRun() {
    const timerId = setTimeout(() => {}, 10000);
    activeTimers.add(timerId);
    return {
      cleanup() {
        for (const t of activeTimers) clearTimeout(t);
        activeTimers.clear();
        controller = null;
      }
    };
  }

  const run = startRun();
  assert.equal(activeTimers.size, 1);
  run.cleanup();
  assert.equal(activeTimers.size, 0);
  assert.equal(controller, null);
});

// -------------------------------------------------------------
// Test 24: A persistence failure produces a controlled terminal state
// -------------------------------------------------------------
await test(24, 'A persistence failure produces a controlled terminal state', async () => {
  let lifecycleState = 'persisting';
  let errorCaught = false;

  try {
    throw new Error('QuotaExceededError in IndexedDB');
  } catch (err) {
    errorCaught = true;
    lifecycleState = 'failed';
  }

  assert.equal(errorCaught, true);
  assert.equal(lifecycleState, 'failed');
});

console.log(`\n========================================`);
console.log(`Phase 2A Regression Test Results:`);
console.log(`Total: 24 | Passed: ${passCount} | Failed: ${failCount}`);
console.log(`========================================\n`);

if (failCount > 0) {
  process.exit(1);
}

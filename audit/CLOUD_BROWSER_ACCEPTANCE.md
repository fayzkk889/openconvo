# Browser Acceptance

**Environment:** Claude desktop-app built-in browser (Chromium) → `next start -p 3100` (local production build of this branch). Not the Vercel Preview (not accessed). No provider keys: `/api/chat` was answered by a deterministic in-page SSE stream installed over `window.fetch`, matching real fetch abort semantics. `/api/search` was intercepted and recorded. Everything else (UI, React state, IndexedDB, PDF.js worker, routing logic) ran for real.

| Flow | Result | Observations |
|---|---|---|
| 1 First run | PASS | `/app` loads, no console errors; empty state, starters, settings open; live free catalog populated the model picker (default resolved to a listed model). |
| Test A routing + follow-up | PASS | 2 chat requests, **0** `/api/search` calls, task `quick`; follow-up request carried the earlier turns. Answer quality not verifiable without a model. |
| Test B outgoing search | PASS | `/api/search` body = `{query, mode:"research", model}` only — no conversation entities. |
| Test G / Flow 4 Stop | PASS | Clicked the real Stop button at word 71 → generation halted; IndexedDB last message `interrupted / cancelled`, 72 words = on-screen text; notice shown; after refresh identical text and notice; Stop button cleared. |
| Flow 8 Regeneration | PASS | Provider error → previous answer kept in IndexedDB and on screen, error banner shown. Mid-stream drop → kept, "previous answer was kept" message. Success → replaced atomically (message count unchanged, `complete`). Request history ended on the user turn and excluded the old answer in all three. |
| Flow 5 File intake | PARTIAL | Paperclip `<input type=file>` path driven via `DataTransfer` + `change` (synthetic event, real handler): PDF parsed, chip "3p"; duplicate rejected; PNG rejected; fake PDF → "Corrupted or invalid PDF header". **Real OS drag-drop and clipboard paste were not exercised.** |
| Flow 6 PDF retrieval | PASS | Worker loaded from local `/api/pdf-worker?v=4.10.38`; IndexedDB 1 document (3 pages, ready) + 3 page-numbered chunks; request excerpt `D1:p3` containing Lina Patel; request size 1.7 KB; after refresh a follow-up retrieved `D1:p2` (OAK-2206) first; "Document Evidence" panel present. |
| Flow 9 Export / import | PASS | Synthetic BYOK keys set in settings → export contained no `sk-or-`/`tvly-` strings; settings export limited to non-secret fields. Wiped IndexedDB + localStorage, imported → 2 conversations, 11 messages, 1 document, 3 chunks restored. Download was intercepted in-page; no file saved. |
| Flow 2 Delete | PASS | Deleting the PDF conversation removed its documents and chunks; 0 orphaned messages. |
| Flow 10 Responsive | PASS after fix | 375 px: no horizontal overflow. Defect found and fixed: scroll-to-bottom button over the composer; error banner over message actions (desktop). |

## Not verified in a browser
Real provider streaming/latency, Tavily/keyless search results and source panels, OS-level drag-drop and clipboard, IME composition, Test I model behaviour, keyboard-only navigation audit, Safari/Firefox, the deployed Preview.

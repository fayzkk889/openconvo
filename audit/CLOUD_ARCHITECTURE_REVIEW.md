# Architecture Review (verified against source at 6186ec7 + RC-3 changes)

Next.js 15.5 App Router, React 19, TypeScript. Persistence is browser-only IndexedDB (`idb`, DB `openconvo` v5). Server is stateless except for per-instance in-memory maps (quotas, model cooldowns, search/page caches).

## Chat request lifecycle
```
Composer (Enter/Send) → app-shell.onSendMessage (auto-route model pick)
 → useChat.sendMessage
    1. execution lock (activeRunRef; one run at a time)          [use-chat.ts]
    2. resolveWorkflow(content, attachments, toggles)            [lib/tasks.ts]  regex intent policy
    3. storage.addMessage(user)  → saveDocument(record, chunks)  [lib/storage.ts]
    4. document retrieval (BM25-style) over conversation chunks  [lib/document-retrieval.ts]
    5. optional POST /api/search (mode search|research|deep)     [app/api/search/route.ts]
    6. POST /api/chat  (history, model, availableModels, excerpts, wire attachments)
 → /api/chat: validate (2 MB cap, free-id only) → hosted quota reserve (BYOK bypass)
    → candidates = selectCandidateModels([model, ...availableModels, ...FALLBACK_CHAIN], liveCatalog)
    → ≤3 attempts, 52 s deadline, 10 s connect, 15 s idle; zero max_price provider routing
    → upstream SSE parsed by SseChunkParser → typed events: meta|delta|fallback|complete|interrupted|error|research_fallback
    → fallback only before first content; after content an upstream failure is `interrupted`
 → client consumeChatStream → streaming display → persist assistant message with status/finishReason
```

## Search lifecycle
`/api/search` → hosted search quota (bypassed by client Tavily key) → heuristic plan (`research-planner.ts`) → initial search → model planner (OpenRouter, only when the visitor has an OpenRouter key or the request is metered — RC-3) → `searchWebMany` across Tavily → SearxNG → DuckDuckGo/Bing HTML (+ seeded sources as fallback) → `rankSearchResults` (`source-quality.ts`) → `enrichSearchResults` page extraction with SSRF checks (`web-extract.ts`, manual redirects, DNS validation, size limits).

## File intake
Paperclip input, drop, and paste all call `composer.processFiles` → `parseFile` (`file-parser.ts`): 10 MB cap, image rejection, PDF via `pdfjs-dist/legacy` with the worker served from `/api/pdf-worker` (no CDN), 100-page / 500k-char caps with warnings, scanned-PDF warning (no OCR) → `chunkDocument` (page-aware) → chips. On send: document record + chunks saved to IndexedDB with the conversation id; retrieval produces `D1:p3`-style excerpts sent to the model; citations appended server-side if missing.

## Data model (IndexedDB v5)
`projects`, `conversations` (by-project), `messages` (by-conversation), `artifacts`, `modelReliability`, `documents` (by-conversation/fingerprint), `documentChunks` (by-document/by-conversation). Conversation delete removes messages, artifacts, documents and chunks in one transaction (browser-verified). Regeneration replaces messages in one transaction. Export/import covers all stores; settings export excludes API keys (browser-verified).

## Failure boundaries (where it can break)
| Boundary | Behaviour |
|---|---|
| Model catalog stale | Was: dead default + dead fallback chain. Now: live catalog filters candidates (cached 5 min, 3 s budget, falls back to configured list). |
| Upstream EOF mid-stream | `interrupted`, partial kept, no model splice (tested server + client). |
| Client Stop | fetch abort → AbortError → partial persisted `interrupted/cancelled` (browser-verified). |
| Regeneration failure | Previous answer kept unless the new one is `complete` (RC-3, browser-verified). |
| Quotas | Per-instance `Map`; not shared across serverless instances (open blocker). |

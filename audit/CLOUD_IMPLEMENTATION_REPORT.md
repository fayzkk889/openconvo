# Implementation Report

Net diff: 13 modified files (+230 / −184) and 3 new library modules, plus tests and fixtures. No new dependencies. No IndexedDB schema change. Free-only routing unchanged (`max_price` 0, `:free` ids only).

| File | Change | Defects |
|---|---|---|
| `src/lib/request-identity.ts` (new) | Single trusted quota identity (`x-forwarded-for`) | D-01 |
| `src/app/api/chat/route.ts` | Shared identity; live-catalog candidate selection; stop fallback loop on client abort | D-01, D-03, D-16 |
| `src/app/api/search/route.ts` | Shared identity; model planner only for metered or BYOK-OpenRouter requests | D-01, D-02 |
| `src/lib/models.ts` | Curated list refreshed to listed free models; `selectCandidateModels` | D-03 |
| `src/lib/openrouter.ts` | `getLiveFreeModelIds` (5 min cache, 60 s negative cache, 3 s budget); `fetchModels` reuses it; `sanitizeProviderMessage` | D-03, D-15 |
| `src/lib/chat-history.ts` (new) | `buildApiMessages` moved here; `historyBeforeMessage`, `shouldReplaceOnRegenerate`, `toWireAttachments` | D-04, D-05, D-09 |
| `src/hooks/use-chat.ts` | Uses the helpers; regeneration keeps the old answer unless complete; minimized search context; stopped partial keeps start timestamp | D-04, D-05, D-08, D-09, D-14 |
| `src/lib/message-status.ts` (new), `src/components/message.tsx` | Visible notice for stopped / interrupted / truncated / fallback answers | D-06 |
| `src/lib/tasks.ts` | "research" as a noun modifier is not a search trigger | D-07 |
| `src/lib/research-planner.ts` | `needsConversationContext` (same rule the server applies) | D-08 |
| `src/components/chat-area.tsx` | Composer overlay measured; list padding and scroll button follow it | D-10 |
| `src/lib/export.ts` | Preserve historical message model ids on import | D-11 |
| `src/components/composer.tsx` | IME-safe Enter; pending-parse counter; fresh duplicate check | D-12, D-13 |
| `src/lib/storage.ts` | `addMessage` accepts an optional timestamp | D-14 |
| `scripts/rc3-audit-tests.mjs`, `scripts/lib/synthetic-pdf.mjs` | 24 behavioral tests; wired into `npm test` | — |
| `audit/fixtures/*` | Synthetic 3-page Aurora PDF (real bytes) and prompt-injection memo | — |
| `.claude/launch.json` | Local `next start -p 3100` config used for browser QA (dev tooling only) | — |

## Design notes
- **Why filter against the live catalog instead of only refreshing the list:** free variants are retired continually; a refreshed list goes stale again. The filter costs one cached public request per instance every 5 minutes and degrades to the configured list if the catalog is unreachable.
- **Why regeneration restores rather than saves the partial:** the invariant "a failed regeneration must not destroy the only good answer" is cheaper and clearer to guarantee than keeping two competing answers. The user sees why it was kept.
- **Not done on purpose:** shared quota storage (new infrastructure; see O-01), removing duplicated chunks from stored messages (needs a migration; O-03).

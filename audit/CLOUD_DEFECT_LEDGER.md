# Defect Ledger

"Baseline" = RC-2.2 `6186ec7` run in a throwaway worktree with the RC-3 tests. "Browser" = desktop-app Chromium against local `next start` with a deterministic in-page `/api/chat` stream (no live provider).

## Confirmed and fixed

| ID | Sev | Defect | Root cause | Evidence | Fix | Verification |
|---|---|---|---|---|---|---|
| D-01 | P1 | Hosted chat and search quotas bypassable by rotating a request header | `getUsageIdentity` preferred client-controlled `cf-connecting-ip`, then `x-real-ip` | Route test: 2nd request with new `cf-connecting-ip` → **200 at baseline** (expected 429) | Shared `request-identity.ts`; trust only `x-forwarded-for` (Vercel-overwritten) | RC-3 test passes; fails at baseline |
| D-02 | P1 | Any `x-tavily-key` value made search unmetered while the model planner still spent the **hosted** OpenRouter key | Metering keyed only on Tavily key; planner used server key whenever the visitor had none | Route test: planner called hosted OpenRouter at baseline | Planner runs on the hosted key only for metered requests | RC-3 test + positive control |
| D-03 | P1 | Every curated model, the default, and the whole fallback chain had been retired from OpenRouter | Static ids; no reconciliation with the live catalog | Live catalog 2026-11-23: 0/7 listed. Route test with stale config → **error at baseline** after 3 × 404 | Curated list refreshed to 4 listed free ids; `selectCandidateModels` drops unlisted ids and appends live ones | RC-3 test; browser shows live default "Gemma 4 31B" |
| D-04 | P1 | Regeneration sent the answer being replaced (and any later turns) back to the model; request ended on an assistant turn | `buildApiMessages(storage.getMessages(...))` with no truncation at the target | Code trace; browser capture after fix shows last role `user`, old answer absent | `historyBeforeMessage` | Unit test + browser |
| D-05 | P1 | A failed, interrupted, or degraded regeneration permanently replaced the previous good answer | `replaceMessagesTransactional` ran for any non-`failed` status; client research fallback also replaced | Code trace | Replace only on `complete`; otherwise restore and explain | Browser: error and mid-stream drop both keep the original in IndexedDB; success replaces atomically |
| D-06 | P2 | Interrupted, truncated (`finish_reason: length`), and fallback answers looked identical to complete ones | Status persisted but never rendered | No component read `status`/`finishReason` | `messageStatusNotice` rendered under the answer | Unit test; browser shows "Stopped before the answer finished." before and after refresh |
| D-07 | P2 | "research plan / research questions" requests triggered web search | `\bresearch\b` keyword trigger | Baseline routing test fails on "Design a research plan for my thesis…" | Noun-phrase uses of "research" excluded from the trigger | RC-3 routing test (Tests A–D + variants) |
| D-08 | P2 | Earlier conversation entities sent to `/api/search` on every search | Client always attached `contextEntities`; server-side gate only | Code trace | Client sends them only when `needsConversationContext(query)` | Unit test; browser `/api/search` body has no entities for Test B |
| D-09 | P2 | Full parsed document (all chunks + record) uploaded to `/api/chat` on every send/regenerate; server discards it | Attachment objects sent as-is | Code trace | `toWireAttachments` strips local-only fields | Browser request 1.7 KB with PDF attached |
| D-10 | P2 | Error banner / research progress covered the last message's actions and status; mobile "scroll to bottom" button sat on the composer input | Fixed `pb-44` / `bottom-36` vs. dynamic composer overlay | Browser screenshot | Composer height measured with `ResizeObserver`; list padding and button follow it | Browser: banner top 492 px vs actions bottom 445 px |
| D-11 | P2 | Import relabeled historical answers to the current default model | `validateMessage` passed `message.model` through `resolveSafeModelId` | Unit test | Keep historical free ids; drop non-free | RC-3 test |
| D-12 | P2 | Enter during IME composition sent half-composed text | No `isComposing` check | Code | Check `nativeEvent.isComposing` | Code-level only (no IME in automation) |
| D-13 | P2 | Overlapping file parses re-enabled Send while a parse was still running; duplicate check used a stale closure | Boolean flag cleared by whichever batch finished first | Code | Pending-parse counter + attachments ref | Code-level; sequential duplicate/invalid paths browser-verified |
| D-14 | P3 | Stopped answer could sort after an immediately-sent next user message | Partial persisted with `Date.now()` at catch time | Code | Persist with the placeholder's start timestamp | Code-level |
| D-15 | P3 | Non-429 provider messages shown nearly raw (only `sk-` redacted) | Minimal redaction | Unit test | `sanitizeProviderMessage`: drop JSON tails, bearer/key patterns, 160-char cap | RC-3 test |
| D-16 | P3 | After a client disconnect the route kept iterating candidates (no upstream calls, but false failure bookkeeping) | No abort check in fallback loop | Baseline test already passed | Break on `request.signal.aborted` | Regression guard |

## Open (not fixed here)

| ID | Sev | Issue | Why not fixed |
|---|---|---|---|
| O-01 | **P1 (launch)** | Hosted quotas are per-instance `Map`s: reset on cold start, not shared across instances, and the shared OpenRouter key is itself capped at 50 (or 1,000) free requests/day including failures | Needs a shared atomic store (e.g. Upstash/Vercel KV) — new infrastructure needs owner approval |
| O-02 | P2 | Hosted search default limit is 15 in code but 5 in `.env.example` | Product decision; set the env var explicitly in Vercel |
| O-03 | P2 | User messages store full `chunks` in `attachments`, duplicating `documentChunks` (bloats IndexedDB and exports) | Changing stored shape needs a migration; left for a compatible cleanup |
| O-04 | P2 | Document follow-ups that use retrieval are labeled task `quick` | Metadata only |
| O-05 | P2 | Heuristic planner rewrites "Next.js" as "Next" in queries | Search-quality tuning; model planner usually supersedes it |
| O-06 | P3 | SSRF check validates DNS then `fetch` resolves again (rebinding window) | Low exposure: URLs come from search providers, not users |
| O-07 | P3 | `COMMON_TECH_NAMES` contains fixture names (`polaris labs`, `route handlers`) | Test-overfitting smell; harmless |
| O-08 | P3 | Keyless DDG/Bing scraping reachable without quota via any `x-tavily-key` | No operator cost after D-02; abuse/IP-reputation risk only |

## Disproved / not defects
- **Test F (server EOF)** and **Test E (429 redaction)** were already correct at baseline; new route-level tests now guard them.
- **Stop not persisting** (first browser run): my mock did not error the body on abort as real `fetch` does. Corrected mock → Stop persists correctly.
- **Model attribution mismatch** seen in a low-res screenshot: DOM shows matching name and id.
- **Test B contamination**: planner strips "unrelated to Polaris Labs"; probe ranks route.com General (48), GitHub `caribou/polaris` Weak (23), bereavement `.edu` PDF Weak (26), Next.js docs Strong. **Test C**: all copper/finch look-alikes Weak.

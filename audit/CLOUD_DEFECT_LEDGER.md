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
| O-01 | Mitigated | Hosted quotas are per-instance `Map`s: reset on cold start, not shared across instances, and the shared OpenRouter key is itself capped at 50 (or 1,000) free requests/day including failures | **Resolved for launch by configuration:** public deployments are BYOK-only (`hosted-mode.ts`); shared capacity only on SSO-protected Previews or with explicit `OPENCONVO_HOSTED_FREE=on`. A shared atomic store is still needed before hosted-free can go public. |
| O-02 | P2 | Hosted search default limit is 15 in code but 5 in `.env.example` | Product decision; set the env var explicitly in Vercel |
| O-03 | P2 | User messages store full `chunks` in `attachments`, duplicating `documentChunks` (bloats IndexedDB and exports) | Changing stored shape needs a migration; left for a compatible cleanup |
| O-04 | P2 | Document follow-ups that use retrieval are labeled task `quick` | Metadata only |
| O-05 | P2 | Heuristic planner rewrites "Next.js" as "Next" in queries | Search-quality tuning; model planner usually supersedes it |
| O-06 | P3 | SSRF check validates DNS then `fetch` resolves again (rebinding window) | Low exposure: URLs come from search providers, not users |
| O-07 | P3 | `COMMON_TECH_NAMES` contains fixture names (`polaris labs`, `route handlers`) | Test-overfitting smell; harmless |
| O-08 | Mitigated | Keyless DDG/Bing scraping reachable without quota via any `x-tavily-key` | BYOK-only mode returns 401 to visitors with no key of their own; a visitor-supplied key (even invalid) still reaches keyless scraping, rate-limited per instance. |

## Disproved / not defects
- **Test F (server EOF)** and **Test E (429 redaction)** were already correct at baseline; new route-level tests now guard them.
- **Stop not persisting** (first browser run): my mock did not error the body on abort as real `fetch` does. Corrected mock → Stop persists correctly.
- **Model attribution mismatch** seen in a low-res screenshot: DOM shows matching name and id.
- **Test B contamination**: planner strips "unrelated to Polaris Labs"; probe ranks route.com General (48), GitHub `caribou/polaris` Weak (23), bereavement `.edu` PDF Weak (26), Next.js docs Strong. **Test C**: all copper/finch look-alikes Weak.

## Session 2 additions
| ID | Sev | Change | Verification |
|---|---|---|---|
| D-17 | P1 | Production (`77862a9`) lends the server OpenRouter/Tavily keys to anyone under per-instance quotas. Public deployments now default to BYOK-only; UI explains why. | RC-3 tests: server keys never used for keyless visitors; config reports hosted off; BYOK unaffected. Browser: BYOK notice shown. |
| D-18 | P2 | No Content-Security-Policy; markdown rendered remote images (prompt-injection exfiltration channel). CSP added. | Browser: header served, no violations on `/` and `/app`, fonts load, PDF worker parses; a cross-origin fetch is blocked. |

## RC-4 (branch `feat/rc-4-followups`, PR #2)
| ID | Was | Change | Verification |
|---|---|---|---|
| O-01 | Mitigated | Shared atomic quota store: `src/lib/hosted-quota.ts` counts per-visitor and deployment-wide daily caps with one `INCRBY` per check in Upstash Redis REST / Vercel KV (memory fallback). Visitor IPs are HMAC'd with the store token. An unreachable store refuses keyless requests (503), never BYOK. `OPENCONVO_HOSTED_FREE=on` on Vercel production now requires the store. | RC-4 tests: fake atomic REST server, 40 concurrent reservations vs limit 10 admit exactly 10; 25 visitors vs global 7 admit 7; store down → 503 for keyless, BYOK untouched; refund on failure (mutation-checked). **Not verified against a live Upstash/KV database**: none is provisioned. |
| O-02 | P2 | `.env.example`/README now document hosted search default 15 (matches code), plus the new global caps. | Docs diff. |
| O-08 | Mitigated | Unchanged, plus: in BYOK-only mode keyless search keeps the per-visitor limit and no deployment-wide cap, so BYOK users cannot exhaust each other. | RC-4 route test. |
| D-19 | P2 | Tavily-less search on Vercel: DuckDuckGo 403. Added Wikipedia API provider (after DDG/Bing) with a term-overlap filter against its loose matches. | RC-4 parser + provider tests (DDG/Bing 403 → Wikipedia result). Live check on the Preview recorded in CLOUD_RELEASE_READINESS. |
| D-20 | P2 | No browser e2e suite. Added Playwright (`npm run test:e2e`, 9 tests, synthetic in-browser API). | 9/9; removing the IME guard or the regenerate-complete guard makes the matching test fail. |
| D-21 | P3 | README/DEPLOYMENT/.env.example still described pre-RC-3 public hosted mode. Rewritten. | Docs diff; `check:env` validates the new variables. |
## RC-5 (branch `feat/model-driven-search`)
| ID | Was | Change | Verification |
|---|---|---|---|
| D-22 | P1 | Search was decided by ~40 keyword regexes (`needsWebResearch`) and queries by a template planner: "rumour about google india layoffs" got no search, "whats with those layoffs" searched "whats ..." and returned five WhatsApp pages, "today" forced research for a date question. Replaced by tool calling: the chat route offers `web_search(query, kind)` and `read_page(url)`; the model decides whether to search, writes the query from the conversation, and may search again. Bounded rounds (BYOK 3, Deep 4, hosted 1), `tool_choice: auto`, tools dropped when an endpoint rejects them, evidence carried across model fallbacks, last round answers from sources in the prompt. | RC-5 route tests with mocked OpenRouter: tool loop, no-search path, tool-rejecting endpoint, round bound, hosted bound + search quota, cross-model handoff, all-fail fallback, abort mid-search. |
| D-23 | P1 | Search depended on Tavily for usable results (DuckDuckGo 403 from Vercel). New keyless sources queried in parallel: Bing and DuckDuckGo result pages, Bing News and Google News RSS (news kind), Wikipedia. Tavily/SearxNG are optional extras. | RC-5 parser/provider tests; live run (below). |
| D-24 | P2 | No relevance check: irrelevant results reached the model and the UI. `isRelevantResult` requires the query's significant terms (stem match) before a result is kept. | RC-5 test with the WhatsApp case; mutation (gate disabled) fails 2 tests. |
| D-25 | P2 | Hard-coded "Hey! How can I help?" reply for greetings. Removed; greetings go to the model. | e2e test. |
| D-26 | P2 | Page reading off by default (DNS-rebinding TOCTOU). Now on: `pinnedTransport` connects through `safeLookup`, which rejects the connection when any resolved address is private, so the checked address is the connected address; redirects revalidated per hop; `read_page` only accepts URLs a search in the same answer returned. `OPENCONVO_ENABLE_PAGE_EXTRACTION=false` disables. | RC-5 tests (lookup refuses localhost, redirect to 169.254.169.254 never requested, foreign URL refused; mutation removing the URL check fails). |
| D-27 | P3 | Keyword source-quality scores labelled good news coverage "Weak 35" ("missing primary subject"). Tool sources no longer carry the heuristic label. | Probe recorded in session notes; RC-5 fallback test. |
| D-28 | P3 | HTML numeric entities (`&#x27;`) shown in titles; news not newest-first. Fixed. | Live run. |

# Test Results

## Final gates (branch `audit/rc-3-cloud`, working tree, 2026-11-23)

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | clean |
| `npm test` | 0 | 137 launch checks; Phase 2A 24/24, 2B 43/43, 3 30/30, 4 40/40 + 16/16 eval, 5 30/30, RC-2 27/27, **RC-3 24/24** |
| `npm run build` | 0 | `/app` 185 kB, routes compiled |
| `npm audit` | 0 | 0 vulnerabilities (dependency advisories only; not an application security result) |
| `git diff --check` | 0 | clean |
| Secret scan of diff | — | no real-looking `sk-or-v1-…` / `tvly-…` values (only `SYNTHETIC…` fixtures) |

Baseline at `6186ec7`: typecheck 0, `npm test` 0 (137 + 210), build 0.

## Red → green evidence (RC-3 tests run against the RC-2.2 baseline)
Failed at baseline for the expected reason, pass now: quota spoofing (D-01), hosted planner spend (D-02), stale model ids (D-03), research-plan routing (D-07). Passed at baseline (regression guards): Test F server EOF, Test E 429 redaction, abort stops upstream attempts, Test H retrieval.

## What the RC-3 suite exercises
- **Real route handlers** `POST /api/chat` and `POST /api/search` with mocked upstream HTTP: completion, EOF without `[DONE]`, UTF-8 split across chunks, empty-model fallback, stale-model catalog, client abort, quota spoofing, planner spend, 429 redaction.
- **Real PDF bytes** through `pdfjs-dist` in Node: 3-page synthetic Aurora PDF → page-accurate chunks → retrieval returns `D1:p3` with Lina Patel and the *target* release date; corrupt and non-PDF inputs fail explicitly.
- **Pure logic** used by the hook: regeneration history, replace-only-on-complete, wire attachments, status notices, routing A–D, data minimization, import attribution.

## Coverage audit (honest)
- 137 of the pre-existing "checks" are regex assertions on source text; they prove presence of code, not behaviour.
- Before RC-3, no test executed `/api/chat` or `/api/search`; `useChat` (the most complex module) has no automated test — its behaviour is covered only by the browser runs below.
- Phase 5 test 4 ("password-protected PDF") assigns the expected error message itself and is tautological.
- `scripts/rc21-reproduction-verify.mjs` exists but is not run by `npm test`.
- Not covered anywhere: real providers, real Tavily/DDG, real OS drag-drop/clipboard, IME, multi-tab IndexedDB contention.

## Session 2 (commit `41184c2`)
typecheck 0, `npm test` 0 (RC-3 suite 26/26, adds hosted-mode policy and BYOK-only server-key tests), build 0. Branch pushed; PR https://github.com/fayzkk889/openconvo/pull/1.

## RC-4 (PR #2)
- `npm test`: launch checks 137, RC-3 26/26, RC-4 15/15 (quota store, routes, Wikipedia).
- `npm run test:e2e` (Playwright 1.65, installed Chrome, `next start`): 9/9. streaming + reload persistence; Stop keeps exactly the streamed partial across reload; interrupted label; regenerate keeps the old answer on HTTP error and on an interrupted stream, replaces it on complete; Enter during a real Chrome IME composition (CDP `Input.imeSetComposition`, `isComposing` asserted true) does not send; file chooser PDF parsed in-browser with only excerpts on the wire; native CDP `Input.dispatchDragEvent` drop of a real file path; file paste via synthetic ClipboardEvent; Enter during PDF parsing never sends without the file.
- Mutation evidence: removing `!e.nativeEvent.isComposing` fails the IME test; forcing `shouldReplaceOnRegenerate` true fails the regenerate test; making the chat route skip the quota refund fails the RC-4 refund test.
- Still not covered by automation: OS file-manager drag, the real system clipboard, a live Redis store.
## RC-5 (model-driven search)
- `npm test`: launch checks 141 (6 old-design checks replaced, 4 added), RC-3 26/26, RC-4 15/15, RC-5 17/17. `tsc` and `next build` pass.
- `npx playwright test`: 11/11 (adds: model-initiated search shows a live status line, numbered sources and the trace, persisted after reload, with `webSearch: "auto"` and no pre-search on the wire; a greeting reaches the model).
- Mutation evidence: disabling the read_page URL restriction fails the read_page test; disabling the relevance gate fails the tool-loop and web-search tests.
- Live keyless search from a residential connection (no key, 2026-11-24): "Google India layoffs" (news) → Business Standard, MSN, Economic Times, Google News items on the 30-role Google Cloud cut, 0.4-0.8 s; "React server components" (web) → react.dev first; DuckDuckGo answered here (Vercel gets 403). `read_page` on react.dev read 5000 chars through the pinned connection in ~0.4 s.
- Not proven by these tests: how well each free model chooses to call the tools. That needs the live Preview run.

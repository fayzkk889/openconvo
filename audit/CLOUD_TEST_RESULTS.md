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

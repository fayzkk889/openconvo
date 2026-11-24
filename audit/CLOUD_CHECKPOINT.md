# RC-3 Audit Checkpoint

- **Branch:** `audit/rc-3-cloud` (created from `preview/rc-2.2` @ `6186ec7`)
- **State:** all changes uncommitted in the working tree. Nothing pushed, merged, or deployed. `main` untouched.
- **Environment actually used:** Windows 11 workstation (not a cloud sandbox), Node 22.23.4, Git, desktop-app built-in browser (Chromium) against `next start` on `localhost:3100`. No Playwright in the repo. No OpenRouter/Tavily keys present. The protected Vercel Preview was **not accessed**.

## Stage status

| Stage | Status |
|---|---|
| 0 Discovery / baseline | Done. Baseline typecheck 0, `npm test` 0 (137 static + 210 behavioral), build 0. |
| 1 Architecture | Done — `CLOUD_ARCHITECTURE_REVIEW.md` |
| 2 Research | Done (targeted) — `CLOUD_RESEARCH_NOTES.md` |
| 3–4 Defect discovery / regression cases A–J | Done — `CLOUD_DEFECT_LEDGER.md` |
| 5 Browser E2E (local prod build) | Done for flows listed in `CLOUD_BROWSER_ACCEPTANCE.md` |
| 6–11 Routing, research, docs, concurrency, security, quota | Reviewed; findings in ledger / security review |
| 12–14 Fixes, tests, gates | Done — final gates all exit 0 |
| 15 Readiness | `CLOUD_RELEASE_READINESS.md` — **READY FOR PREVIEW VALIDATION** |

## Remaining release blockers
1. Hosted-free quota is per-instance memory and the shared OpenRouter key is capped by OpenRouter itself (O-01).
2. No real-provider verification has been run on this branch (no key available here).

## Next exact action
Review the diff, then commit on `audit/rc-3-cloud` and deploy to a Preview with a BYOK key to run the real-provider smoke list in `CLOUD_RELEASE_READINESS.md`.

## Session 2 (2026-11-23) — commit after 300549e
- Launch mode decided: **BYOK-only for public deployments** (`src/lib/hosted-mode.ts`). Server keys are lent only with `OPENCONVO_HOSTED_FREE=on` or on SSO-protected Vercel Previews. `/api/search` returns 401 for keyless visitors when hosted mode is off. UI explains BYOK-only.
- Production today (`77862a9`, June) still has hosted-free publicly on with per-instance quotas; this branch fixes that once released.
- Added CSP (`next.config.ts`): `connect-src 'self'`, `img-src 'self' data: blob:` (blocks markdown-image exfiltration), Google Fonts allowed.
- RC-3 suite 26/26; typecheck, `npm test`, build all exit 0.
- **Not yet done:** CSP not checked in a browser for violations; Playwright e2e suite not written (install reverted); branch not pushed; no Preview deployed; no live-provider smoke test; no production release.
- **Next exact action:** run the app locally and check the console for CSP violations → push `audit/rc-3-cloud` → open the Vercel Preview (SSO) → minimal live smoke test using hosted mode on Preview → production only if all conditions in CLOUD_RELEASE_READINESS.md hold.

## Session 3 (2026-11-23) — released
- Preview `openconvo-git-audit-rc-3-cloud-tanashahh.vercel.app` verified live (real OpenRouter + Tavily via Preview hosted mode): Tests A, B, H, I, real 429 fallback, Stop + refresh, and a coding prompt on the exact release commit `f4299ec`.
- Fixed from Preview: CSP blocked Vercel's Preview toolbar (Preview-only allowance added); duplicate model label for models outside the curated list.
- PR https://github.com/fayzkk889/openconvo/pull/1 merged as `c21e9fd` on `main`; Vercel production deployment completed (https://vercel.com/tanashahh/openconvo/6FDTCpRPx9HRH1jaNBRcpYq3QKhA).
- Production smoke (no provider spend): `/api/config` hosted off; keyless `/api/chat` and `/api/search` → 401 with guidance; strict CSP; 12 `:free` models; PDF worker 200; `/app` loads with BYOK notice and no console errors.
- Pre-release production was `77862a9`. Rollback: Vercel Instant Rollback to that deployment, or `git revert -m 1 c21e9fd` on `main`.
- Open follow-ups (not blockers): shared atomic quota store before hosted-free can be public; Tavily-less BYOK search quality on Vercel (DuckDuckGo 403); Playwright e2e suite; real OS drag-drop/paste/IME coverage; a live BYOK call with a real visitor key.

## Session 4 (2026-11-24): RC-4 follow-ups
- Branch `feat/rc-4-followups`, PR https://github.com/fayzkk889/openconvo/pull/2.
- Done: shared atomic quota store (O-01), Wikipedia keyless search (D-19), Playwright e2e suite with Chrome IME composition, native CDP file drag-drop and synthetic paste (D-20), docs/`check:env` refresh (D-21).
- Gates: `npm test` (137 checks, RC-3 26/26, RC-4 15/15), `tsc`, `next build`, `npm run test:e2e` 9/9.
- Still open: a live Upstash/Vercel KV store (account decision; production stays BYOK-only until one is configured); a live BYOK call with a real visitor key (needs the owner's own key, which an agent must not enter); a true OS-level drag from the file manager and real clipboard paste (automation uses the browser drag pipeline and synthetic ClipboardEvent).
- Released: PR #2 merged as `754c54a`; Vercel production deployment succeeded. Pre-release production was `3a9a597` (rollback: Vercel Instant Rollback, or `git revert -m 1 754c54a`).
- Production smoke (no provider spend): `/api/config` hosted off; keyless chat and search 401 with guidance; strict CSP without the Preview-only vercel.live allowance; PDF worker 200; `/app` loads; only console errors are the two deliberate 401 probes.
- Merged branches `audit/rc-3-cloud` and `feat/rc-4-followups` deleted.
## Session 5 (2026-11-24): model-driven search
- Branch `feat/model-driven-search`. The user found live answers poor (no search for a layoff-rumour question, WhatsApp results for a follow-up) and asked for search without Tavily and without hard-coded routing.
- Done: tool-calling loop in `/api/chat` (`web_search`, `read_page`), keyless parallel sources incl. news feeds, relevance gate, pinned page fetch, client no longer pre-searches or answers greetings itself, live status line and sources from tool events, docs and privacy/security text.
- Gates: see CLOUD_TEST_RESULTS RC-5.
- Caveat recorded in DEPLOYMENT.md: news RSS feeds and result-page scraping are not official APIs (their terms limit feed use to personal readers); `OPENCONVO_NEWS_FEEDS=off` disables the feeds.
- Live Preview fixes before release: a rate-limited model family is skipped instead of giving up (`2ba92fa`); pre-search narration is withdrawn and Google News chips show publisher domains (`af97f21`); every cited source is listed in the appendix (`b1bd3da`). Final gates: `npm test` (141 checks, RC-3 26/26, RC-4 15/15, RC-5 20/20), `tsc`, `next build`, Playwright 11/11.
- Released: PR #3 merged as `f44f7ea`; Vercel production deployment succeeded. Pre-release production was `d0a52b9` (rollback: Vercel Instant Rollback, or `git revert -m 1 f44f7ea`).
- Production smoke (no provider spend): `/api/config` hosted off (BYOK-only, unchanged); keyless chat 401 with guidance; `/app` 200; privacy and security pages serve the new search and page-pinning text.
- Open: live behaviour of small free models with tools; answers on the slowest models (Nemotron Ultra) can approach the 60 s function limit when they search.

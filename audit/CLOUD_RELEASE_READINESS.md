# Release Readiness — RC-3 audit

## Verdict: **READY FOR PREVIEW VALIDATION** (not production)

The ordinary BYOK workflow is now in good shape at the application level, with browser evidence for Stop, regeneration, persistence, documents, export/import, and deletion. Two things stop a broad launch: hosted-free mode cannot be enforced or funded at public scale, and nothing on this branch has been run against a live provider yet.

## Dimensions

| # | Dimension | Rating | Basis |
|---|---|---|---|
| 1 | Functional correctness | PARTIAL | Core flows pass in the browser with a deterministic stream; live provider not run |
| 2 | Conversation reliability | PASS | Persistence, refresh, ordering, delete cleanup verified |
| 3 | Model routing | PARTIAL | Stale catalog fixed; model quality of the new free set not measured |
| 4 | SSE lifecycle | PASS | Route + client tests (EOF, UTF-8 split, fallback-before-content, abort); browser Stop |
| 5 | Search relevance | PARTIAL | Ranking probes OK for historical cases; no live search run |
| 6 | Citation trustworthiness | PARTIAL | Document citations verified; web citations not exercised live |
| 7 | Document intelligence | PASS | Real PDF bytes → page-accurate retrieval in Node and browser |
| 8 | IndexedDB integrity | PASS | Interrupted/regenerated/imported/deleted states inspected directly |
| 9 | File ingestion UX | PARTIAL | Paperclip path verified; OS drag-drop/paste not verified |
| 10 | Cancellation & recovery | PASS | Stop and failed regeneration preserve content (browser) |
| 11 | Security & privacy | PARTIAL | Quota spoofing and data minimization fixed; no CSP; quota store open |
| 12 | Hosted-free quota reliability | **FAIL** | Per-instance memory; shared key capped at 50 (or 1,000) req/day by OpenRouter |
| 13 | Browser compatibility | NOT VERIFIED | Chromium only |
| 14 | Accessibility | PARTIAL | Status notices use `role="status"`; no full keyboard/screen-reader audit |
| 15 | Observability | PARTIAL | `console.error` only; no error reporting or quota metrics |
| 16 | Deployment & rollback safety | PASS | Branch-only change, no schema migration, Preview-first |

## Blockers
- **P1 — Hosted-free (O-01).** Launch BYOK-only, or keep hosted-free behind restricted access (Vercel protection or allowlist), until quotas move to a shared atomic store and the hosted key's daily cap is sized for expected traffic.
- **P1 — Unverified live inference.** Run the smoke list below on a Preview before any promotion.

## Pre-launch checklist
1. Review and commit `audit/rc-3-cloud`; deploy to a Vercel Preview (not production).
2. With a BYOK key on the Preview, run once each: Tests A–D, Test B with live search (check source panel and citations), Test C absence answer, Test H with `audit/fixtures/aurora-synthetic.pdf`, Test I with `audit/fixtures/injection-memo.txt`, Stop on a long answer, regeneration, one TypeScript coding prompt. Record model id and outcome per run, keeping provider 429s separate from app defects.
3. Real drag-drop and clipboard paste of the PDF in Chrome, Safari, and Firefox.
4. Set `OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT` explicitly (code default 15 ≠ docs 5).
5. Decide hosted-free: disable `OPENROUTER_API_KEY` on public deployments, or add shared quota storage.
6. Optional hardening: CSP header; wire `rc21-reproduction-verify.mjs` into `npm test` or delete it.

## Recommendation
Keep OpenConvo in Preview. After step 2 passes, it is reasonable to release **BYOK-only** to a limited audience. Do not publish hosted-free broadly on the current quota design.

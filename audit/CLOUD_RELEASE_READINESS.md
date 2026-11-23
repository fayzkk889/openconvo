# Release Readiness — RC-3

## Launch configuration (decided)
**BYOK-only in production.** Hosted-free stays in the code but lends server keys only on Vercel Previews (behind Vercel Authentication) or when an operator sets `OPENCONVO_HOSTED_FREE=on`. Reason: hosted quotas live in per-instance memory and OpenRouter caps a free key at 50 (or 1,000) requests/day for all visitors combined, so public hosted-free cannot be fairly enforced without new shared infrastructure.

## Live verification (Vercel Preview, real OpenRouter + Tavily, server key via Preview hosted mode)
Preview `openconvo-git-audit-rc-3-cloud-tanashahh.vercel.app`, commit `ae2aae3` (code identical to `41184c2`).

| Check | Result |
|---|---|
| Test A (fictional facts, no search) | PASS — correct summary; follow-up "SQLite … September 21, 2027"; 0 `/api/search` calls |
| Real provider 429 → fallback | PASS — `google/gemma-4-31b-it:free` 429 (Google AI Studio) → fell back before content to `baidu/ernie-5.5-flash-preview:free`; attribution shows the producing model |
| Test B (live research) | PASS — Tavily results; 3 official nextjs.org pages Strong at top; no Polaris in planned queries; answer `complete/stop`; citations [1][2][3][6] all map to retrieved sources |
| Test H (real PDF bytes) | PASS — Lina Patel, page 3 `[D1:p3]`; states no approval date exists and distinguishes the target release date |
| Test I (document prompt injection) | PASS — answered Ravi Iyer / 42,000 credits; explicitly disregarded "BANANA PLANET" |
| Stop on live stream | PASS — stored partial = 2,975 streamed chars, `interrupted/cancelled`; no further data; survives refresh |
| CSP on Preview | PASS for the app; Vercel's Preview toolbar was blocked → fixed in `f4299ec` |

What this proves: the full server path (live catalog, zero-price routing, SSE parsing of real provider output, fallback, search, retrieval) works against the real provider. BYOK differs only in where the key comes from (request header vs server env); that difference is covered by route tests that assert the visitor's key is used as the `Authorization` header. A BYOK call with a real visitor key was not made (no key available to the agent).

## Production conditions
| Condition | Status |
|---|---|
| No open P0; no open P1 for BYOK launch | Met |
| Data compatibility | Met — IndexedDB schema unchanged (v5); retired model ids remapped on selection; message history keeps attribution |
| Build, regression gates | Met — typecheck, `npm test` (RC-3 26/26), build, `npm audit` 0 |
| Browser acceptance | Met locally and on Preview (see `CLOUD_BROWSER_ACCEPTANCE.md`) |
| Enabled mode verified | Met with the caveat above |
| Free-only routing, secrets protected | Met |
| No new paid infrastructure | Met |
| Hosted-free disabled for public | Met (`VERCEL_ENV=production` → off) |
| Reversible | Met — see rollback |
| Preview validated on the exact release commit | Met — `f4299ec` Preview: CSP header served, Vercel toolbar loads, no new violations, live coding prompt routed `code` and completed `stop` with correct TypeScript |

## Known limitations at launch
- BYOK users without a Tavily key get keyless search; DuckDuckGo returns 403 to Vercel servers, so results rely on Bing HTML and seeded sources. Add a Tavily key in Settings for reliable research.
- Page extraction is off by default (`OPENCONVO_ENABLE_PAGE_EXTRACTION`); research cites search snippets.
- Free models occasionally cite document IDs at a finer granularity than supplied (e.g. `[D1:L2]` for excerpt `D1:L1-L7`).
- Real OS drag-and-drop, clipboard paste, and IME were not exercised by automation.

## Rollback
- Pre-release production: commit `77862a9` (Vercel production deployment of 2026-06-21).
- Fastest: Vercel dashboard → Deployments → previous production deployment → Instant Rollback (owner action).
- Agent-executable: `git revert -m 1 <merge-commit>` on `main` and push; Vercel redeploys the previous code.

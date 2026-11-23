# Research Notes (only what changed a decision)

| Question | Source | What it establishes | OpenConvo impact |
|---|---|---|---|
| Which client-IP header can a Vercel app trust? | [Vercel request headers](https://vercel.com/docs/headers/request-headers); [Vercel verified proxy guide](https://examples.vercel.com/kb/guide/how-to-setup-verified-proxy) | Vercel overwrites `X-Forwarded-For` to prevent spoofing (leftmost entry = client when Vercel is the outer edge). No equivalent guarantee is documented for `x-real-ip`; `cf-connecting-ip` is only meaningful behind Cloudflare. | Quota identity trusted `cf-connecting-ip` first → spoofable. Fixed: `x-forwarded-for` only (`src/lib/request-identity.ts`). |
| What limits apply to OpenRouter `:free` models? | [OpenRouter pricing](https://openrouter.ai/pricing); [Free models collection](https://openrouter.ai/collections/free-models) | 20 req/min and 50 req/day per account for `:free` variants (1,000/day after a $10 credit purchase); failed requests also count. | The hosted key is one shared pool: `OPENCONVO_HOSTED_FREE_DAILY_LIMIT=20` per IP exhausts it with 3 visitors (or 50 visitors at 1,000/day). Every fallback attempt and planner call also consumes it. Hosted-free cannot back a public launch. |
| Are the configured models still available? | `GET https://openrouter.ai/api/v1/models` (public, fetched 2026-11-23) | 477 models, 12 `:free`. None of the 7 curated ids, the default, or the fallback chain were listed. | Curated list refreshed to 4 listed ids; chat route now filters candidates against the live catalog. |
| Does `fetch` abort surface in the body reader? | Fetch standard (behaviour confirmed in-browser) | Aborting the signal errors the response body stream with `AbortError`. | `useChat` relies on this for Stop; a browser mock that did not error the body produced a false "Stop doesn't persist" result (recorded as a fixture error). |
| IME and Enter | `KeyboardEvent.isComposing` (UI Events) | Enter during composition confirms the candidate. | Composer sent half-composed CJK input. Fixed. |

Installed versions checked before relying on docs: next 15.5.x, react 19.1, pdfjs-dist 4.10.38, idb 8.

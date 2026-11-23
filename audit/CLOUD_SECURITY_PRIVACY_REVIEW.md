# Security & Privacy Review (defensive, local only)

## Fixed
- **Quota identity spoofing (P1, D-01).** Client-set `cf-connecting-ip` / `x-real-ip` minted unlimited hosted identities.
- **Hosted key spend via fake Tavily header (P1, D-02).**
- **Outbound data minimization (P2, D-08, D-09).** Conversation entities and full document chunks no longer leave the browser unless needed.
- **Error redaction (P3, D-15).** Provider messages are summarized; bearer/key patterns and JSON payloads removed.

## Verified as sound
- Free-only inference: client and server accept only `:free` ids; every upstream request sets `max_price` 0 (route test asserts the request body).
- API keys stay in localStorage and request headers; not in exports (browser-verified), not echoed in errors.
- Markdown links pass through `safeExternalUrl`; raw HTML is not enabled in `react-markdown`.
- SSRF: page extraction blocks private/loopback/link-local ranges, re-validates every redirect hop, checks DNS answers, caps body size and time.
- Prompt injection: search results and document excerpts are wrapped and labelled untrusted; injected text appears only inside the excerpt (test). Whether a given free model obeys this is **not verified**.
- Request bounds: chat body 2 MB, search 500 KB, query 4,000 chars, message/attachment/excerpt truncation.

## Remaining exposure
| Sev | Issue |
|---|---|
| Mitigated | Hosted quotas are per-instance; public deployments are now BYOK-only, so they no longer gate public spend. |
| P3 | DNS-rebinding window between validation and fetch (O-06). |
| P3 | Keyless scraping reachable by any visitor who sends a key header, valid or not (O-08, mitigated). |
| Info | BYOK keys live in localStorage. Mitigated by the CSP added in session 2 (`connect-src 'self'`, no remote images). `script-src` still needs `'unsafe-inline'` for Next static hydration. |
| Info | `npm audit`: 0 advisories. This is not an application security result. |

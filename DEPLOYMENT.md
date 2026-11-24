# Deploying OpenConvo

This guide assumes the repository is published at:

https://github.com/fayzkk889/openconvo

## Recommended Hosting

Use Vercel for the first public launch. The app is a standard Next.js project and does not require a database for the current local-first architecture.

## Environment Variables

Set these in your deployment provider:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key
TAVILY_API_KEY=tvly-your-key
SEARXNG_URL=https://your-searxng-instance.example
NEXT_PUBLIC_GITHUB_URL=https://github.com/fayzkk889/openconvo
NEXT_PUBLIC_SITE_URL=https://openconvo.vercel.app

# Only for lending shared capacity to keyless visitors (see below)
OPENCONVO_HOSTED_FREE=on
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
OPENCONVO_HOSTED_FREE_DAILY_LIMIT=20
OPENCONVO_HOSTED_FREE_GLOBAL_DAILY_LIMIT=30
OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT=15
OPENCONVO_HOSTED_SEARCH_GLOBAL_DAILY_LIMIT=20
```

Nothing is strictly required. By default every visitor brings their own free OpenRouter key (and optionally a Tavily key) in Settings; keys stay in their browser.

### Access modes

- **Bring-your-own-key (default for production).** Server keys are never lent to visitors. Chat and search without a visitor key return 401 with a prompt to add one.
- **Vercel Preview.** Previews lend `OPENROUTER_API_KEY` / `TAVILY_API_KEY` to signed-in reviewers, because Vercel Authentication restricts who can reach them. Set `OPENCONVO_HOSTED_FREE=off` to disable.
- **Hosted free (opt-in).** `OPENCONVO_HOSTED_FREE=on` lends the server keys to keyless visitors. On a Vercel production deployment this only takes effect when a shared quota store is configured: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` + `KV_REST_API_TOKEN` (an Upstash database added through the Vercel Marketplace sets these). Without it, per-instance memory counters could not enforce a daily cap, so the app stays BYOK-only.

### Hosted limits

- `OPENCONVO_HOSTED_FREE_DAILY_LIMIT`: chat requests per visitor per UTC day. Default `20`.
- `OPENCONVO_HOSTED_FREE_GLOBAL_DAILY_LIMIT`: chat requests for all keyless visitors together. Default `30`. A free OpenRouter key allows about 50 requests a day (failed requests count), and a hosted answer that searches makes one extra request (hosted answers get a single search round), so keep this at or below about half of that.
- `OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT`: hosted searches per visitor per day. Default `15`.
- `OPENCONVO_HOSTED_SEARCH_GLOBAL_DAILY_LIMIT`: hosted searches for all visitors together. Default `20`.

Counting is atomic in the shared store (one `INCRBY` per check), so concurrent requests on different instances cannot overshoot a cap. If the store is unreachable, keyless requests are refused with 503; visitors with their own key are unaffected.

### Search providers

The model searches through a `web_search` tool: it decides whether a question needs a search, writes the query, and can search again or read a result page (`read_page`). Each answer is bounded: 3 search rounds with your own key (4 for Deep research), 1 in hosted mode, and the 52-second request limit. Endpoints that reject tool definitions are retried without tools.

No search key is needed. Web searches query Bing and DuckDuckGo result pages and the Wikipedia API in parallel; news searches query the Bing News and Google News RSS feeds. Results that share too little with the query are dropped. `TAVILY_API_KEY` and `SEARXNG_URL` add extra sources when set. From Vercel, DuckDuckGo usually answers 403; the other sources work.

The news feeds and result pages are not official APIs: their terms restrict feed use to personal, non-commercial feed readers, and they can change format or block a host without notice. Set `OPENCONVO_NEWS_FEEDS=off` to stop using the news feeds, and configure Tavily or SearxNG if you need a supported API.

In hosted mode each search counts against the search quota above.

## Vercel Steps

1. Push the repo to GitHub.
2. Go to https://vercel.com/new.
3. Import `fayzkk889/openconvo`.
4. Keep the framework preset as Next.js.
5. Add the environment variables above.
6. Deploy.
7. Open the generated Vercel URL.
8. Test `/`, `/app`, `/privacy`, and `/security`.
9. Add your custom domain in Vercel Project Settings.

## Pre-Deploy Checks

Run locally before deploying:

```bash
npm run check:env
npm run test
npm run lint
npm run build
```

## Manual Smoke Test

After deployment:

1. Visit `/` and confirm the landing page loads.
2. Click `Launch app`.
3. Confirm `/app` loads.
4. With no browser OpenRouter key saved, confirm the composer explains that this deployment uses your own key (or, with hosted free enabled, that hosted free mode is active).
5. Add your own OpenRouter key in Settings.
6. Confirm the composer changes to BYOK mode and send a small test message.
7. Confirm `GET /api/config` reports `hostedFreeModeAvailable` as you intended.
8. Test model switching.
9. Test file upload with a small `.txt` file.
10. Test `/privacy` and `/security` links.

## Browser Tests

`npm run test:e2e` builds the app and runs the Playwright suite in `e2e/` against `next start`, using your installed Google Chrome (`PLAYWRIGHT_CHANNEL` overrides it). The suite replaces the API responses inside the browser, so it needs no keys and never calls a provider.

## Current Limitations

Without a shared quota store, hosted counters live in each serverless instance's memory. That is why production stays BYOK-only unless a store is configured.

Reading full pages is on by default (`OPENCONVO_ENABLE_PAGE_EXTRACTION=false` turns it off). The model can only read URLs its own searches returned, and every connection is pinned to an address that passed the private-network check, so a DNS answer cannot redirect it to an internal host.

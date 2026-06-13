# Deploying OpenConvo

This guide assumes the repository is published at:

https://github.com/fayzkk889/openconvo

## Recommended Hosting

Use Vercel for the first public launch. The app is a standard Next.js project and does not require a database for the current local-first architecture.

## Environment Variables

Set these in your deployment provider:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key
OPENCONVO_HOSTED_FREE_DAILY_LIMIT=20
TAVILY_API_KEY=tvly-your-key
NEXT_PUBLIC_GITHUB_URL=https://github.com/fayzkk889/openconvo
```

Required:

- `OPENROUTER_API_KEY` enables hosted free mode for visitors who do not bring their own key.

Optional:

- `OPENCONVO_HOSTED_FREE_DAILY_LIMIT` controls shared hosted messages per visitor per day. Default is `20`.
- `TAVILY_API_KEY` enables hosted web search. Users can still bring their own Tavily key in Settings.
- `NEXT_PUBLIC_GITHUB_URL` controls the landing page GitHub link.

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
4. With no browser OpenRouter key saved, confirm the composer says hosted free mode is active.
5. Send a small test message.
6. Add your own OpenRouter key in Settings.
7. Confirm the composer changes to BYOK mode.
8. Test model switching.
9. Test file upload with a small `.txt` file.
10. Test `/privacy` and `/security` links.

## Current Limitation

Hosted free mode uses an in-memory daily quota. That is acceptable for an early launch, but serverless deployments can reset memory between instances. For serious traffic, move rate limiting to a persistent service such as Upstash Redis or Vercel KV.

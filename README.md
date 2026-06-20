# OpenConvo

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffayzkk889%2Fopenconvo&env=OPENROUTER_API_KEY,OPENCONVO_HOSTED_FREE_DAILY_LIMIT,TAVILY_API_KEY,OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT,NEXT_PUBLIC_GITHUB_URL&envDescription=OpenConvo%20uses%20OpenRouter%20for%20hosted%20free%20mode%2C%20Tavily%20for%20optional%20search%2C%20and%20a%20public%20GitHub%20URL%20for%20landing%20page%20links.&envLink=https%3A%2F%2Fgithub.com%2Ffayzkk889%2Fopenconvo%2Fblob%2Fmain%2FDEPLOYMENT.md)

OpenConvo is a local-first, open-source AI chat workspace. It is designed for people who want a ChatGPT/Claude-style interface they can run themselves, with free OpenRouter models, automatic web research, file context, projects, prompt snippets, memory, and exportable local data.

Repository: https://github.com/fayzkk889/openconvo

The public site has two surfaces:

- `/` is the landing page for users, contributors, and deployment links.
- `/app` is the actual AI chat workspace.
- `/privacy` and `/security` explain the hosted privacy and security model.

## Features

- Local-first conversations, projects, settings, prompt snippets, memory, and artifacts stored in browser IndexedDB.
- Free-model-first OpenRouter integration with dynamic model discovery, `:free` filtering, and request-level zero-price enforcement.
- Streaming chat with fallback across curated free models when a provider is temporarily rate limited.
- Hosted free mode with server-side shared OpenRouter capacity and a daily per-visitor limit.
- Automatic web research with query planning, provider fallback, page extraction, citations, source quality ranking, and a deeper research mode: Tavily, optional SearxNG, then lightweight keyless DuckDuckGo.
- File uploads for text, markdown, code, JSON, CSV, and PDF context.
- Projects with custom instructions and optional project default models.
- Conversation title generation based on the first exchange.
- Canvas/artifact panel for extracted assistant code blocks.
- Import/export for conversations, projects, messages, artifacts, and safe settings.
- Prompt library, local memory, pinned/archived chats, command palette, and collapsible sidebar.

## Privacy Model

OpenConvo does not require user accounts. By default, chat data is stored locally in your browser.

API keys can be supplied in either place:

- In `.env.local` on the server for a personal/local deployment.
- In Settings inside the app for local browser use.

Exported backups intentionally exclude API keys.

## Free Model Safety

OpenConvo is intentionally conservative:

- The model API only returns OpenRouter models whose ids end in `:free`.
- Dynamic model pricing must report zero prompt and completion price.
- Chat/title requests send OpenRouter provider routing options with max prompt, completion, request, and image price set to `0`.
- Old saved/imported/stale model ids are repaired to a known free model.

Free OpenRouter providers can still be rate limited upstream. In that case OpenConvo will try another free fallback model, then show an error if none are available.

## Requirements

- Node.js 18.18 or newer.
- npm.
- OpenRouter API key from [openrouter.ai/keys](https://openrouter.ai/keys).
- Tavily API key from [tavily.com](https://tavily.com), optional for higher-quality web research.

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The chat workspace is available at [http://localhost:3000/app](http://localhost:3000/app).

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
npm run dev
```

Edit `.env.local` if you want server-side keys. You can also leave it blank and add keys in the app Settings.

## Environment Variables

```env
OPENROUTER_API_KEY=sk-or-v1-your-key
OPENCONVO_HOSTED_FREE_DAILY_LIMIT=20
TAVILY_API_KEY=tvly-your-key
SEARXNG_URL=https://your-searxng-instance.example
OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT=5
NEXT_PUBLIC_GITHUB_URL=https://github.com/your-name/openconvo
NEXT_PUBLIC_SITE_URL=https://openconvo.vercel.app
```

`OPENROUTER_API_KEY` is required for chat unless supplied in Settings. `TAVILY_API_KEY` and `SEARXNG_URL` are optional; OpenConvo can use lightweight keyless search when neither is set.
When `OPENROUTER_API_KEY` is set on a public deployment, visitors without their own key can use hosted free mode. `OPENCONVO_HOSTED_FREE_DAILY_LIMIT` controls the per-visitor daily limit for that shared mode.
Visitors can try hosted web search even without Tavily. `OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT` controls the per-visitor daily search limit. Users who add their own Tavily key in Settings bypass the hosted search cap and use Tavily directly.
`NEXT_PUBLIC_GITHUB_URL` is optional and only controls the GitHub link on the landing page.
`NEXT_PUBLIC_SITE_URL` controls canonical social preview URLs and should match your production domain.

## Scripts

```bash
npm run dev        # Start local development server
npm run build      # Create a production build
npm run start      # Start production server after build
npm run lint       # TypeScript strict check
npm run test       # Launch-safety checks
npm run check:env  # Validate deployment environment shape
npm run typecheck  # Same as lint
```

Before opening a release, run:

```bash
npm run test
npm run lint
npm run check:env
npm run build
```

## Self-Hosting

OpenConvo has no database server. Deploy it like a regular Next.js app and configure environment variables in your host.

For public deployments, OpenConvo protects shared server-side OpenRouter capacity and hosted search with lightweight in-memory daily limits. This is enough for an early launch, but high-traffic deployments should add persistent rate limiting at the hosting edge. The safest open-source path remains personal/local self-hosting where each user supplies their own keys.

For a public launch, point your domain at the deployed app and set `NEXT_PUBLIC_GITHUB_URL` after the repository is public. Keep `/app` as the product route so the root domain can explain the project before users enter the workspace.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the Vercel launch steps.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for current priorities, later ideas, and non-goals.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

For GitHub repository metadata, topics, and release setup, see [GITHUB_SETUP.md](./GITHUB_SETUP.md).

## Troubleshooting

**OpenRouter 429 or provider rate limited**

Free providers can be temporarily rate limited. Wait and retry, choose another free model, or add your own OpenRouter key in Settings.

**Search unavailable**

Add `TAVILY_API_KEY` in `.env.local` or Settings.

**Models look stale**

OpenConvo caches server-side model results briefly. Refresh after a few minutes or restart the dev server.

**Local data disappeared**

Data lives in the browser profile for the current origin. Changing browser, profile, domain, or localhost port can show a fresh workspace. Use Export Data before major changes.

## Launch Checklist

- `npm run test` passes.
- `npm run lint` passes.
- `npm run build` passes.
- Manually test new chat, streaming, stop, retry/regenerate, model switching, fallback error display, title generation, sidebar collapse, projects, settings, import/export, file upload, search, research mode, artifacts, and mobile layout.
- Confirm `.env.example` is current.
- Confirm API keys are not committed.
- Confirm exported backup does not contain API keys.
- Confirm public deployments have rate limiting if server-side keys are configured.

## License

MIT

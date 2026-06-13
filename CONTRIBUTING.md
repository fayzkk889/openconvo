# Contributing

Thanks for helping improve OpenConvo.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Before Submitting Changes

Run:

```bash
npm run test
npm run lint
npm run build
```

## Development Notes

- Keep OpenConvo local-first and open-source-first.
- Do not add authentication, billing, or cloud sync unless the project direction explicitly changes.
- Keep free-model safety intact: model ids shown to users should be `:free`, and OpenRouter requests must keep zero-price provider routing.
- Do not export API keys.
- Prefer focused changes and preserve existing data migrations.

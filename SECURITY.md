# Security Policy

## Supported Use

OpenConvo is currently intended for local and personal self-hosted use. Public hosting is possible, but you should add rate limiting and abuse controls before exposing a shared server-side API key.

## API Keys

- Do not commit `.env.local` or real API keys.
- Browser-entered keys are stored locally by the browser.
- Exported backups do not include API keys.
- If a key is exposed, revoke it from the provider dashboard and create a new one.

## Reporting Issues

Please report security issues privately to the project maintainer rather than opening a public issue with exploit details. Include the affected version, reproduction steps, and any relevant logs with secrets removed.

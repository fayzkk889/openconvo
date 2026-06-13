import Link from 'next/link';
import { ArrowLeft, Database, KeyRound, ShieldCheck } from 'lucide-react';
import { getGithubUrl } from '@/lib/site';

export default function PrivacyPage() {
  const githubUrl = getGithubUrl();

  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          <ArrowLeft className="h-4 w-4" />
          Back to OpenConvo
        </Link>

        <div className="mt-10">
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">Privacy</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-normal sm:text-5xl">Local-first by default.</h1>
          <p className="mt-5 text-base leading-7 text-[var(--color-text-secondary)]">
            OpenConvo is designed to keep your workspace under your control. The hosted app can send chat requests to configured AI providers, but conversations and settings are stored in your browser unless you export them.
          </p>
        </div>

        <div className="mt-10 grid gap-4">
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <Database className="h-5 w-5" />
            <h2 className="mt-4 text-lg font-semibold">What is stored locally</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              Conversations, projects, prompt snippets, memory, settings, artifacts, and imported data are stored in the browser profile for the current domain.
            </p>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <KeyRound className="h-5 w-5" />
            <h2 className="mt-4 text-lg font-semibold">API keys</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              Keys entered in Settings are saved in your browser and sent only to OpenConvo API routes for the request you make. Exported backups intentionally exclude API keys.
            </p>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <ShieldCheck className="h-5 w-5" />
            <h2 className="mt-4 text-lg font-semibold">Hosted free mode</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              If the hosted deployment offers free shared usage, your prompts are sent to OpenRouter through the server key. Do not send secrets or sensitive personal data to hosted free mode.
            </p>
          </section>
        </div>

        <div className="mt-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5 text-sm leading-6 text-[var(--color-text-secondary)]">
          OpenConvo is open source. You can inspect, self-host, or fork the project on{' '}
          <a href={githubUrl} target="_blank" rel="noreferrer" className="font-medium text-[var(--color-text-primary)] underline underline-offset-4">
            GitHub
          </a>
          .
        </div>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { ArrowLeft, KeyRound, LockKeyhole, ServerCog } from 'lucide-react';
import { getGithubUrl } from '@/lib/site';

export default function SecurityPage() {
  const githubUrl = getGithubUrl();

  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          <ArrowLeft className="h-4 w-4" />
          Back to OpenConvo
        </Link>

        <div className="mt-10">
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">Security</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-normal sm:text-5xl">Built for transparent deployment.</h1>
          <p className="mt-5 text-base leading-7 text-[var(--color-text-secondary)]">
            OpenConvo keeps the architecture intentionally simple: browser-local data, server-side provider calls, free-only routing, and clear separation between hosted shared usage and user-owned keys.
          </p>
        </div>

        <div className="mt-10 grid gap-4">
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <LockKeyhole className="h-5 w-5" />
            <h2 className="mt-4 text-lg font-semibold">Free-only routing</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              The app lists OpenRouter models with <span className="font-mono">:free</span> ids and sends zero max-price provider options on chat requests.
            </p>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <ServerCog className="h-5 w-5" />
            <h2 className="mt-4 text-lg font-semibold">Hosted limits</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              Hosted free chat and hosted search use daily shared quotas. The built-in limiters are in-memory and best for early launches; production-scale deployments should add persistent edge rate limiting.
            </p>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            <KeyRound className="h-5 w-5" />
            <h2 className="mt-4 text-lg font-semibold">Key handling</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              Never commit <span className="font-mono">.env.local</span>. Revoke provider keys immediately if they are exposed. User-entered keys stay in local browser storage and are excluded from exports.
            </p>
          </section>
        </div>

        <div className="mt-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5 text-sm leading-6 text-[var(--color-text-secondary)]">
          Report security concerns through the maintainer contact listed in the repository. Avoid public issues for exploit details. Source code is available on{' '}
          <a href={githubUrl} target="_blank" rel="noreferrer" className="font-medium text-[var(--color-text-primary)] underline underline-offset-4">
            GitHub
          </a>
          .
        </div>
      </div>
    </main>
  );
}

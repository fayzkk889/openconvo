import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Braces,
  CheckCircle2,
  Github,
  KeyRound,
  Laptop,
  LockKeyhole,
  MessageSquareText,
  Search,
  Sparkles,
} from 'lucide-react';
import { getGithubUrl } from '@/lib/site';

const githubUrl = getGithubUrl();

const pillars = [
  {
    title: 'Hosted free mode',
    description: 'Try OpenConvo in the browser with shared free-model capacity and clear limits.',
    icon: Sparkles,
  },
  {
    title: 'Bring your own key',
    description: 'Use your own OpenRouter and Tavily keys for more reliable private usage.',
    icon: KeyRound,
  },
  {
    title: 'Self-host anywhere',
    description: 'Clone the MIT-licensed app, deploy it yourself, and keep control of your workspace.',
    icon: Laptop,
  },
];

const capabilities = [
  'Dynamic verified-free OpenRouter model list',
  'Streaming chat with fallback handling',
  'File-aware conversations and PDF context',
  'Optional web search and research mode',
  'Projects, prompts, memory, and artifacts',
  'Local-first data with import and export',
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3 font-semibold" aria-label="OpenConvo home">
            <img src="/mark-transparent.png" alt="" className="logo-image h-8 w-8 object-contain" />
            <span>OpenConvo</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-[var(--color-text-secondary)] md:flex">
            <a href="#features" className="transition-colors hover:text-[var(--color-text-primary)]">Features</a>
            <a href="#opensource" className="transition-colors hover:text-[var(--color-text-primary)]">Open source</a>
            <a href="#deploy" className="transition-colors hover:text-[var(--color-text-primary)]">Deploy</a>
            <Link href="/privacy" className="transition-colors hover:text-[var(--color-text-primary)]">Privacy</Link>
          </nav>
          <div className="flex items-center gap-2">
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden h-9 items-center gap-2 rounded-md border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-light)] hover:text-[var(--color-text-primary)] sm:inline-flex"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
            <Link
              href="/app"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-accent-foreground)] shadow-sm transition-colors hover:bg-[var(--color-accent-hover)]"
            >
              Launch app
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <section className="border-b border-[var(--color-border)]">
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-7xl items-center gap-12 px-5 py-14 sm:px-8 lg:grid-cols-[1fr_0.95fr] lg:py-20">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)]">
              <LockKeyhole className="h-4 w-4" />
              Open-source, local-first AI workspace
            </div>
            <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-normal text-[var(--color-text-primary)] sm:text-6xl lg:text-7xl">
              OpenConvo
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--color-text-secondary)] sm:text-xl">
              A clean AI chat workspace for verified free OpenRouter models, file-aware conversations, web research, projects, memory, and self-hosted control.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/app"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-6 text-base font-semibold text-[var(--color-accent-foreground)] shadow-sm transition-colors hover:bg-[var(--color-accent-hover)]"
              >
                Start a conversation
                <ArrowRight className="h-5 w-5" />
              </Link>
              <a
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-6 text-base font-semibold text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-light)]"
              >
                <Github className="h-5 w-5" />
                View source
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/25">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <img src="/mark-transparent.png" alt="" className="logo-image h-7 w-7 object-contain" />
                  <span className="text-sm font-semibold">OpenConvo</span>
                </div>
                <div className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)]">
                  Verified free
                </div>
              </div>
              <div className="grid min-h-[420px] grid-cols-[160px_1fr]">
                <aside className="border-r border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
                  {['Research notes', 'PDF summary', 'Project plan', 'Model tests'].map((item, index) => (
                    <div
                      key={item}
                      className={`mb-2 rounded-md px-3 py-2 text-xs ${index === 0 ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
                    >
                      {item}
                    </div>
                  ))}
                </aside>
                <div className="flex flex-col justify-between p-5">
                  <div className="space-y-5">
                    <div className="ml-auto max-w-[70%] rounded-2xl bg-[var(--color-bg-tertiary)] px-4 py-3 text-sm">
                      Compare these notes and draft a launch plan.
                    </div>
                    <div className="max-w-[82%]">
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                        <Sparkles className="h-4 w-4" />
                        openai/gpt-oss-20b:free
                      </div>
                      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4 text-sm leading-6 text-[var(--color-text-secondary)]">
                        Here is a concise launch plan with hosted free mode, BYOK settings, deployment steps, and open-source docs.
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
                    <div className="mb-3 h-4 w-44 rounded bg-[var(--color-bg-tertiary)]" />
                    <div className="flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
                      <MessageSquareText className="h-4 w-4" />
                      <Search className="h-4 w-4" />
                      <Braces className="h-4 w-4" />
                      <span className="ml-auto">Free model selected</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold sm:text-4xl">Built for serious everyday AI work.</h2>
            <p className="mt-4 text-base leading-7 text-[var(--color-text-secondary)]">
              OpenConvo combines the familiar chat workflow with the controls people expect from an open-source workspace.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {pillars.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5">
                  <Icon className="h-5 w-5 text-[var(--color-text-primary)]" />
                  <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{item.description}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((item) => (
              <div key={item} className="flex items-start gap-3 text-sm text-[var(--color-text-secondary)]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="opensource" className="border-b border-[var(--color-border)]">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold sm:text-4xl">Open-source first, hosted for convenience.</h2>
            <p className="mt-4 text-base leading-7 text-[var(--color-text-secondary)]">
              The hosted website should make OpenConvo easy to try. The source code should remain the foundation: transparent, self-hostable, and friendly to people who want their own keys and their own data.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6">
            <div className="flex items-center gap-3 text-sm font-semibold">
              <BookOpen className="h-5 w-5" />
              Open-source promise
            </div>
            <div className="mt-5 space-y-4 text-sm text-[var(--color-text-secondary)]">
              <p>OpenConvo is MIT-licensed, self-hostable, and built around local browser storage so users can inspect the code and keep control of their workspace.</p>
              <p>Use the hosted app for a quick start, or bring your own keys when you want more reliable personal capacity.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="deploy" className="bg-[var(--color-bg-secondary)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Ready to try the workspace?</h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Use the hosted app now, or self-host it with your own keys and deployment limits.
            </p>
          </div>
          <Link
            href="/app"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-5 text-sm font-semibold text-[var(--color-accent-foreground)] transition-colors hover:bg-[var(--color-accent-hover)]"
          >
            Open app
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-6 text-sm text-[var(--color-text-tertiary)] sm:px-8 md:flex-row md:items-center md:justify-between">
          <span>OpenConvo is open source under the MIT license.</span>
          <div className="flex flex-wrap gap-4">
            <a href={githubUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--color-text-primary)]">
              GitHub
            </a>
            <Link href="/privacy" className="hover:text-[var(--color-text-primary)]">
              Privacy
            </Link>
            <Link href="/security" className="hover:text-[var(--color-text-primary)]">
              Security
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

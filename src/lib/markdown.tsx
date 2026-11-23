'use client';

import React, { useState, useCallback } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import { safeExternalUrl } from '@/lib/utils';

function extractRawText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractRawText).join('');
  }
  if (React.isValidElement(node)) {
    return extractRawText((node.props as { children?: React.ReactNode })?.children);
  }
  return '';
}

function CodeBlock({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeString = extractRawText(children).replace(/\n$/, '');
  const isInline = !className;

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [codeString]);

  if (isInline) {
    return <code className={className} {...props}>{children}</code>;
  }

  return (
    <div className="relative group my-3 overflow-hidden rounded-lg border border-[var(--color-border)]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
        <span className="text-xs text-[var(--color-text-tertiary)] font-mono">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
          aria-label="Copy code"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="overflow-x-auto max-w-full p-3 bg-[var(--color-bg-secondary)]">
        <code className={className} {...props}>{children}</code>
      </div>
    </div>
  );
}

const markdownComponents: Components = {
  code: CodeBlock as Components['code'],
  table: ({ children, ...props }) => (
    <div className="my-3 overflow-x-auto max-w-full">
      <table className="min-w-full border-collapse border border-[var(--color-border)] text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th className="border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2 text-left font-semibold text-[var(--color-text-primary)]" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border border-[var(--color-border)] px-3 py-2 text-[var(--color-text-secondary)]" {...props}>
      {children}
    </td>
  ),
  a: ({ href, children, ...props }) => {
    const safeHref = safeExternalUrl(href);
    if (!safeHref) return <span {...props}>{children}</span>;
    return <a href={safeHref} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
  },
};

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

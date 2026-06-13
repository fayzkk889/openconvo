'use client';

import React, { useState, useCallback } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import { safeExternalUrl } from '@/lib/utils';

function CodeBlock({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeString = String(children).replace(/\n$/, '');
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
    <div className="relative group">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] rounded-t-lg">
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
      <code className={className} {...props}>{children}</code>
    </div>
  );
}

const markdownComponents: Components = {
  code: CodeBlock as Components['code'],
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

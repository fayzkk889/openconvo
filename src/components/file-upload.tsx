'use client';

import React, { useRef, useCallback, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { parseFile, ACCEPTED_FILE_TYPES } from '@/lib/file-parser';
import type { Attachment } from '@/types/chat';

interface FileUploadProps {
  attachments: Attachment[];
  onAttach: (attachment: Attachment) => void;
  onRemove: (id: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUpload({ attachments, onAttach, onRemove }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      setError(null);
      for (const file of Array.from(files)) {
        try {
          const attachment = await parseFile(file);
          onAttach(attachment);
        } catch (err) {
          console.error('Failed to parse file:', err);
          setError(err instanceof Error ? err.message : `Failed to read ${file.name}`);
        }
      }

      // Reset input so the same file can be re-selected
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    },
    [onAttach]
  );

  return (
    <div className="flex flex-col gap-2">
      {/* File chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs"
              style={{ background: 'var(--color-bg-tertiary)' }}
            >
              <Paperclip className="h-3 w-3 text-[var(--color-text-tertiary)]" />
              <span className="max-w-[120px] truncate text-[var(--color-text-secondary)]">
                {attachment.name}
              </span>
              <span className="text-[var(--color-text-tertiary)]">
                ({formatFileSize(attachment.size)})
              </span>
              <button
                onClick={() => onRemove(attachment.id)}
                className="ml-0.5 rounded p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-hover)] transition-colors"
                aria-label={`Remove ${attachment.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      {/* Upload button */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        onChange={handleChange}
        className="hidden"
        aria-hidden
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={handleClick}
            aria-label="Attach files"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Attach files</TooltipContent>
      </Tooltip>
    </div>
  );
}

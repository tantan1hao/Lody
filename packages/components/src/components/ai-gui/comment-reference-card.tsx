'use client';

import { Quote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isFileCommentReference, truncateCommentBody, type CommentReferencePayload } from '@lody/shared';
import { cn } from '@/lib/utils';
import { FileIcon } from '@/components/icons/file-icons';

interface CommentReferenceCardProps {
  reference: CommentReferencePayload;
  onClick?: () => void;
  className?: string;
}

function getFileNameFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

/**
 * Compact card shown in user chat bubbles for comment references.
 * File comments show path:line; conversation quotes show the selected snippet.
 * Clicking a file comment navigates to the corresponding diff position.
 */
export function CommentReferenceCard({ reference, onClick, className }: CommentReferenceCardProps) {
  const { t } = useTranslation();
  const isFileComment = isFileCommentReference(reference);
  const preview = truncateCommentBody(reference.commentBody, 60);
  const title = isFileComment
    ? `${getFileNameFromPath(reference.path)}:${reference.lineNumber}`
    : (reference.authorName ?? t('sessions.quoteSelection.quoteLabel', 'Quote'));

  return (
    <button
      type="button"
      onClick={isFileComment ? onClick : undefined}
      className={cn(
        'flex w-full max-w-sm flex-col gap-0.5 rounded-lg border px-3 py-2 text-left text-xs',
        'bg-muted/40 transition-colors hover:bg-muted/70',
        isFileComment && onClick && 'cursor-pointer',
        (!isFileComment || !onClick) && 'cursor-default',
        className
      )}
      title={reference.commentBody}
    >
      <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
        {isFileComment ? (
          <FileIcon filePath={reference.path} className="h-3 w-3 shrink-0" />
        ) : (
          <Quote className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">{title}</span>
      </div>
      <div className="truncate text-foreground/70">&ldquo;{preview}&rdquo;</div>
    </button>
  );
}

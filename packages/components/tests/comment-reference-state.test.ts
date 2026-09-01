import { describe, expect, it } from 'vitest';

import { getCommentReferenceKey } from '../src/components/chat/comment-reference-state';
import type { CommentReferencePayload } from '@lody/shared';

const fileComment: CommentReferencePayload = {
  source: 'lody',
  path: 'src/foo.ts',
  lineNumber: 42,
  side: 'additions',
  commentBody: 'Handle the null case.',
  authorName: 'Ada',
};

describe('getCommentReferenceKey', () => {
  it('keeps file comments unique by path and line', () => {
    expect(getCommentReferenceKey(fileComment)).not.toBe(
      getCommentReferenceKey({
        ...fileComment,
        lineNumber: 43,
      })
    );
  });

  it('gives two different conversation quotes distinct keys', () => {
    const first: CommentReferencePayload = {
      source: 'session_text',
      commentBody: 'Retry should keep the original turn id.',
      turnId: 'turn-user-3',
      role: 'user',
    };
    const second: CommentReferencePayload = {
      source: 'session_text',
      commentBody: 'Do not invent a second chip path.',
      turnId: 'turn-assistant-4',
      role: 'assistant',
    };

    expect(getCommentReferenceKey(first)).not.toBe(getCommentReferenceKey(second));
    expect(getCommentReferenceKey(first)).not.toBe(getCommentReferenceKey(fileComment));
  });

  it('treats the same quote from the same turn as one chip', () => {
    const quote: CommentReferencePayload = {
      source: 'session_text',
      commentBody: 'same selected span',
      turnId: 'turn-1',
      role: 'assistant',
    };
    expect(getCommentReferenceKey(quote)).toBe(getCommentReferenceKey({ ...quote }));
  });
});

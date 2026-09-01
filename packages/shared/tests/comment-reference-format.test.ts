import { describe, expect, it } from 'vitest';
import {
  CommentReferencePayloadSchema,
  SessionInputBlockSchema,
  formatCommentReferenceForPrompt,
} from '../src/index';

describe('session_text comment references', () => {
  it('accepts a conversation quote without file fields', () => {
    const parsed = CommentReferencePayloadSchema.parse({
      source: 'session_text',
      commentBody: '把本机最新截屏发我',
      role: 'user',
      turnId: 'turn-1',
    });
    expect(parsed.source).toBe('session_text');
    expect(parsed.commentBody).toBe('把本机最新截屏发我');
  });

  it('rejects a quote with no selected text', () => {
    expect(
      CommentReferencePayloadSchema.safeParse({
        source: 'session_text',
      }).success
    ).toBe(false);
  });

  it('formats a quote for the prompt without inventing a file path', () => {
    expect(
      formatCommentReferenceForPrompt({
        source: 'session_text',
        commentBody: 'hello',
        authorName: 'zhang',
        role: 'user',
        turnId: 'turn-1',
      })
    ).toBe(
      [
        '<comment-reference source="session_text" role="user" turn="turn-1">',
        '@zhang:',
        'hello',
        '</comment-reference>',
      ].join('\n')
    );
  });

  it('keeps the existing file-comment prompt format', () => {
    expect(
      formatCommentReferenceForPrompt({
        source: 'lody',
        path: 'src/foo.ts',
        lineNumber: 42,
        side: 'additions',
        commentBody: 'Handle the null case.',
        authorName: 'Ada',
      })
    ).toBe(
      [
        '<comment-reference path="src/foo.ts" line="42" side="additions">',
        '@Ada:',
        'Handle the null case.',
        '</comment-reference>',
      ].join('\n')
    );
  });

  it('accepts a session_text comment_reference input block', () => {
    expect(
      SessionInputBlockSchema.parse({
        type: 'comment_reference',
        source: 'session_text',
        commentBody: 'just the selected text',
        role: 'assistant',
      })
    ).toMatchObject({
      type: 'comment_reference',
      source: 'session_text',
      commentBody: 'just the selected text',
      role: 'assistant',
    });
  });
});

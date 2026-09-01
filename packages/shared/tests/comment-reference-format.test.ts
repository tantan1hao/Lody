import { describe, expect, it } from 'vitest';
import { CommentReferencePayloadSchema, formatCommentReferenceForPrompt } from '../src/index';

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
});

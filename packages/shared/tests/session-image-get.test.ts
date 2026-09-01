import { describe, expect, it } from 'vitest';
import { SESSION_IMAGE_SEND_MAX_DATA_CHARS } from '../src/session-image-send';
import {
  SessionImageGetRequestSchema,
  SessionImageGetResponseSchema,
  sessionImageGetError,
} from '../src/session-image-get';

describe('session/image-get', () => {
  it('accepts a bounded image id for the execution machine', () => {
    const parsed = SessionImageGetRequestSchema.parse({
      sessionId: 'sess-1',
      imageId: 'img-1',
    });
    expect(parsed.imageId).toBe('img-1');
  });

  it('rejects a path-escaping image id before the daemon reads it', () => {
    expect(
      SessionImageGetRequestSchema.safeParse({
        sessionId: 'sess-1',
        imageId: '../escape',
      }).success
    ).toBe(false);
  });

  it('rejects an oversized base64 payload before the client decodes it', () => {
    expect(
      SessionImageGetResponseSchema.safeParse({
        status: 'ok',
        image: {
          imageId: 'img-1',
          mimeType: 'image/png',
          sizeBytes: 4,
        },
        mimeType: 'image/png',
        data: 'A'.repeat(SESSION_IMAGE_SEND_MAX_DATA_CHARS + 1),
      }).success
    ).toBe(false);
  });

  it('keeps ok and error envelopes distinct', () => {
    expect(
      SessionImageGetResponseSchema.parse({
        status: 'ok',
        image: {
          imageId: 'img-1',
          mimeType: 'image/jpeg',
          fileName: 'a.jpg',
          sizeBytes: 12,
        },
        mimeType: 'image/jpeg',
        data: 'abc',
      }).status
    ).toBe('ok');
    expect(
      SessionImageGetResponseSchema.parse(
        sessionImageGetError('not_found', { message: 'missing image' })
      )
    ).toMatchObject({ status: 'error', code: 'not_found' });
  });
});

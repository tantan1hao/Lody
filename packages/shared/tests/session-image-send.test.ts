import { describe, expect, it } from 'vitest';
import {
  SESSION_IMAGE_SEND_MAX_DATA_CHARS,
  SessionImageSendRequestSchema,
  SessionImageSendResponseSchema,
  sessionImageSendError,
} from '../src/session-image-send';

describe('session/image-send', () => {
  it('accepts a bounded base64 image for the execution machine', () => {
    const parsed = SessionImageSendRequestSchema.parse({
      sessionId: 'sess-1',
      fileName: 'shot.png',
      mimeType: 'image/png',
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
    });
    expect(parsed.fileName).toBe('shot.png');
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  it('rejects an oversized base64 payload before the daemon reads it', () => {
    expect(
      SessionImageSendRequestSchema.safeParse({
        sessionId: 'sess-1',
        fileName: 'huge.png',
        mimeType: 'image/png',
        data: 'A'.repeat(SESSION_IMAGE_SEND_MAX_DATA_CHARS + 1),
      }).success
    ).toBe(false);
  });

  it('keeps ok and error envelopes distinct', () => {
    expect(
      SessionImageSendResponseSchema.parse({
        status: 'ok',
        image: {
          imageId: 'img-1',
          mimeType: 'image/jpeg',
          fileName: 'a.jpg',
          sizeBytes: 12,
        },
      }).status
    ).toBe('ok');
    expect(
      SessionImageSendResponseSchema.parse(
        sessionImageSendError('unsupported_type', { message: 'not an image' })
      )
    ).toMatchObject({ status: 'error', code: 'unsupported_type' });
  });
});

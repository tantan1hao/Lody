import { describe, expect, it } from 'vitest';
import {
  SESSION_FILE_GET_MAX_CHUNK_BYTES,
  SessionFileGetRequestSchema,
  SessionFileGetResponseSchema,
  sessionFileGetError,
} from '../src/session-file-get';

describe('session/file-get', () => {
  it('accepts a bounded range read for a stored session file', () => {
    const parsed = SessionFileGetRequestSchema.parse({
      sessionId: 'sess-1',
      fileId: 'file-1',
      offset: 0,
      maxBytes: 1024,
    });
    expect(parsed.fileId).toBe('file-1');
    expect(parsed.maxBytes).toBe(1024);
  });

  it('rejects a chunk larger than the Machine RPC budget', () => {
    expect(
      SessionFileGetRequestSchema.safeParse({
        sessionId: 'sess-1',
        fileId: 'file-1',
        maxBytes: SESSION_FILE_GET_MAX_CHUNK_BYTES + 1,
      }).success
    ).toBe(false);
  });

  it('keeps ok and error envelopes distinct', () => {
    expect(
      SessionFileGetResponseSchema.parse({
        status: 'ok',
        fileId: 'file-1',
        mimeType: 'text/plain',
        fileName: 'notes.txt',
        sizeBytes: 4,
        offset: 0,
        byteLength: 4,
        eof: true,
        data: Buffer.from('abcd').toString('base64'),
      }).status
    ).toBe('ok');
    expect(sessionFileGetError('not_found', { message: 'missing' }).status).toBe('error');
  });
});

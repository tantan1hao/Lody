import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_FILE_PREVIEW_FETCH_BYTES } from '@lody/shared';
import {
  fetchSessionFilePreview,
  setSessionFileGetLoader,
} from '../src/lib/session-file-download';

afterEach(() => {
  setSessionFileGetLoader(null);
});

describe('fetchSessionFilePreview machine source', () => {
  it('assembles the first Machine RPC chunk as preview text', async () => {
    setSessionFileGetLoader(async (request) => ({
      status: 'ok',
      fileId: request.fileId,
      mimeType: 'text/plain',
      fileName: 'notes.txt',
      sizeBytes: 20,
      offset: request.offset ?? 0,
      byteLength: 4,
      eof: true,
      data: Buffer.from('abcd').toString('base64'),
    }));

    const result = await fetchSessionFilePreview({
      workspaceId: 'ws-1',
      sessionId: 'sess-1',
      fileId: 'file-1',
      token: '',
      sizeBytes: 20,
      source: 'machine',
    });

    expect(result.text).toBe('abcd');
    expect(result.fetchedBytes).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it('reports a complete preview when the machine returns eof inside the window', async () => {
    setSessionFileGetLoader(async (request) => ({
      status: 'ok',
      fileId: request.fileId,
      mimeType: 'text/plain',
      sizeBytes: 4,
      offset: 0,
      byteLength: 4,
      eof: true,
      data: Buffer.from('done').toString('base64'),
    }));

    const result = await fetchSessionFilePreview({
      workspaceId: 'ws-1',
      sessionId: 'sess-1',
      fileId: 'file-1',
      token: '',
      sizeBytes: 4,
      source: 'machine',
    });

    expect(result).toEqual({ text: 'done', truncated: false, fetchedBytes: 4 });
    expect(SESSION_FILE_PREVIEW_FETCH_BYTES).toBeGreaterThan(4);
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSessionImageBlobPath,
  readSessionImageBlob,
  writeSessionImageBlob,
} from './session-image-blob-store';

describe('session-image-blob-store', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map(async (dir) => await fs.promises.rm(dir, { recursive: true, force: true }))
    );
  });

  it('writes and reads an image blob under the data root', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lody-image-blob-'));
    dirs.push(homeDir);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    await writeSessionImageBlob({
      workspaceId: 'lw_test',
      sessionId: 'sess-1',
      imageId: 'img-1',
      bytes,
      mimeType: 'image/png',
      fileName: 'shot.png',
      homeDir,
    });
    const record = await readSessionImageBlob({
      workspaceId: 'lw_test',
      sessionId: 'sess-1',
      imageId: 'img-1',
      homeDir,
    });
    expect(record).toEqual({
      bytes,
      mimeType: 'image/png',
      fileName: 'shot.png',
      sizeBytes: bytes.byteLength,
    });
    expect(
      fs.existsSync(
        getSessionImageBlobPath({
          workspaceId: 'lw_test',
          sessionId: 'sess-1',
          imageId: 'img-1',
          homeDir,
        })
      )
    ).toBe(true);
  });

  it('rejects path-escaping identifiers', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lody-image-blob-'));
    dirs.push(homeDir);
    expect(() =>
      getSessionImageBlobPath({
        workspaceId: 'lw_test',
        sessionId: 'sess-1',
        imageId: '../escape',
        homeDir,
      })
    ).toThrow(/imageId/);
  });

  it('returns null when the blob is missing', async () => {
    const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lody-image-blob-'));
    dirs.push(homeDir);
    await expect(
      readSessionImageBlob({
        workspaceId: 'lw_test',
        sessionId: 'sess-1',
        imageId: 'missing',
        homeDir,
      })
    ).resolves.toBeNull();
  });
});

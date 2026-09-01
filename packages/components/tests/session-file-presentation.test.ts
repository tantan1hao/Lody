import { describe, expect, it } from 'vitest';
import { getServerNow, type SessionFilePayload } from '@lody/shared';
import {
  getSessionFileDisplayState,
  SESSION_FILE_RETENTION_MS,
} from '../src/lib/session-file-presentation';

const file = (overrides: Partial<SessionFilePayload> = {}): SessionFilePayload => ({
  type: 'file',
  fileId: 'file-1',
  fileName: 'notes.txt',
  mimeType: 'text/plain',
  sizeBytes: 12,
  sha256: 'a'.repeat(64),
  textPreview: true,
  transport: 'r2',
  uploadedAt: getServerNow(),
  ...overrides,
});

describe('getSessionFileDisplayState', () => {
  it('treats official local transport as pending backfill', () => {
    expect(getSessionFileDisplayState(file({ transport: 'local', machineId: 'm-1' }))).toBe(
      'pending'
    );
  });

  it('treats durable local transport as previewable or downloadable', () => {
    expect(
      getSessionFileDisplayState(file({ transport: 'local', machineId: 'm-1' }), getServerNow(), {
        localIsDurable: true,
      })
    ).toBe('previewable');
    expect(
      getSessionFileDisplayState(
        file({ transport: 'local', machineId: 'm-1', textPreview: false }),
        getServerNow(),
        { localIsDurable: true }
      )
    ).toBe('downloadable');
  });

  it('still expires durable local files after the retention window', () => {
    expect(
      getSessionFileDisplayState(
        file({
          transport: 'local',
          machineId: 'm-1',
          uploadedAt: getServerNow() - SESSION_FILE_RETENTION_MS - 1,
        }),
        getServerNow(),
        { localIsDurable: true }
      )
    ).toBe('expired');
  });
});

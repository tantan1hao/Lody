import { describe, expect, it } from 'vitest';
import {
  buildSidebarSessionBackup,
  sidebarSessionBackupFilename,
} from '../src/lib/sidebar-session-backup';

describe('sidebar session backup', () => {
  it('wraps a session snapshot for an offline copy', () => {
    expect(
      buildSidebarSessionBackup(
        {
          id: 'sess-1',
          title: 'Fix login',
          machineId: 'mac-1',
          projectName: 'market-bot',
        },
        '2026-08-29T20:00:00.000Z'
      )
    ).toEqual({
      version: 1,
      kind: 'lody-oss-session-backup',
      exportedAt: '2026-08-29T20:00:00.000Z',
      session: {
        id: 'sess-1',
        title: 'Fix login',
        machineId: 'mac-1',
        projectName: 'market-bot',
      },
    });
  });

  it('keeps download names filesystem-safe', () => {
    expect(sidebarSessionBackupFilename('sess/../a b')).toBe('lody-session-sess-..-a-b.json');
    expect(sidebarSessionBackupFilename('ok_id.1')).toBe('lody-session-ok_id.1.json');
  });
});

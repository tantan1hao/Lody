import assert from 'node:assert/strict'
import test from 'node:test'
import { buildResticBackupArgs, parseDeviceBackupConfig } from './device-backup-core.ts'

void test('builds a tagged Restic SFTP backup without putting a password in argv', () => {
  const config = parseDeviceBackupConfig({
    version: 1,
    repository: 'sftp:lodybackup@tan:/srv/lody-oss/device-backups',
    resticPath: '/opt/homebrew/bin/restic',
    passwordCommand: 'security find-generic-password -s lody-oss-restic -w',
    sftpCommand: 'ssh -i /tmp/device-key -o IdentitiesOnly=yes lodybackup@tan -s sftp'
  })
  const args = buildResticBackupArgs({
    config,
    machineId: 'machine-a',
    host: 'mac-a',
    statePaths: ['/Users/me/.lody-oss/loro-repo']
  })
  assert.deepEqual(args.slice(-7), [
    '--host',
    'mac-a',
    '--tag',
    'lody-oss',
    '--tag',
    'machine:machine-a',
    '/Users/me/.lody-oss/loro-repo'
  ])
  assert.equal(args.includes('secret'), false)
})

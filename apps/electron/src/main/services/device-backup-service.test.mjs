import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setTimeout as setTimeoutAsync } from 'node:timers/promises'
import test from 'node:test'
import { buildResticBackupArgs, parseDeviceBackupConfig } from './device-backup-core.ts'
import {
  spawnDetachedBackupProcess,
  waitForBackupProcess
} from './device-backup-process.ts'

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

void test('detached backup spawn returns while the child is still running', () => {
  const child = spawnDetachedBackupProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'])
  assert.ok(child.pid)
  assert.equal(child.exitCode, null)
  child.kill('SIGKILL')
})

void test('a hung awaited backup is SIGTERM then SIGKILL', async () => {
  const signals = []
  const child = new EventEmitter()
  child.kill = (signal) => {
    signals.push(signal)
  }
  child.stdout = null
  child.stderr = null
  await assert.rejects(waitForBackupProcess(child, 0, 0), /timed out after 0ms/)
  await setTimeoutAsync(0)
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
})
